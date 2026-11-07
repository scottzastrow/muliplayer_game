import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import {
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  type ErrorCode,
  type JsonValue,
  type MatchResult,
  type ServerEnvelope
} from "@multiplayer-game/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { HttpError } from "../errors.js";
import type { AppConfig } from "../config.js";
import { authenticateSession, readSessionCookie } from "../auth/sessions.js";
import type { AuthenticatedAccount } from "../auth/accounts.js";
import type { SqliteDatabase } from "../storage/database.js";
import type { LobbyRegistry } from "../lobby/registry.js";
import type { FollowablePlayer } from "../lobby/spectators.js";
import { createSpectatorView } from "./spectator-view.js";

export const MAX_INCOMING_MESSAGE_BYTES = 16 * 1024;
export const MAX_BUFFERED_OUTGOING_BYTES = 1024 * 1024;
export const MAX_INPUTS_PER_SECOND = 60;
const MAX_JSON_DEPTH = 32;
const MAX_INVALID_MESSAGES = 3;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SNAPSHOT_HIGH_WATERMARK = 0.75;

export interface ModuleInput {
  readonly accountId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly action: JsonValue;
}

export interface RealtimeOptions {
  readonly heartbeatIntervalMs?: number;
  readonly maxBufferedBytes?: number;
  readonly onPlayerInput?: (input: ModuleInput) => void | boolean;
  readonly onPlayerPresence?: (sessionId: string, accountId: string,
    presence: "connected" | "disconnected" | "expired") => void;
}

interface OutgoingSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class BoundedMessageSender {
  #pendingSnapshot: string | undefined;

  constructor(
    readonly socket: OutgoingSocket,
    readonly maxBufferedBytes = MAX_BUFFERED_OUTGOING_BYTES
  ) {}

  send(envelope: ServerEnvelope): boolean {
    const parsed = ServerEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new TypeError("Outgoing realtime message does not match the protocol.");
    }

    const serialized = JSON.stringify(parsed.data);
    const size = outgoingSize(serialized);
    if (size > this.maxBufferedBytes) {
      this.#closeSlowConsumer();
      return false;
    }

    if (parsed.data.type === "server.snapshot") {
      this.#pendingSnapshot = serialized;
      if (this.socket.bufferedAmount + size > this.maxBufferedBytes) {
        this.#pendingSnapshot = undefined;
        return false;
      }
      this.flushSnapshot();
      return true;
    }

    this.flushSnapshot();
    if (
      this.#pendingSnapshot &&
      this.socket.bufferedAmount + outgoingSize(this.#pendingSnapshot) + size >
        this.maxBufferedBytes
    ) {
      this.#pendingSnapshot = undefined;
    }
    if (this.#bufferedBytes() + size > this.maxBufferedBytes) {
      this.#closeSlowConsumer();
      return false;
    }
    this.socket.send(serialized);
    return true;
  }

  flushSnapshot(): void {
    if (!this.#pendingSnapshot || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const size = outgoingSize(this.#pendingSnapshot);
    if (
      this.socket.bufferedAmount + size > this.maxBufferedBytes ||
      this.socket.bufferedAmount > this.maxBufferedBytes * SNAPSHOT_HIGH_WATERMARK
    ) {
      return;
    }
    const snapshot = this.#pendingSnapshot;
    this.#pendingSnapshot = undefined;
    this.socket.send(snapshot);
  }

  discardSnapshot(): void {
    this.#pendingSnapshot = undefined;
  }

  #bufferedBytes(): number {
    return this.socket.bufferedAmount + (this.#pendingSnapshot
      ? outgoingSize(this.#pendingSnapshot)
      : 0);
  }

  #closeSlowConsumer(): void {
    this.#pendingSnapshot = undefined;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1013, "Slow consumer; reconnect to resync.");
    }
  }
}

interface ConnectionState {
  readonly account: AuthenticatedAccount;
  readonly sessionId: string;
  readonly sender: BoundedMessageSender;
  readonly role: "player" | "spectator";
  readonly spectatorConnection?: symbol;
  playerConnection?: symbol;
  lastSequence: number;
  invalidMessages: number;
  awaitingPong: boolean;
  missedPongs: number;
  heartbeat: NodeJS.Timeout;
}

interface AccountInputWindow {
  connections: number;
  startedAt: number;
  count: number;
}

