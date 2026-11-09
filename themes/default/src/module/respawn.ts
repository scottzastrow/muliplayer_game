import { MAP_CELL_SIZE, type ModuleContext, type Point2, type RosterMember } from "@multiplayer-game/theme-sdk";
import type { JsonValue } from "@multiplayer-game/protocol";
import type { LoadedMap } from "./maps.js";
import type { DefaultEntity, DefaultPlayerState } from "./types.js";
import {
  PLAYER_HEALTH, PLAYER_RADIUS, SAFE_SPAWN_MARGIN, MAX_RESPAWN_ATTEMPTS_PER_PLAYER
} from "./tuning.js";

type PlayerEntity = DefaultEntity & { readonly state: DefaultPlayerState };

interface PendingRespawn {
  readonly respawnAtTick: number;
  blocked: boolean;
}

export class DefaultRespawnSimulator {
  readonly #players = new Map<string, PlayerEntity>();
  readonly #pending = new Map<string, PendingRespawn>();
  readonly #disconnected = new Set<string>();
  readonly #expired = new Set<string>();
  readonly #returning = new Set<string>();
  readonly #delayTicks: number;

  constructor(
    readonly context: ModuleContext<DefaultEntity>,
    public map: LoadedMap,
    readonly roster: readonly RosterMember[],
    delaySeconds: number,
    readonly resetInput: (accountId: string) => void
  ) {
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > 60) {
      throw new RangeError("Respawn delay must be between zero and sixty seconds.");
    }
    this.#delayTicks = Math.ceil(delaySeconds * 30);
  }

  initialize(): void {
    for (const member of this.roster) {
      const entity = this.context.entities.get(`player:${member.accountId}`);
      if (!entity || entity.state.kind !== "player") {
        throw new Error("Respawn initialization requires every roster player's entity.");
      }
      this.#players.set(member.accountId, { ...entity, state: entity.state });
    }
  }

  setMap(map: LoadedMap): void {
    this.map = map;
    for (const [accountId, previous] of this.#players) {
      const live = this.context.entities.get(previous.id);
      if (live?.state.kind === "player") {
        this.#players.set(accountId, { ...live, state: live.state });
      } else {
        const spawn = map.definition.spawns.filter(item => item.kind === "player")
          [this.roster.findIndex(member => member.accountId === accountId)];
        if (!spawn) throw new Error("New map has no roster respawn position.");
        this.#players.set(accountId, { ...previous, position: spawn.position });
      }
    }
  }

  removeDefeated(tick: number): void {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError("Respawn tick must be a nonnegative safe integer.");
    }
    for (const [accountId, previous] of this.#players) {
      const entity = this.context.entities.get(previous.id);
      if (!entity || entity.state.kind !== "player") continue;
      if (entity.state.health > 0) {
        this.#players.set(accountId, { ...entity, state: entity.state });
        continue;
      }
      const defeated: PlayerEntity = {
        ...entity,
        state: { ...entity.state, deaths: entity.state.deaths + 1 }
      };
      this.#players.set(accountId, defeated);
      this.#pending.set(accountId, {
        respawnAtTick: tick + this.#delayTicks,
        blocked: false
      });
      this.context.entities.remove(entity.id);
      this.resetInput(accountId);
    }
  }

  respawnEligible(tick: number): void {
    const candidates = new Set([...this.#pending.keys(), ...this.#returning]);
    for (const accountId of candidates) {
      const pending = this.#pending.get(accountId);
      if (this.#disconnected.has(accountId) || this.#expired.has(accountId) ||
        (pending && tick < pending.respawnAtTick)) continue;
      const player = this.#players.get(accountId)!;
      const position = this.#safePosition(player.radius, pending ? undefined : player.position);
      if (!position) {
        if (pending) pending.blocked = true;
        this.context.metrics.increment("default.respawn.blocked");
        continue;
      }
      const returned: PlayerEntity = {
        ...player,
        position,
        state: { ...player.state, health: pending ? PLAYER_HEALTH : player.state.health }
      };
      this.resetInput(accountId);
      this.context.entities.add(returned);
      this.#players.set(accountId, returned);
      this.#pending.delete(accountId);
      this.#returning.delete(accountId);
    }
  }

  isDefeated(accountId: string): boolean {
    return this.#pending.has(accountId) || this.#disconnected.has(accountId) ||
      this.#expired.has(accountId) || this.#returning.has(accountId);
  }

  setPresence(accountId: string, presence: "connected" | "disconnected" | "expired", tick: number): void {
    const player = this.#players.get(accountId);
    if (!player) throw new RangeError("Presence account is not in the frozen roster.");
    if (presence === "connected") {
      if (this.#expired.has(accountId)) throw new Error("Expired participation cannot be restored.");
      if (!this.#disconnected.delete(accountId)) return;
      this.#returning.add(accountId);
      this.respawnEligible(tick);
      return;
    }
    this.removeDefeated(tick);
    const live = this.context.entities.get(player.id);
    if (live?.state.kind === "player") this.#players.set(accountId, { ...live, state: live.state });
    this.context.entities.remove(player.id);
    this.resetInput(accountId);
    this.#disconnected.add(accountId);
    if (presence === "expired") this.#expired.add(accountId);
  }

  awardKill(accountId: string): void {
    const player = this.#players.get(accountId);
    if (!player) throw new RangeError("Kill credit account is not in the session roster.");
    const live = this.context.entities.get(player.id);
    if (live?.state.kind === "player") {
      this.context.entities.update(player.id, (entity) => {
        if (entity.state.kind !== "player") throw new Error("Player entity changed type.");
        return {
          ...entity,
          state: { ...entity.state, points: entity.state.points + 100, kills: entity.state.kills + 1 }
        };
      });
    } else {
      this.#players.set(accountId, {
        ...player,
        state: { ...player.state, points: player.state.points + 100, kills: player.state.kills + 1 }
      });
    }
  }

  playerStates(): readonly DefaultPlayerState[] {
    return [...this.#players.values()].map((player) => {
      const live = this.context.entities.get(player.id);
      return live?.state.kind === "player" ? live.state : player.state;
    });
  }

  snapshot(): JsonValue[] {
    return [...this.#players.entries()].map(([accountId, player]) => {
      const live = this.context.entities.get(player.id);
      const pending = this.#pending.get(accountId);
      const state = live?.state.kind === "player" ? live.state : player.state;
      return {
        ...structuredClone(state),
        position: { ...(live?.position ?? player.position) },
        alive: pending === undefined && !this.#returning.has(accountId),
        connected: !this.#disconnected.has(accountId),
        expired: this.#expired.has(accountId),
        ...(pending ? { respawnAtTick: pending.respawnAtTick, respawnBlocked: pending.blocked } :
          this.#returning.has(accountId) ? { respawnAtTick: 0, respawnBlocked: true } : {})
      };
    });
  }

  dispose(): void {
    this.#players.clear();
    this.#pending.clear();
    this.#disconnected.clear();
    this.#expired.clear();
    this.#returning.clear();
  }

  #safePosition(radius: number, preferred?: Point2): Point2 | undefined {
    const clearance = radius + SAFE_SPAWN_MARGIN;
    if (preferred && this.#isSafe(preferred, clearance)) return preferred;
    const inset = Math.ceil(clearance / MAP_CELL_SIZE - 0.5);
    const columns = this.map.definition.bounds.width / MAP_CELL_SIZE - 2 * inset;
    const rows = this.map.definition.bounds.height / MAP_CELL_SIZE - 2 * inset;
    if (columns <= 0 || rows <= 0) return undefined;
    const cellCount = columns * rows;
    const random = this.context.random.next();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new RangeError("The session random source must return a number in [0, 1).");
    }
    const firstCell = Math.floor(random * cellCount);
    for (let attempt = 0; attempt < Math.min(MAX_RESPAWN_ATTEMPTS_PER_PLAYER, cellCount); attempt += 1) {
      const cell = (firstCell + attempt) % cellCount;
      const position = {
        x: ((cell % columns) + inset + 0.5) * MAP_CELL_SIZE,
        y: (Math.floor(cell / columns) + inset + 0.5) * MAP_CELL_SIZE
      };
      if (!this.#isSafe(position, clearance)) continue;
      return position;
    }
    return undefined;
  }

  #isSafe(position: Point2, clearance: number): boolean {
    if (!this.map.isWalkable(position, clearance) ||
      !this.context.geometry.isWalkable(position.x, position.y, clearance) ||
      this.context.geometry.intersectsObstacle(position.x, position.y, clearance)) return false;
    return !this.context.entities.queryRadius(position, clearance + PLAYER_RADIUS, 64).some(entity =>
      (entity.state.kind === "npc" || entity.state.kind === "projectile" || entity.state.kind === "player") &&
      Math.hypot(position.x - entity.position.x, position.y - entity.position.y) <= clearance + entity.radius);
  }
}
