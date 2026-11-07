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
  readonly #delayTicks: number;

  constructor(
    readonly context: ModuleContext<DefaultEntity>,
    readonly map: LoadedMap,
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
    for (const [accountId, pending] of this.#pending) {
      if (tick < pending.respawnAtTick) continue;
      const player = this.#players.get(accountId)!;
      const position = this.#safePosition(player.radius);
      if (!position) {
        pending.blocked = true;
        this.context.metrics.increment("default.respawn.blocked");
        continue;
      }
      const returned: PlayerEntity = {
        ...player,
        position,
        state: { ...player.state, health: PLAYER_HEALTH }
      };
      this.resetInput(accountId);
      this.context.entities.add(returned);
      this.#players.set(accountId, returned);
      this.#pending.delete(accountId);
    }
  }

  isDefeated(accountId: string): boolean {
    return this.#pending.has(accountId);
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
        alive: pending === undefined,
        ...(pending ? { respawnAtTick: pending.respawnAtTick, respawnBlocked: pending.blocked } : {})
      };
    });
  }

  dispose(): void {
    this.#players.clear();
    this.#pending.clear();
  }

  #safePosition(radius: number): Point2 | undefined {
    const clearance = radius + SAFE_SPAWN_MARGIN;
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
      if (
        !this.map.isWalkable(position, clearance) ||
        !this.context.geometry.isWalkable(position.x, position.y, clearance) ||
        this.context.geometry.intersectsObstacle(position.x, position.y, clearance)
      ) continue;
      const hazards = this.context.entities.queryRadius(position, clearance + PLAYER_RADIUS, 64);
      if (hazards.some((entity) =>
        (entity.state.kind === "npc" || entity.state.kind === "projectile" || entity.state.kind === "player") &&
        Math.hypot(position.x - entity.position.x, position.y - entity.position.y) <=
          clearance + entity.radius
      )) continue;
      return position;
    }
    return undefined;
  }
}
