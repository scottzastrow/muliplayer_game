import { randomInt, randomUUID } from "node:crypto";
import {
  GameSettingsSchema,
  RequestIdSchema,
  validateMatchCapacity,
  type GameSettings,
  type PublicSessionSummary,
  serializePublicSessionSummary
} from "@multiplayer-game/protocol";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";
import type { SqliteDatabase } from "../storage/database.js";
import {
  advanceMatchLevel,
  finalizeMatchResult,
  type SubmittedStanding
} from "../storage/results.js";
import type { AuthenticatedAccount } from "../auth/accounts.js";
import type { ThemeLoader } from "../themes/builtins.js";
import { ThemeRegistry, type ThemeRevisionRecord } from "../themes/registry.js";
import { SpectatorRegistry, type PlayerFollowState } from "./spectators.js";
import { ReconnectRegistry } from "./reconnect.js";

const SESSION_LIMIT = 5;
const IDEMPOTENCY_WINDOW_MS = 60_000;
const SESSION_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,64}$/;

interface SessionRow {
  id: string;
  creator_account_id: string;
  creator_username: string;
  state: PublicSessionSummary["status"];
  settings_json: string;
  settings_revision: number;
  display_name: string;
  theme_name: string;
  theme_digest: string;
  current_level: number;
  player_count: number;
  member: number;
}

interface DedupeEntry {
  readonly expiresAt: number;
  readonly sessionId: string;
}

export interface CreatedSession {
  readonly summary: PublicSessionSummary;
  readonly settings: GameSettings;
  readonly created: boolean;
}

export class LobbyRegistry {
  readonly #dedupe = new Map<string, DedupeEntry>();
  readonly spectators: SpectatorRegistry;
  readonly reconnect: ReconnectRegistry;
  readonly #themes: ThemeRegistry;

  constructor(
    readonly database: SqliteDatabase,
    readonly clock: () => number = Date.now,
    readonly themeLoader?: ThemeLoader,
    playerStates?: (sessionId: string) => ReadonlyMap<string, PlayerFollowState>
  ) {
    this.spectators = new SpectatorRegistry(database, playerStates);
    this.reconnect = new ReconnectRegistry(clock);
    this.#themes = new ThemeRegistry(database, themeLoader);
  }

