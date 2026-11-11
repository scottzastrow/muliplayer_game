import { GameSettingsSchema } from "@multiplayer-game/protocol";
import { HttpError } from "../errors.js";
import type { SqliteDatabase } from "../storage/database.js";

export interface PlayerFollowState {
  readonly connected: boolean;
  readonly life: "alive" | "dead" | "unavailable";
}

export interface FollowablePlayer extends PlayerFollowState {
  readonly accountId: string;
  readonly username: string;
  readonly followable: boolean;
}

interface Spectator {
  readonly accountId: string;
  targetAccountId: string | null;
  connection?: symbol;
  targetUnavailable?: boolean;
}

export class SpectatorRegistry {
  readonly #sessions = new Map<string, Map<string, Spectator>>();

  constructor(
    readonly database: SqliteDatabase,
    readonly playerStates: (sessionId: string) => ReadonlyMap<string, PlayerFollowState> =
      () => new Map()
  ) {}

  count(sessionId: string): number {
    return this.#sessions.get(sessionId)?.size ?? 0;
  }

  has(sessionId: string, accountId: string): boolean {
    return this.#sessions.get(sessionId)?.has(accountId) ?? false;
  }

  admit(sessionId: string, accountId: string) {
    const settings = this.#runningSettings(sessionId);
    if (this.#isPlayer(sessionId, accountId)) {
      throw new HttpError(403, "FORBIDDEN", "Players cannot also spectate their own session.");
    }
    let spectators = this.#sessions.get(sessionId);
    const existing = spectators?.get(accountId);
    if (!existing) {
      if (this.count(sessionId) >= settings.maxSpectators) {
        throw new HttpError(409, "SPECTATOR_CAPACITY", "The session spectator capacity is full or disabled.");
      }
      if (!spectators) {
        spectators = new Map();
        this.#sessions.set(sessionId, spectators);
      }
      spectators.set(accountId, { accountId, targetAccountId: null });
    }
    try {
      return this.view(sessionId, accountId);
    } catch (error) {
      if (!existing) this.leave(sessionId, accountId);
      throw error;
    }
  }

  view(sessionId: string, accountId: string) {
    const players = this.players(sessionId, accountId);
    const spectator = this.#sessions.get(sessionId)?.get(accountId);
    this.refreshTarget(sessionId, accountId, players);
    return {
      spectator: spectator
        ? { accountId: spectator.accountId, targetAccountId: spectator.targetAccountId }
        : null,
      players
    };
  }

  players(sessionId: string, accountId: string): FollowablePlayer[] {
    this.#runningSettings(sessionId);
    if (!this.has(sessionId, accountId) && !this.#isPlayer(sessionId, accountId)) {
      throw new HttpError(403, "FORBIDDEN", "Session membership is required to view players.");
    }
    const rows = this.database.prepare(
      `SELECT p.account_id, a.username FROM match_participants p
       JOIN accounts a ON a.id = p.account_id WHERE p.match_id = ?
       ORDER BY p.joined_order, p.account_id`
    ).all(sessionId) as Array<{ account_id: string; username: string }>;
    const states = this.playerStates(sessionId);
    return rows.map(row => {
      const state = states.get(row.account_id) ?? { connected: false, life: "unavailable" as const };
      return {
        accountId: row.account_id,
        username: row.username,
        ...state,
        followable: state.connected && state.life !== "unavailable"
      };
    });
  }

  selectTarget(sessionId: string, accountId: string, targetAccountId: string): string {
    this.#runningSettings(sessionId);
    const spectator = this.#sessions.get(sessionId)?.get(accountId);
    if (!spectator) {
      throw new HttpError(403, "FORBIDDEN", "Spectator membership is required to select a target.");
    }
    const target = this.players(sessionId, accountId).find(player => player.accountId === targetAccountId);
    if (!target?.followable) {
      throw new HttpError(403, "FORBIDDEN", "The selected player cannot be followed in this session.");
    }
    spectator.targetAccountId = target.accountId;
    delete spectator.targetUnavailable;
    return target.accountId;
  }

  refreshTarget(sessionId: string, accountId: string, players: readonly FollowablePlayer[]): string | null {
    const spectator = this.#sessions.get(sessionId)?.get(accountId);
    if (!spectator) return null;
    if (spectator.targetAccountId &&
      !players.some(player => player.accountId === spectator.targetAccountId && player.followable)) {
      spectator.targetAccountId = null;
      spectator.targetUnavailable = true;
    }
    return spectator.targetAccountId;
  }

  takeTargetUnavailable(sessionId: string, accountId: string): boolean {
    const spectator = this.#sessions.get(sessionId)?.get(accountId);
    if (!spectator?.targetUnavailable) return false;
    delete spectator.targetUnavailable;
    return true;
  }

  attach(sessionId: string, accountId: string): symbol {
    this.#runningSettings(sessionId);
    const spectator = this.#sessions.get(sessionId)?.get(accountId);
    if (!spectator) {
      throw new HttpError(403, "FORBIDDEN", "Spectator membership is required.");
    }
    const connection = Symbol("spectator connection");
    spectator.connection = connection;
    return connection;
  }

  detach(sessionId: string, accountId: string, connection: symbol): void {
    if (this.#sessions.get(sessionId)?.get(accountId)?.connection === connection) {
      this.leave(sessionId, accountId);
    }
  }

  leave(sessionId: string, accountId: string): void {
    const spectators = this.#sessions.get(sessionId);
    spectators?.delete(accountId);
    if (spectators?.size === 0) this.#sessions.delete(sessionId);
  }

  releaseSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  #runningSettings(sessionId: string) {
    const match = this.database.prepare("SELECT state, settings_json FROM matches WHERE id = ?")
      .get(sessionId) as { state: string; settings_json: string } | undefined;
    if (!match) throw new HttpError(404, "NOT_FOUND", "Session not found.");
    if (match.state !== "running") {
      throw new HttpError(409, "ALREADY_STARTED", "Spectating requires a running session.");
    }
    return GameSettingsSchema.parse(JSON.parse(match.settings_json));
  }

  #isPlayer(sessionId: string, accountId: string): boolean {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM match_participants WHERE match_id = ? AND account_id = ?"
    ).get(sessionId, accountId));
  }
}
