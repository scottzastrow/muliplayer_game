import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { createApp } from "../../apps/server/src/app.js";
import {
  BoundedMessageSender,
  type ModuleInput
} from "../../apps/server/src/transport/socket.js";
import { readConfig } from "../../apps/server/src/config.js";
import { openDatabase, runMigrations } from "../../apps/server/src/storage/database.js";

const ORIGIN = "https://game.example.test";
const BASE_HEADERS = { origin: ORIGIN, "content-type": "application/json" };

describe("realtime transport", () => {
  let database: ReturnType<typeof openDatabase>;
  let app: Awaited<ReturnType<typeof createApp>>;
  let baseUrl: string;
  let creatorCookie: string;
  let memberCookie: string;
  let outsiderCookie: string;
  let sessionId: string;
  let inputs: ModuleInput[];
  const activeSockets = new Set<WebSocket>();

  beforeEach(async () => {
    database = openDatabase(":memory:");
    runMigrations(database);
    inputs = [];
    app = createApp(
      readConfig({ NODE_ENV: "test", PUBLIC_ORIGIN: ORIGIN }),
      database,
      { ready: true },
      {
        heartbeatIntervalMs: 20,
        onPlayerInput: (input) => inputs.push(input)
      }
    );
    creatorCookie = await registerLogin("SocketCreator");
    memberCookie = await registerLogin("SocketMember");
    outsiderCookie = await registerLogin("SocketOutsider");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: { ...BASE_HEADERS, cookie: creatorCookie },
      payload: {
        settings: {
          ...DEFAULT_GAME_SETTINGS,
          maxPlayers: 2,
          initialNpcsPerPlayer: 1,
          baseNpcHealth: 1,
          maxLevels: 1
        }
      }
    });
    expect(created.statusCode).toBe(201);
    sessionId = created.json().session.id as string;
    expect((await callJoin(memberCookie)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/sessions/${sessionId}/start`,
          headers: { ...BASE_HEADERS, cookie: creatorCookie },
          payload: { expectedRevision: 0 }
        })
      ).statusCode
    ).toBe(200);
    baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    for (const socket of activeSockets) {
      socket.terminate();
    }
    activeSockets.clear();
    await app.close();
  });

  it("authenticates upgrades, requires active session membership, and enforces the origin", async () => {
    expect(await rejectedStatus(undefined)).toBe(401);
    expect(await rejectedStatus(outsiderCookie)).toBe(403);
    expect(await rejectedStatus(creatorCookie, "https://untrusted.example")).toBe(403);

    const socket = await connect(creatorCookie);
    const hello = await nextMessage(socket);
    expect(hello).toMatchObject({
      v: 1,
      type: "server.hello",
      sessionId,
      payload: {
        protocolVersion: 1,
        role: "player",
        sessionState: "running",
        lastAcceptedInputSeq: -1
      }
    });
    socket.close();
  });

  it("serves the exact pinned revision to running matches after the revision is disabled", async () => {
    const pin = database.prepare(
      "SELECT theme_digest FROM matches WHERE id = ?"
    ).get(sessionId) as { theme_digest: string };
    database.prepare(
      "UPDATE theme_revisions SET enabled = 0 WHERE theme_id = 'default' AND version = '1.0.0'"
    ).run();

    const socket = await connect(creatorCookie);
    const hello = await nextMessage(socket);
    expect(hello.payload.pinnedTheme).toMatchObject({
      revision: "default@1.0.0",
      digest: pin.theme_digest
    });
    expect((await nextMessageOfType(socket, "server.snapshot")).payload).toMatchObject({
      protocolVersion: 1,
      moduleStateSchemaVersion: 4
    });
    socket.close();
  });

  it("validates the shared envelope while forwarding opaque module-defined actions", async () => {
    const socket = await connect(memberCookie);
    await nextMessage(socket);
    const action = { type: "unlock", targetId: "door-1" };
    socket.send(
      JSON.stringify({
        v: 1,
        type: "client.input",
        payload: { sequence: 4, action }
      })
    );
    await waitUntil(() => inputs.length === 1);
    expect(inputs[0]).toMatchObject({
      sessionId,
      sequence: 4,
      action
    });

    socket.send(
      JSON.stringify({
        v: 1,
        type: "client.input",
        payload: { sequence: 3, action }
      })
    );
    await delay(30);
    expect(inputs).toHaveLength(1);

    socket.send(JSON.stringify({ v: 1, type: "client.input", payload: { sequence: 5 } }));
    const error = await nextMessageOfType(socket, "server.error");
    expect(error).toMatchObject({
      type: "server.error",
      payload: { code: "BAD_REQUEST", fatal: false }
    });
    socket.close();
  });

  it("rechecks membership before accepting inputs on an established connection", async () => {
    const socket = await connect(memberCookie);
    await nextMessage(socket);
    const closed = closedWith(socket, 1_000);
    const left = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/leave`,
      headers: { ...BASE_HEADERS, cookie: memberCookie },
      payload: {}
    });
    expect(left.statusCode).toBe(204);

    socket.send(
      JSON.stringify({
        v: 1,
        type: "client.input",
        payload: { sequence: 0, action: { type: "unsupported" } }
      })
    );
    expect(await closed).toBe(1000);
    expect(inputs).toHaveLength(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM match_participants WHERE match_id = ?")
      .get(sessionId)).toEqual({ count: 2 });
    const forfeited = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/rejoin`,
      headers: { ...BASE_HEADERS, cookie: memberCookie }, payload: {} });
    expect(forfeited.statusCode).toBe(409);
  });

  it("sends WebSocket heartbeats and closes after two missing pong responses", async () => {
    const responsive = await connect(creatorCookie);
    await nextMessage(responsive);
    let pingCount = 0;
    responsive.on("ping", () => {
      pingCount += 1;
    });
    await waitUntil(() => pingCount > 0);
    await delay(60);
    expect(responsive.readyState).toBe(WebSocket.OPEN);
    responsive.close();

    const silent = await connect(creatorCookie);
    await nextMessage(silent);
    (silent as WebSocket & { _autoPong: boolean })._autoPong = false;
    expect(await closedWith(silent, 250)).toBe(1013);
  });

    it("rejoins an existing account after login with retained score, one avatar and unchanged NPC totals", async () => {
      const socket = await connect(memberCookie);
      await nextMessage(socket);
      const first = await nextMessageOfType(socket, "server.snapshot");
      const snapshot = first.payload as Record<string, unknown>;
      const accountId = snapshot.viewerAccountId as string;
      const remaining = (snapshot.entities as Array<{ state: { kind: string } }>)
        .filter(entity => entity.state.kind === "npc").length;
      const closed = closedWith(socket, 1_000);
      socket.close();
      await closed;
      await delay(30);
      expect(await rejectedStatus(memberCookie)).toBe(403);
      const newLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login",
        headers: BASE_HEADERS, payload: { username: "SocketMember", password: "correct horse battery staple 123" } });
      expect(newLogin.statusCode).toBe(200);
      const cookie = String(newLogin.headers["set-cookie"]).split(";")[0]!;
      const outsider = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/rejoin`,
        headers: { ...BASE_HEADERS, cookie: outsiderCookie }, payload: {} });
      expect(outsider.statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/rejoin`,
        headers: BASE_HEADERS, payload: {} })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/rejoin`,
        headers: { ...BASE_HEADERS, cookie }, payload: { accountId: "another-account" } })).statusCode).toBe(400);
      for (let retry = 0; retry < 2; retry++) {
        const response = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/rejoin`,
          headers: { ...BASE_HEADERS, cookie }, payload: {} });
        expect(response.statusCode).toBe(200);
      }
      const resumed = await connect(cookie);
      await nextMessage(resumed);
      const restored = (await nextMessageOfType(resumed, "server.snapshot")).payload as Record<string, unknown>;
      expect((restored.players as Array<{ accountId: string; points: number }>).find(player => player.accountId === accountId))
        .toMatchObject({ points: 0, deaths: 0, connected: true });
      expect((restored.entities as Array<{ state: { kind: string; accountId?: string } }>)
        .filter(entity => entity.state.accountId === accountId)).toHaveLength(1);
      expect((restored.entities as Array<{ state: { kind: string } }>)
        .filter(entity => entity.state.kind === "npc")).toHaveLength(remaining);
      const duplicate = await connect(cookie);
      await nextMessage(duplicate);
      await delay(30);
      const latest = (await nextMessageOfType(duplicate, "server.snapshot")).payload as Record<string, unknown>;
      expect((latest.players as Array<{ accountId: string; points: number }>).find(player => player.accountId === accountId))
        .toMatchObject({ points: 0, connected: true });
      expect(database.prepare("SELECT COUNT(*) AS count FROM match_participants WHERE match_id = ? AND account_id = ?")
        .get(sessionId, accountId)).toEqual({ count: 1 });
    });
  it("publishes module snapshots and rejects actions the active module does not validate", async () => {
    const socket = await connect(creatorCookie);
    await nextMessageOfType(socket, "server.hello");
    const snapshot = await nextMessageOfType(socket, "server.snapshot");
    expect(snapshot).toMatchObject({
      sessionId,
      payload: {
        protocolVersion: 1,
        moduleStateSchemaVersion: 4,
        level: 1,
        phase: "active",
        entities: expect.any(Array)
      }
    });
    socket.send(
      JSON.stringify({
        v: 1,
        type: "client.input",
        payload: { sequence: 0, action: { type: "unsupported" } }
      })
    );
    expect(await nextMessageOfType(socket, "server.error")).toMatchObject({
      payload: { code: "BAD_REQUEST", fatal: false }
    });
    expect(inputs).toHaveLength(0);
    socket.close();
  });

    it("replaces an account's old room connection without adding a player to its frozen match", async () => {
      const old = await connect(memberCookie);
      await nextMessage(old);
      const replacementRoom = await app.inject({ method: "POST", url: "/api/v1/sessions",
        headers: { ...BASE_HEADERS, cookie: memberCookie }, payload: { settings: DEFAULT_GAME_SETTINGS } });
      expect(replacementRoom.statusCode).toBe(201);
      const closed = closedWith(old, 1_000);
      const replacement = await connect(memberCookie, replacementRoom.json().session.id);
      expect(await closed).toBe(4001);
      await nextMessage(replacement);
      const summary = (await app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}`,
        headers: { cookie: memberCookie } })).json().session;
      expect(summary).toMatchObject({ playerCount: 2, canRejoin: true, canPlay: false });
    });

  it("limits each client frame and closes connections that exceed the input rate", async () => {
    const socket = await connect(creatorCookie);
    await nextMessage(socket);
    socket.send("x".repeat(16 * 1024 + 1));
    expect(await closedWith(socket, 1_000)).toBe(1009);

    const limited = await connect(memberCookie);
    await nextMessage(limited);
    for (let sequence = 0; sequence <= 60; sequence += 1) {
      limited.send(
        JSON.stringify({
          v: 1,
          type: "client.input",
          payload: { sequence, action: null }
        })
      );
    }
    expect(await closedWith(limited, 1_000)).toBe(1008);
    expect(inputs.length).toBeLessThanOrEqual(60);
  });

  async function registerLogin(username: string): Promise<string> {
    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: BASE_HEADERS,
      payload: { username, password: "correct horse battery staple 123" }
    });
    expect(registration.statusCode).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: BASE_HEADERS,
      payload: { username, password: "correct horse battery staple 123" }
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof cookie !== "string") {
      throw new Error("Login response did not set a session cookie.");
    }
    return cookie.split(";", 1)[0]!;
  }

  async function callJoin(cookie: string) {
    return app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/join`,
      headers: { ...BASE_HEADERS, cookie },
      payload: {}
    });
  }

  function webSocketUrl(targetSessionId = sessionId): string {
    return `${baseUrl.replace(/^http/, "ws")}/ws?sessionId=${targetSessionId}`;
  }

  function connect(cookie: string, targetSessionId = sessionId): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl(targetSessionId), {
        headers: { cookie, origin: ORIGIN }
      });
      receivedMessages.set(socket, []);
      messageWaiters.set(socket, []);
      socket.on("message", (data: RawData) => {
        const waiter = messageWaiters.get(socket)?.shift();
        if (waiter) {
          clearTimeout(waiter.timeout);
          try {
            waiter.resolve(parseMessage(data));
          } catch (error) {
            waiter.reject(error);
          }
        } else {
          receivedMessages.get(socket)?.push(data);
        }
      });
      socket.on("close", () => activeSockets.delete(socket));
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
      activeSockets.add(socket);
    });
  }

  function rejectedStatus(cookie?: string, origin = ORIGIN): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl(), {
        headers: { ...(cookie ? { cookie } : {}), origin }
      });
      socket.once("unexpected-response", (_request, response) => {
        const statusCode = response.statusCode ?? 0;
        response.resume();
        resolve(statusCode);
      });
      socket.once("open", () => reject(new Error("Expected the WebSocket upgrade to fail.")));
      socket.on("error", () => {});
    });
  }
});

describe("bounded realtime output", () => {
  it("discards a coalesced old-target snapshot before acknowledging selection loss", () => {
    const socket = new FakeOutgoingSocket();
    socket.bufferedAmount = 400;
    const sender = new BoundedMessageSender(socket, 500);
    sender.send(snapshot(1));
    expect(socket.sent).toHaveLength(0);
    sender.discardSnapshot();
    socket.bufferedAmount = 0;
    sender.send({ v: 1, type: "server.spectate.target",
      payload: { targetAccountId: null, reason: "target-unavailable", players: [] } });
    sender.flushSnapshot();
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!).type).toBe("server.spectate.target");
  });

  it("coalesces snapshots and closes on reliable output overflow", () => {
    const socket = new FakeOutgoingSocket();
    socket.bufferedAmount = 400;
    const sender = new BoundedMessageSender(socket, 500);
    expect(sender.send(snapshot(1))).toBe(true);
    expect(sender.send(snapshot(2))).toBe(true);
    expect(socket.sent).toHaveLength(0);
    socket.bufferedAmount = 0;
    sender.flushSnapshot();
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!).payload.snapshotId).toBe(2);
    expect(socket.bufferedAmount).toBeLessThanOrEqual(500);

    socket.bufferedAmount = 490;
    expect(sender.send(snapshot(3))).toBe(false);
    const overflow = sender.send({
      v: 1,
      type: "server.event",
      payload: { event: "must-not-be-silently-dropped" }
    });
    expect(overflow).toBe(false);
    expect(socket.closeCode).toBe(1013);
  });
});

class FakeOutgoingSocket {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  closeCode: number | undefined;

  send(data: string): void {
    this.sent.push(data);
    this.bufferedAmount += Buffer.byteLength(data, "utf8") + 10;
  }

  close(code?: number): void {
    this.closeCode = code;
    this.readyState = WebSocket.CLOSED;
  }
}

function snapshot(snapshotId: number) {
  return {
    v: 1 as const,
    type: "server.snapshot" as const,
    payload: { snapshotId }
  };
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  const buffered = receivedMessages.get(socket)?.shift();
  if (buffered) {
    return Promise.resolve(parseMessage(buffered));
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        const waiters = messageWaiters.get(socket);
        if (waiters) {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
        }
        reject(new Error("Timed out waiting for a WebSocket message."));
      }, 1_000)
    };
    messageWaiters.get(socket)?.push(waiter);
  });
}

const receivedMessages = new WeakMap<WebSocket, RawData[]>();
const messageWaiters = new WeakMap<
  WebSocket,
  Array<{
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: unknown) => void;
    timeout: NodeJS.Timeout;
  }>
>();

function parseMessage(data: RawData): Record<string, unknown> {
  return JSON.parse(data.toString()) as Record<string, unknown>;
}

function closedWith(socket: WebSocket, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket close.")), timeoutMs);
    socket.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Condition was not satisfied before timeout.");
    }
    await delay(5);
  }
}

async function nextMessageOfType(
  socket: WebSocket,
  type: string
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const message = await nextMessage(socket);
    if (message.type === type) {
      return message;
    }
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