export class RealtimeTransport {
  readonly #webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_INCOMING_MESSAGE_BYTES,
    perMessageDeflate: false
  });
  readonly #connections = new Map<WebSocket, ConnectionState>();
  readonly #currentByMember = new Map<string, WebSocket>();
  readonly #inputWindows = new Map<string, AccountInputWindow>();
  readonly #onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    void this.#upgrade(request, socket, head);
  };
  #closed = false;

  constructor(
    readonly server: Server,
    readonly database: SqliteDatabase,
    readonly config: AppConfig,
    readonly lobby: LobbyRegistry,
    readonly options: RealtimeOptions = {}
  ) {
    this.server.on("upgrade", this.#onUpgrade);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.server.removeListener("upgrade", this.#onUpgrade);
    for (const [socket, state] of this.#connections) {
      clearInterval(state.heartbeat);
      if (state.spectatorConnection) {
        this.lobby.spectators.detach(state.sessionId, state.account.id, state.spectatorConnection);
      }
      socket.terminate();
    }
    this.#connections.clear();
    this.#currentByMember.clear();
    this.#inputWindows.clear();
  }

  isPlayerConnected(sessionId: string, accountId: string): boolean {
    const socket = this.#currentByMember.get(`${sessionId}:${accountId}`);
    return Boolean(socket?.readyState === WebSocket.OPEN &&
      this.#connections.get(socket)?.role === "player" &&
      this.lobby.hasPlayerMembership(sessionId, accountId));
  }

  closeSpectator(sessionId: string, accountId: string): void {
    const socket = this.#currentByMember.get(`${sessionId}:${accountId}`);
    if (socket && this.#connections.get(socket)?.role === "spectator") {
      socket.close(1000, "Left spectator session.");
    }
  }

  leaveMember(sessionId: string, accountId: string): void {
    const socket = this.#currentByMember.get(`${sessionId}:${accountId}`);
    const state = socket && this.#connections.get(socket);
    if (state?.role === "player") this.options.onPlayerPresence?.(sessionId, accountId, "expired");
    else if (this.database.prepare("SELECT 1 FROM match_participants WHERE match_id = ? AND account_id = ?")
      .get(sessionId, accountId)) {
      this.options.onPlayerPresence?.(sessionId, accountId, "expired");
    }
    socket?.close(1000, "Left session.");
  }

  activateSession(sessionId: string): void {
    for (const [socket, state] of this.#connections) {
      if (state.sessionId !== sessionId || state.role !== "player" ||
        socket.readyState !== WebSocket.OPEN ||
        this.#currentByMember.get(`${sessionId}:${state.account.id}`) !== socket) continue;
      state.playerConnection = this.lobby.reconnect.attach(sessionId, state.account.id);
      this.options.onPlayerPresence?.(sessionId, state.account.id, "connected");
    }
  }

  publishSnapshot(
    sessionId: string,
    tick: number,
    moduleStateSchemaVersion: number,
    snapshotForAccount: (accountId: string) => Readonly<Record<string, JsonValue>>
  ): void {
    let players: readonly FollowablePlayer[] | undefined;
    const targetSnapshots = new Map<string, Readonly<Record<string, JsonValue>>>();
    for (const [webSocket, state] of this.#connections) {
      if (state.sessionId !== sessionId || webSocket.readyState !== WebSocket.OPEN ||
        this.#currentByMember.get(`${sessionId}:${state.account.id}`) !== webSocket) {
        continue;
      }

      let snapshot: Readonly<Record<string, JsonValue>>;
      if (state.role === "spectator") {
        if (!this.lobby.spectators.has(sessionId, state.account.id)) continue;
        players ??= this.lobby.spectators.players(sessionId, state.account.id);
        const targetAccountId = this.lobby.spectators.refreshTarget(sessionId, state.account.id, players);
        if (this.lobby.spectators.takeTargetUnavailable(sessionId, state.account.id)) {
          state.sender.discardSnapshot();
          state.sender.send({
            v: 1, type: "server.spectate.target", sessionId, tick, serverTimeMs: Date.now(),
            payload: { targetAccountId: null, reason: "target-unavailable",
              message: "The selected player is no longer available to follow.",
              players: players.filter(player => player.followable).map(player => ({ ...player })) }
          });
        }
        if (!targetAccountId) continue;
        const cached = targetSnapshots.get(targetAccountId);
        snapshot = cached ?? createSpectatorView(targetAccountId, snapshotForAccount(targetAccountId));
        if (!cached) targetSnapshots.set(targetAccountId, snapshot);
      } else {
        snapshot = snapshotForAccount(state.account.id);
      }
      state.sender.send({
        v: 1,
        type: "server.snapshot",
        sessionId,
        tick,
        serverTimeMs: Date.now(),
        payload: {
          protocolVersion: 1,
          moduleStateSchemaVersion,
          ...snapshot
        }
      });
    }
  }

  publishResult(sessionId: string, tick: number, status: MatchResult["status"]): void {
    for (const [socket, state] of this.#connections) {
      if (state.sessionId !== sessionId || socket.readyState !== WebSocket.OPEN) continue;
      state.sender.send({
        v: 1, type: "server.lifecycle", sessionId, tick, serverTimeMs: Date.now(),
        payload: { status, resultId: sessionId }
      });
    }
  }

  #upgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
    if (this.#closed) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    try {
      const { sessionId } = parseUpgradeUrl(request.url);
      if (request.headers.origin !== this.config.publicOrigin) {
        throw new HttpError(403, "FORBIDDEN", "The WebSocket origin is not allowed.");
      }

      const account = authenticateSession(
        this.database,
        readSessionCookie(request.headers.cookie)
      );
      if (!this.lobby.hasPlayerMembership(sessionId, account.id) &&
        !this.lobby.spectators.has(sessionId, account.id)) {
        throw new HttpError(403, "FORBIDDEN", "Session membership is required.");
      }
      const summary = this.lobby.getSummary(sessionId, account.id);
      if (!summary || (summary.status !== "waiting" && summary.status !== "running")) {
        throw new HttpError(404, "NOT_FOUND", "Session not found.");
      }
      const pinnedTheme = this.lobby.getPinnedTheme(sessionId);
      if (summary.status === "running" && this.lobby.hasPlayerMembership(sessionId, account.id) &&
        !this.lobby.reconnect.canUpgrade(sessionId, account.id)) {
        throw new HttpError(403, "FORBIDDEN", "Rejoin admission is required.");
      }

      this.#webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        this.#accept(webSocket, account, sessionId, summary, pinnedTheme);
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : 500;
      const statusText = status === 401
        ? "Unauthorized"
        : status === 403
          ? "Forbidden"
          : status === 404
            ? "Not Found"
            : status === 400
              ? "Bad Request"
              : "Internal Server Error";
      rejectUpgrade(socket, status, statusText);
    }
  }

  #accept(
    webSocket: WebSocket,
    account: AuthenticatedAccount,
    sessionId: string,
    summary: NonNullable<ReturnType<LobbyRegistry["getSummary"]>>,
    pinnedTheme: ReturnType<LobbyRegistry["getPinnedTheme"]>
  ): void {
    const role = this.lobby.hasPlayerMembership(sessionId, account.id) ? "player" : "spectator";
    const spectatorConnection = role === "spectator"
      ? this.lobby.spectators.attach(sessionId, account.id) : undefined;
    const playerConnection = role === "player" && summary.status === "running"
      ? this.lobby.reconnect.attach(sessionId, account.id) : undefined;
    const memberKey = `${sessionId}:${account.id}`;
    const previous = this.#currentByMember.get(memberKey);
    if (previous && previous.readyState === WebSocket.OPEN) {
      previous.close(4001, "Replaced by a newer connection.");
    }

    const sender = new BoundedMessageSender(
      webSocket,
      this.options.maxBufferedBytes ?? MAX_BUFFERED_OUTGOING_BYTES
    );
    const state: ConnectionState = {
      account,
      sessionId,
      sender,
      role,
      ...(spectatorConnection ? { spectatorConnection } : {}),
      ...(playerConnection ? { playerConnection } : {}),
      lastSequence: -1,
      invalidMessages: 0,
      awaitingPong: false,
      missedPongs: 0,
      heartbeat: setInterval(
        () => this.#heartbeat(webSocket, state),
        this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
      )
    };
    this.#connections.set(webSocket, state);
    this.#currentByMember.set(memberKey, webSocket);
    for (const [older, olderState] of this.#connections) {
      if (older === webSocket || olderState.account.id !== account.id || olderState.sessionId === sessionId) continue;
      this.#remove(older, olderState);
      older.close(4001, "Replaced by a newer connection.");
    }
    if (playerConnection) this.options.onPlayerPresence?.(sessionId, account.id, "connected");
    const window = this.#inputWindows.get(account.id);
    if (window) {
      window.connections += 1;
    } else {
      this.#inputWindows.set(account.id, {
        connections: 1,
        startedAt: Date.now(),
        count: 0
      });
    }

    webSocket.on("pong", () => {
      state.awaitingPong = false;
      state.missedPongs = 0;
    });
    webSocket.on("message", (data, isBinary) => {
      this.#message(webSocket, state, data, isBinary);
    });
    webSocket.on("close", () => this.#remove(webSocket, state));
    webSocket.on("error", () => this.#remove(webSocket, state));

    sender.send({
      v: 1,
      type: "server.hello",
      sessionId,
      tick: 0,
      serverTimeMs: Date.now(),
      payload: {
        protocolVersion: 1,
        tickRate: 30,
        snapshotRate: 15,
        role,
        sessionState: summary.status,
        pinnedTheme: {
          name: pinnedTheme.name,
          revision: `${pinnedTheme.theme_id}@${pinnedTheme.version}`,
          digest: pinnedTheme.digest
        },
        lastAcceptedInputSeq: state.lastSequence
      }
    });
  }

  #message(
    webSocket: WebSocket,
    state: ConnectionState,
    raw: RawData,
    isBinary: boolean
  ): void {
    if (this.#currentByMember.get(`${state.sessionId}:${state.account.id}`) !== webSocket) {
      return;
    }
    if (isBinary) {
      this.#invalid(webSocket, state, "Binary messages are not supported.");
      return;
    }
    const bytes = rawToBuffer(raw);
    if (bytes.byteLength > MAX_INCOMING_MESSAGE_BYTES) {
      this.#invalid(webSocket, state, "Message exceeds the 16 KiB limit.");
      return;
    }
    const text = bytes.toString("utf8");
    if (!hasSafeJsonDepth(text)) {
      this.#invalid(webSocket, state, "Message nesting exceeds the supported limit.");
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      this.#invalid(webSocket, state, "Message must contain valid JSON.");
      return;
    }
    const parsed = ClientEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      this.#invalid(webSocket, state, "Message does not match the realtime protocol.");
      return;
    }

    const message = parsed.data;
    if (message.type === "client.ping") {
      state.sender.send({
        v: 1,
        type: "server.pong",
        sessionId: state.sessionId,
        tick: 0,
        serverTimeMs: Date.now(),
        requestId: message.requestId,
        payload: { nonce: message.payload.nonce }
      });
      return;
    }
    if (!this.#consumeInput(state.account.id)) {
      this.#sendError(state, "RATE_LIMITED", "Input rate limit exceeded.", message.requestId, true);
      webSocket.close(1008, "Input rate limit exceeded.");
      return;
    }
    if (message.type === "client.spectate.target") {
      try {
        const targetAccountId = this.lobby.spectators.selectTarget(
          state.sessionId, state.account.id, message.payload.targetAccountId
        );
        state.sender.discardSnapshot();
        state.sender.send({
          v: 1, type: "server.spectate.target", sessionId: state.sessionId,
          tick: 0, serverTimeMs: Date.now(),
          ...(message.requestId ? { requestId: message.requestId } : {}),
          payload: { targetAccountId }
        });
      } catch (error) {
        if (error instanceof HttpError) {
          this.#sendError(state, error.code, error.message, message.requestId, false);
        } else {
          this.#sendError(state, "INTERNAL_ERROR", "The game could not select this target.", message.requestId, true);
          webSocket.close(1011, "The game could not select this target.");
        }
      }
      return;
    }
    if (state.role !== "player") {
      this.#sendError(state, "FORBIDDEN", "Spectators cannot control gameplay.", message.requestId, false);
      return;
    }
    if (message.payload.sequence <= state.lastSequence) {
      return;
    }
    if (!this.lobby.hasPlayerMembership(state.sessionId, state.account.id)) {
      this.#sendError(
        state,
        "FORBIDDEN",
        "Session membership is required.",
        message.requestId,
        true
      );
      webSocket.close(1008, "Session membership is required.");
      return;
    }
    if (!this.options.onPlayerInput) {
      this.#sendError(
        state,
        "NOT_READY",
        "The game simulation is not ready.",
        message.requestId,
        false
      );
      return;
    }

    try {
      const accepted = this.options.onPlayerInput({
        accountId: state.account.id,
        sessionId: state.sessionId,
        sequence: message.payload.sequence,
        action: message.payload.action
      });
      if (accepted === false) {
        this.#sendError(
          state,
          "BAD_REQUEST",
          "The active game module rejected this action.",
          message.requestId,
          false
        );
        return;
      }
      state.lastSequence = message.payload.sequence;
    } catch {
      this.#sendError(
        state,
        "INTERNAL_ERROR",
        "The game could not process this input.",
        message.requestId,
        true
      );
      webSocket.close(1011, "The game could not process this input.");
    }
  }

  #invalid(webSocket: WebSocket, state: ConnectionState, reason: string): void {
    state.invalidMessages += 1;
    this.#sendError(
      state,
      "BAD_REQUEST",
      reason,
      undefined,
      state.invalidMessages >= MAX_INVALID_MESSAGES
    );
    if (state.invalidMessages >= MAX_INVALID_MESSAGES) {
      webSocket.close(1008, "Too many invalid messages.");
    }
  }

  #sendError(
    state: ConnectionState,
    code: ErrorCode,
    message: string,
    requestId: string | undefined,
    fatal: boolean
  ): void {
    state.sender.send({
      v: 1,
      type: "server.error",
      sessionId: state.sessionId,
      tick: 0,
      serverTimeMs: Date.now(),
      ...(requestId ? { requestId } : {}),
      payload: {
        code,
        message,
        requestId: requestId ?? randomUUID(),
        fatal
      }
    });
  }

  #heartbeat(webSocket: WebSocket, state: ConnectionState): void {
    if (webSocket.readyState !== WebSocket.OPEN) {
      this.#remove(webSocket, state);
      return;
    }
    state.sender.flushSnapshot();
    if (state.awaitingPong) {
      state.missedPongs += 1;
      if (state.missedPongs >= 2) {
        this.#sendError(
          state,
          "NOT_READY",
          "Heartbeat timed out; reconnect to resync.",
          undefined,
          true
        );
        webSocket.close(1013, "Heartbeat timeout; reconnect to resync.");
        return;
      }
    }
    state.awaitingPong = true;
    webSocket.ping();
  }

  #consumeInput(accountId: string): boolean {
    const window = this.#inputWindows.get(accountId);
    if (!window) {
      return false;
    }
    const now = Date.now();
    if (now - window.startedAt >= 1_000) {
      window.startedAt = now;
      window.count = 0;
    }
    window.count += 1;
    return window.count <= MAX_INPUTS_PER_SECOND;
  }

  #remove(webSocket: WebSocket, state: ConnectionState): void {
    if (this.#connections.get(webSocket) !== state) {
      return;
    }
    clearInterval(state.heartbeat);
    this.#connections.delete(webSocket);
    if (state.spectatorConnection) {
      this.lobby.spectators.detach(state.sessionId, state.account.id, state.spectatorConnection);
    }
    if (state.playerConnection &&
      this.lobby.reconnect.detach(state.sessionId, state.account.id, state.playerConnection)) {
      this.options.onPlayerPresence?.(state.sessionId, state.account.id, "disconnected");
    }
    const memberKey = `${state.sessionId}:${state.account.id}`;
    if (this.#currentByMember.get(memberKey) === webSocket) {
      this.#currentByMember.delete(memberKey);
    }
    const window = this.#inputWindows.get(state.account.id);
    if (window) {
      window.connections -= 1;
      if (window.connections <= 0) {
        this.#inputWindows.delete(state.account.id);
      }
    }
  }
}