  create(
    account: AuthenticatedAccount,
    input: unknown,
    requestId?: string
  ): CreatedSession {
    const body = parseCreateBody(input);
    const effectiveRequestId = requestId ?? body.requestId;
    const key = effectiveRequestId ? `${account.id}:${effectiveRequestId}` : undefined;
    this.#pruneDedupe();
    if (key) {
      const previous = this.#dedupe.get(key);
      if (previous) {
        const existing = this.getSummary(previous.sessionId, account.id);
        if (existing) {
          return {
            summary: existing,
            settings: readSettings(this.database, previous.sessionId),
            created: false
          };
        }
        this.#dedupe.delete(key);
      }
    }

    const settings = parseSettings(body.settings, 1);
    const activeCount = this.#activeSessionCount();
    if (activeCount >= SESSION_LIMIT) {
      throw new HttpError(409, "SESSION_CAPACITY", "The server has reached its session limit.");
    }

    const sessionId = randomUUID();
    const createdAt = new Date(this.clock()).toISOString();
    this.database.transaction(() => {
      const theme = this.#themes.getEnabled(settings.themeRevision);
      if (this.#activeSessionCount() >= SESSION_LIMIT) {
        throw new HttpError(409, "SESSION_CAPACITY", "The server has reached its session limit.");
      }
      this.database
        .prepare(
          `INSERT INTO matches
           (id, creator_account_id, state, settings_json, settings_revision, display_name, theme_digest,
            seed, current_level, created_at)
           VALUES (?, ?, 'waiting', ?, 0, ?, ?, ?, 1, ?)`
        )
        .run(
          sessionId,
          account.id,
          JSON.stringify(settings),
          `${theme.name} — ${account.username}`,
          theme.digest,
          randomInt(0, 0x7fffffff),
          createdAt
        );
      this.database
        .prepare(
          "INSERT INTO match_participants(match_id, account_id, joined_order) VALUES (?, ?, 0)"
        )
        .run(sessionId, account.id);
    }).immediate();

    if (key) {
      this.#dedupe.set(key, {
        expiresAt: this.clock() + IDEMPOTENCY_WINDOW_MS,
        sessionId
      });
      while (this.#dedupe.size > 10_000) {
        const oldest = this.#dedupe.keys().next().value as string | undefined;
        if (!oldest) {
          break;
        }
        this.#dedupe.delete(oldest);
      }
    }
    const summary = this.getSummary(sessionId, account.id);
    if (!summary) {
      throw new Error("Created session could not be read back.");
    }
    return { summary, settings, created: true };
  }

  list(accountId: string): PublicSessionSummary[] {
    const ids = this.database
      .prepare("SELECT id FROM matches WHERE state IN ('waiting', 'running') ORDER BY created_at, id")
      .all() as Array<{ id: string }>;
    return ids.flatMap(({ id }) => {
      const summary = this.getSummary(id, accountId);
      return summary ? [summary] : [];
    });
  }

  getSummary(sessionId: string, accountId: string): PublicSessionSummary | undefined {
    const row = this.#readSession(sessionId, accountId);
    if (!row) {
      return undefined;
    }
    const settings = parseStoredSettings(row.settings_json);
    return serializePublicSessionSummary({
      id: row.id,
      name: row.display_name,
      creator: row.creator_username,
      status: row.state,
      level: row.current_level,
      maxLevels: settings.maxLevels,
      playerCount: row.player_count,
      maxPlayers: settings.maxPlayers,
      spectatorCount: this.spectators.count(sessionId),
      maxSpectators: settings.maxSpectators,
      themeName: row.theme_name,
      themeRevision: settings.themeRevision,
      settingsRevision: row.settings_revision,
      canJoin: row.state === "waiting" && row.member === 0 && row.player_count < settings.maxPlayers,
      canSpectate:
        row.state === "running" &&
        row.member === 0 &&
        !this.spectators.has(sessionId, accountId) &&
        this.spectators.count(sessionId) < settings.maxSpectators,
      canRejoin: row.state === "running" && row.member !== 0 &&
        this.reconnect.eligible(sessionId, accountId) && !this.reconnect.connected(sessionId, accountId),
      canPlay: row.state === "running" && row.member !== 0 && this.reconnect.canUpgrade(sessionId, accountId)
    });
  }

  getSettings(sessionId: string): GameSettings {
    return readSettings(this.database, sessionId);
  }

  getPinnedTheme(sessionId: string): ThemeRevisionRecord {
    const match = this.database.prepare(
      "SELECT settings_json, theme_digest FROM matches WHERE id = ?"
    ).get(sessionId) as { settings_json: string; theme_digest: string } | undefined;
    if (!match) throw new Error("Pinned theme match could not be loaded.");
    const settings = parseStoredSettings(match.settings_json);
    return this.#themes.getPinned(settings.themeRevision, match.theme_digest);
  }

  hasPlayerMembership(sessionId: string, accountId: string): boolean {
    const member = Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM match_participants p
           JOIN matches m ON m.id = p.match_id
           WHERE p.match_id = ? AND p.account_id = ?
             AND m.state IN ('waiting', 'running')`
        )
        .get(sessionId, accountId)
    );
    const row = this.database.prepare("SELECT state FROM matches WHERE id = ?").get(sessionId) as
      { state: string } | undefined;
    return member && (row?.state === "waiting" || this.reconnect.eligible(sessionId, accountId));
  }

  rejoin(account: AuthenticatedAccount, sessionId: string): PublicSessionSummary {
    const row = this.#readSession(sessionId, account.id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Session not found.");
    if (row.state !== "running") throw new HttpError(409, "REJOIN_EXPIRED", "The match is not active.");
    this.reconnect.rejoin(sessionId, account.id);
    return this.getSummary(sessionId, account.id)!;
  }

  join(account: AuthenticatedAccount, sessionId: string): PublicSessionSummary {
    return this.database.transaction(() => {
      const row = this.#readSession(sessionId, account.id);
      if (!row) {
        throw new HttpError(404, "NOT_FOUND", "Session not found.");
      }
      if (row.state !== "waiting") {
        throw new HttpError(409, "ALREADY_STARTED", "This session is no longer waiting.");
      }
      if (row.member) {
        return this.getSummary(sessionId, account.id)!;
      }
      const currentSettings = parseStoredSettings(row.settings_json);
      if (row.player_count >= currentSettings.maxPlayers) {
        throw new HttpError(409, "PLAYER_CAPACITY", "The session is full.");
      }
      const settings = parseSettings(currentSettings, row.player_count + 1);
      const nextOrder = row.player_count;
      this.database
        .prepare(
          "INSERT INTO match_participants(match_id, account_id, joined_order) VALUES (?, ?, ?)"
        )
        .run(sessionId, account.id, nextOrder);
      return this.getSummary(sessionId, account.id)!;
    })();
  }

  updateSettings(
    account: AuthenticatedAccount,
    sessionId: string,
    input: unknown
  ): { summary: PublicSessionSummary; settings: GameSettings } {
    return this.database.transaction(() => {
      const row = this.#readSession(sessionId, account.id);
      if (!row) {
        throw new HttpError(404, "NOT_FOUND", "Session not found.");
      }
      assertCreator(row, account);
      if (row.state !== "waiting") {
        throw new HttpError(409, "ALREADY_STARTED", "Settings are frozen after the session starts.");
      }
      const body = parseSettingsUpdate(input);
      if (body.expectedRevision !== row.settings_revision) {
        throw new HttpError(409, "REVISION_CONFLICT", "Session settings have changed.");
      }
      const settings = parseSettings(body.settings, row.player_count);
      const theme = this.#themes.getEnabled(settings.themeRevision);
      this.database
        .prepare(
          `UPDATE matches SET settings_json = ?, settings_revision = settings_revision + 1,
           theme_digest = ? WHERE id = ? AND state = 'waiting' AND settings_revision = ?`
        )
        .run(JSON.stringify(settings), theme.digest, sessionId, body.expectedRevision);
      return { summary: this.getSummary(sessionId, account.id)!, settings };
    })();
  }

  start(
    account: AuthenticatedAccount,
    sessionId: string,
    input: unknown
  ): { summary: PublicSessionSummary; settings: GameSettings } {
    return this.database.transaction(() => {
      const row = this.#readSession(sessionId, account.id);
      if (!row) {
        throw new HttpError(404, "NOT_FOUND", "Session not found.");
      }
      assertCreator(row, account);
      if (row.state !== "waiting") {
        throw new HttpError(409, "ALREADY_STARTED", "This session has already started.");
      }
      const expectedRevision = parseExpectedRevision(input);
      if (expectedRevision !== row.settings_revision) {
        throw new HttpError(409, "REVISION_CONFLICT", "Session settings have changed.");
      }
      const settings = parseSettings(parseStoredSettings(row.settings_json), row.player_count);
      const theme = this.#themes.getEnabled(settings.themeRevision);
      if (theme.digest !== row.theme_digest) {
        throw new HttpError(422, "INCOMPATIBLE_THEME", "The waiting session's pinned theme revision has changed.");
      }
      const startedAt = new Date(this.clock()).toISOString();
      const result = this.database
        .prepare(
          `UPDATE matches SET state = 'running', started_at = ?
           WHERE id = ? AND state = 'waiting' AND settings_revision = ?
             AND theme_digest = ?
             AND EXISTS (SELECT 1 FROM theme_revisions
                         WHERE digest = matches.theme_digest AND enabled = 1)`
        )
        .run(startedAt, sessionId, expectedRevision, theme.digest);
      if (result.changes !== 1) {
        throw new HttpError(409, "REVISION_CONFLICT", "Session settings have changed.");
      }
      return { summary: this.getSummary(sessionId, account.id)!, settings };
    })();
  }

  leave(account: AuthenticatedAccount, sessionId: string): void {
    this.database.transaction(() => {
      const row = this.#readSession(sessionId, account.id);
      if (!row) {
        throw new HttpError(404, "NOT_FOUND", "Session not found.");
      }
      this.spectators.leave(sessionId, account.id);
      if (!row.member) {
        return;
      }
      if (row.state === "running") {
        this.reconnect.forfeit(sessionId, account.id);
        return;
      }
      this.database
        .prepare("DELETE FROM match_participants WHERE match_id = ? AND account_id = ?")
        .run(sessionId, account.id);

      const remaining = this.database
        .prepare(
          `SELECT p.account_id FROM match_participants p
           WHERE p.match_id = ? ORDER BY p.joined_order LIMIT 1`
        )
        .get(sessionId) as { account_id: string } | undefined;

      if (row.state === "waiting" && row.creator_account_id === account.id) {
        if (remaining) {
          this.database
            .prepare("UPDATE matches SET creator_account_id = ? WHERE id = ?")
            .run(remaining.account_id, sessionId);
        } else {
          this.#markTerminal(sessionId, "abandoned", "abandoned");
        }
      }
    })();
  }

  markTerminal(
    sessionId: string,
    state: "abandoned" | "failed" | "interrupted"
  ): void {
    this.database.transaction(() => this.#markTerminal(sessionId, state, state))();
  }

  authorizeEnd(account: AuthenticatedAccount, sessionId: string): boolean {
    const row = this.#readSession(sessionId, account.id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Session not found.");
    if (row.creator_account_id !== account.id) {
      throw new HttpError(403, "FORBIDDEN", "Only the host can end this session.");
    }
    if (row.state === "finished") return false;
    if (row.state !== "running") {
      throw new HttpError(409, "BAD_REQUEST", "Only running sessions can be ended.");
    }
    return true;
  }

  advanceLevel(sessionId: string, expectedLevel: number, nextLevel: number): boolean {
    return advanceMatchLevel(this.database, sessionId, expectedLevel, nextLevel);
  }

  finalizeFinishedMatch(
    sessionId: string,
    finalLevel: number,
    standings: readonly SubmittedStanding[],
    completionReason?: string
  ): boolean {
    const finalized = finalizeMatchResult(
      this.database,
      { matchId: sessionId, status: "finished", finalLevel, standings,
        ...(completionReason === undefined ? {} : { completionReason }) },
      new Date(this.clock()).toISOString()
    );
    if (finalized) {
      this.spectators.releaseSession(sessionId);
      this.reconnect.release(sessionId);
    }
    return finalized;
  }

  #markTerminal(
    sessionId: string,
    state: "abandoned" | "failed" | "interrupted",
    resultStatus: "abandoned" | "failed" | "interrupted"
  ): void {
    const row = this.database
      .prepare(
        `SELECT current_level, settings_json, theme_digest FROM matches
         WHERE id = ? AND state IN ('waiting', 'running')`
      )
      .get(sessionId) as
      | { current_level: number; settings_json: string; theme_digest: string }
      | undefined;
    if (!row) {
      return;
    }
    finalizeMatchResult(
      this.database,
      { matchId: sessionId, status: resultStatus, finalLevel: row.current_level },
      new Date(this.clock()).toISOString()
    );
    this.spectators.releaseSession(sessionId);
    this.reconnect.release(sessionId);
  }

  #readSession(sessionId: string, accountId: string): SessionRow | undefined {
    return this.database
      .prepare(
        `SELECT m.id, m.creator_account_id, creator.username AS creator_username, m.state,
                m.settings_json, m.settings_revision, m.display_name, t.name AS theme_name, m.theme_digest,
                m.current_level,
                (SELECT COUNT(*) FROM match_participants p WHERE p.match_id = m.id) AS player_count,
                EXISTS(SELECT 1 FROM match_participants p
                       WHERE p.match_id = m.id AND p.account_id = ?) AS member
         FROM matches m
         JOIN accounts creator ON creator.id = m.creator_account_id
         JOIN theme_revisions t ON t.digest = m.theme_digest
         WHERE m.id = ?`
      )
      .get(accountId, sessionId) as SessionRow | undefined;
  }

  #activeSessionCount(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM matches WHERE state IN ('waiting', 'running')")
      .get() as { count: number };
    return row.count;
  }

  #pruneDedupe(): void {
    const now = this.clock();
    for (const [key, entry] of this.#dedupe) {
      if (entry.expiresAt <= now) {
        this.#dedupe.delete(key);
      }
    }
    while (this.#dedupe.size > 10_000) {
      const oldest = this.#dedupe.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.#dedupe.delete(oldest);
    }
  }
}

function parseCreateBody(input: unknown): {
  settings: unknown;
  requestId?: string;
} {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !["settings", "requestId"].includes(key))
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Request body is invalid.");
  }
  if (!("settings" in input)) {
    throw new HttpError(400, "BAD_REQUEST", "Session settings are required.");
  }
  let requestId: string | undefined;
  if ("requestId" in input) {
    const parsedRequestId = RequestIdSchema.safeParse(input.requestId);
    if (!parsedRequestId.success) {
      throw new HttpError(400, "BAD_REQUEST", "Request ID is invalid.");
    }
    requestId = parsedRequestId.data;
  }
  return { settings: input.settings, ...(requestId ? { requestId } : {}) };
}

function parseSettings(input: unknown, rosterSize: number): GameSettings {
  try {
    return validateMatchCapacity(input, rosterSize);
  } catch (error) {
    if (error instanceof ZodError) {
      const terrainIssue = error.issues.find(issue =>
        issue.path[0] === "terrainDensity" || issue.path[0] === "mapMode");
      if (terrainIssue) {
        throw new HttpError(422, "INVALID_SETTINGS",
          `${terrainIssue.path.join(".")}: ${terrainIssue.message}`.slice(0, 512));
      }
      throw new HttpError(422, "INVALID_SETTINGS", "Session settings are invalid.");
    }
    if (error instanceof RangeError) {
      throw new HttpError(422, "INVALID_SETTINGS", "Session settings exceed supported capacity.");
    }
    throw error;
  }
}

function parseStoredSettings(input: string): GameSettings {
  try {
    return GameSettingsSchema.parse(JSON.parse(input));
  } catch {
    throw new Error("Stored session settings are invalid.");
  }
}

function readSettings(database: SqliteDatabase, sessionId: string): GameSettings {
  const row = database.prepare("SELECT settings_json FROM matches WHERE id = ?").get(sessionId) as
    | { settings_json: string }
    | undefined;
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Session not found.");
  }
  return parseStoredSettings(row.settings_json);
}

function parseSettingsUpdate(input: unknown): { settings: unknown; expectedRevision: number } {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !["settings", "expectedRevision"].includes(key)) ||
    !("settings" in input) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) < 0
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Request body is invalid.");
  }
  return { settings: input.settings, expectedRevision: input.expectedRevision as number };
}

function parseExpectedRevision(input: unknown): number {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => key !== "expectedRevision") ||
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) < 0
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Request body is invalid.");
  }
  return input.expectedRevision as number;
}

function assertCreator(row: SessionRow, account: AuthenticatedAccount): void {
  if (row.creator_account_id !== account.id) {
    throw new HttpError(403, "FORBIDDEN", "Only the session creator may perform this action.");
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