function parseUpgradeUrl(requestUrl: string | undefined): { sessionId: string } {
  if (!requestUrl) {
    throw new HttpError(400, "BAD_REQUEST", "The WebSocket path is invalid.");
  }
  const url = new URL(requestUrl, "http://localhost");
  if (
    url.pathname !== "/ws" ||
    [...url.searchParams.keys()].some((key) => key !== "sessionId") ||
    url.searchParams.getAll("sessionId").length !== 1
  ) {
    throw new HttpError(404, "NOT_FOUND", "WebSocket endpoint not found.");
  }
  const sessionId = url.searchParams.get("sessionId");
  if (
    !sessionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sessionId
    )
  ) {
    throw new HttpError(400, "BAD_REQUEST", "The session identifier is invalid.");
  }
  return { sessionId };
}

function rejectUpgrade(socket: Socket, status: number, statusText: string): void {
  if (socket.destroyed) {
    return;
  }
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
}

function rawToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw);
  }
  return Buffer.from(raw);
}

function hasSafeJsonDepth(text: string): boolean {
  let depth = 0;
  let insideString = false;
  let escaped = false;
  for (const character of text) {
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        insideString = false;
      }
      continue;
    }
    if (character === "\"") {
      insideString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        return false;
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }
  return true;
}

function outgoingSize(serialized: string): number {
  return Buffer.byteLength(serialized, "utf8") + 10;
}
