import type { ModuleContext, Point2 } from "@multiplayer-game/theme-sdk";
import {
  MAX_PROJECTILES_PER_SESSION,
  MAX_ATTRACTION_QUERY_CELLS,
  PLAYER_BULLET_DAMAGE,
  PLAYER_FIRE_RATE_PER_SECOND,
  PLAYER_RAPID_FIRE_RATE_PER_SECOND,
  PLAYER_SHOT_SPEED,
  PROJECTILE_LIFETIME_TICKS,
  PROJECTILE_RADIUS,
  SPREAD_ANGLE_RADIANS,
  NPC_FIRE_COOLDOWN_TICKS, NPC_SHOT_DAMAGE, NPC_SHOT_SPEED, NPC_FRONT_SIZE,
  NPC_SHOT_RANGE, NPC_KEEP_DISTANCE, MAX_NPC_ATTACKERS_PER_PLAYER
} from "./tuning.js";
import { hasNpcShot, NPC_PROJECTILE_RADIUS } from "./npc-shot.js";
import { DefaultPickupSimulator } from "./pickups.js";
import type {
  DefaultEntity,
  DefaultNpcState,
  DefaultPlayerState,
  DefaultProjectileState
} from "./types.js";

const SIMULATION_HZ = 30;
const MAX_PROJECTILE_QUERY_CELLS = 64;
const MAX_PROJECTILE_STEP_DISTANCE = PROJECTILE_RADIUS;

export class DefaultCombatSimulator {
  readonly #lastShotTick = new Map<string, number>();
  readonly #lastNpcShotTick = new Map<string, number>();
  readonly #fireInputs = new Map<string, Readonly<{ aim: Point2; fire: boolean }>>();
  readonly #pickups: DefaultPickupSimulator;
  #nextProjectileId = 0;
  #disposed = false;

  constructor(
    readonly context: ModuleContext<DefaultEntity>,
    readonly awardKill?: (accountId: string) => void
  ) {
    this.#pickups = new DefaultPickupSimulator(context);
  }

  step(tick: number): void {
    this.#assertActive();
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RangeError("Combat tick must be a nonnegative safe integer.");
    }
    this.#pickups.expireEffects(tick);
    this.#fire(tick);
    this.#fireNpcs(tick);
    this.#moveProjectiles(tick);
    this.#pickups.claimAvailable(tick);
  }

  applyInput(accountId: string, aim: Point2, fire: boolean): void {
    this.#assertActive();
    if (
      !Number.isFinite(aim.x) ||
      !Number.isFinite(aim.y)
    ) {
      throw new TypeError("Firing input must contain finite aim coordinates.");
    }
    this.#fireInputs.set(accountId, Object.freeze({ aim: Object.freeze({ ...aim }), fire }));
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    for (const entity of this.context.entities.values()) {
      if (entity.state.kind === "projectile") {
        this.context.entities.remove(entity.id);
      }
    }
    this.#lastShotTick.clear();
    this.#lastNpcShotTick.clear();
    this.#fireInputs.clear();
    this.#disposed = true;
  }

  clearProjectiles(): void {
    this.#assertActive();
    for (const entity of this.context.entities.values()) {
      if (entity.state.kind === "projectile") {
        this.context.entities.remove(entity.id);
      }
    }
    for (const [accountId, input] of this.#fireInputs) {
      this.#fireInputs.set(accountId, Object.freeze({ aim: input.aim, fire: false }));
    }
  }

  resetPlayerInput(accountId: string): void {
    this.#fireInputs.delete(accountId);
  }

  #fire(tick: number): void {
    for (const [accountId, input] of this.#fireInputs) {
      if (!input.fire) {
        continue;
      }
      const player = this.#findPlayer(accountId);
      if (!player || player.state.health <= 0) {
        continue;
      }
      const direction = normalize({
        x: input.aim.x - player.position.x,
        y: input.aim.y - player.position.y
      });
      if (!direction) {
        continue;
      }
      const rapidFire = (player.state.effects?.rapidFireExpiresAtTick ?? -1) > tick;
      const shotsPerSecond = rapidFire
        ? PLAYER_RAPID_FIRE_RATE_PER_SECOND
        : PLAYER_FIRE_RATE_PER_SECOND;
      const cooldownTicks = Math.ceil(SIMULATION_HZ / shotsPerSecond);
      const previousTick = this.#lastShotTick.get(accountId) ?? -Infinity;
      if (tick - previousTick < cooldownTicks) {
        continue;
      }

      const spread = (player.state.effects?.spreadExpiresAtTick ?? -1) > tick;
      const directions = spread
        ? [
            rotate(direction, -SPREAD_ANGLE_RADIANS),
            direction,
            rotate(direction, SPREAD_ANGLE_RADIANS)
          ]
        : [direction];
      if (this.#projectileCount() + directions.length > MAX_PROJECTILES_PER_SESSION) {
        this.context.metrics.increment("default.projectile.rejected_cap");
        continue;
      }

      this.#lastShotTick.set(accountId, tick);
      for (const shotDirection of directions) {
        this.#spawnProjectile(accountId, player.position, shotDirection, tick);
      }
    }
  }

  #spawnProjectile(
    accountId: string,
    position: Point2,
    direction: Point2,
    tick: number
  ): void {
    const id = `projectile:${this.#nextProjectileId}`;
    this.#nextProjectileId += 1;
    const state: DefaultProjectileState = {
      kind: "projectile",
      ownerAccountId: accountId,
      damage: PLAYER_BULLET_DAMAGE,
      velocity: {
        x: direction.x * PLAYER_SHOT_SPEED,
        y: direction.y * PLAYER_SHOT_SPEED
      },
      expiresAtTick: tick + PROJECTILE_LIFETIME_TICKS
    };
    this.context.entities.add({
      id,
      typeId: "projectile.player",
      position,
      radius: PROJECTILE_RADIUS,
      state
    });
  }

  #fireNpcs(tick: number): void {
    for (const id of this.#lastNpcShotTick.keys()) {
      if (this.context.entities.get(id)?.state.kind !== "npc") this.#lastNpcShotTick.delete(id);
    }
    const attackers = new Map<string, number>();
    for (const npc of this.context.entities.values()) {
      if (npc.state.kind !== "npc" || npc.state.health <= 0 ||
        !npc.state.targetId || !npc.state.readyToFire || !npc.state.facing) continue;
      const target = this.context.entities.get(npc.state.targetId);
      if (target?.state.kind !== "player" || target.state.health <= 0) continue;
      const count = attackers.get(target.id) ?? 0;
      if (count >= MAX_NPC_ATTACKERS_PER_PLAYER) continue;
      attackers.set(target.id, count + 1);
      const range = distance(npc.position, target.position);
      if (range < NPC_KEEP_DISTANCE || range > NPC_SHOT_RANGE ||
        !hasNpcShot(this.context, npc.position, target.position)) continue;
      const previousTick = this.#lastNpcShotTick.get(npc.id) ?? -Infinity;
      if (tick - previousTick < NPC_FIRE_COOLDOWN_TICKS) continue;
      if (this.#projectileCount() >= MAX_PROJECTILES_PER_SESSION) {
        this.context.metrics.increment("default.projectile.rejected_cap");
        continue;
      }
      const direction = npc.state.facing;
      const muzzle = {
        x: npc.position.x + direction.x * (npc.radius + NPC_FRONT_SIZE / 2),
        y: npc.position.y + direction.y * (npc.radius + NPC_FRONT_SIZE / 2)
      };
      if (!hasNpcShot(this.context, npc.position, muzzle)) continue;
      this.#lastNpcShotTick.set(npc.id, tick);
      this.context.entities.add({
        id: `projectile:${this.#nextProjectileId++}`, typeId: "projectile.npc",
        position: muzzle, radius: NPC_PROJECTILE_RADIUS,
        state: {
          kind: "projectile", ownerAccountId: "", ownerNpcId: npc.id,
          damage: NPC_SHOT_DAMAGE,
          velocity: { x: direction.x * NPC_SHOT_SPEED, y: direction.y * NPC_SHOT_SPEED },
          expiresAtTick: tick + PROJECTILE_LIFETIME_TICKS
        }
      });
    }
  }

  #moveProjectiles(tick: number): void {
    const projectiles = this.context.entities.values().filter(
      (entity): entity is DefaultEntity & { state: DefaultProjectileState } =>
        entity.state.kind === "projectile"
    );
    for (const projectile of projectiles) {
      if (tick >= projectile.state.expiresAtTick) {
        this.context.entities.remove(projectile.id);
        continue;
      }
      const delta = {
        x: projectile.state.velocity.x / SIMULATION_HZ,
        y: projectile.state.velocity.y / SIMULATION_HZ
      };
      const stepCount = Math.ceil(Math.hypot(delta.x, delta.y) / MAX_PROJECTILE_STEP_DISTANCE);
      let previous = projectile.position;
      let removed = false;
      for (let index = 1; index <= stepCount; index += 1) {
        const desired = {
          x: projectile.position.x + (delta.x * index) / stepCount,
          y: projectile.position.y + (delta.y * index) / stepCount
        };
        if (
          !this.context.geometry.isWalkable(desired.x, desired.y, projectile.radius) ||
          this.context.geometry.intersectsObstacle(desired.x, desired.y, projectile.radius)
        ) {
          this.context.entities.remove(projectile.id);
          removed = true;
          break;
        }

        const nearbyTargets = this.context.entities
          .queryRadius(
            desired,
            Math.hypot(desired.x - previous.x, desired.y - previous.y) + 32,
            MAX_PROJECTILE_QUERY_CELLS
          )
          .filter(
            (entity): entity is DefaultEntity & { state: DefaultNpcState | DefaultPlayerState } =>
              projectile.state.ownerNpcId !== undefined
                ? entity.state.kind === "player" && entity.state.health > 0
                : entity.state.kind === "npc" && entity.state.health > 0
          );
        const hit = nearestSegmentHit(previous, desired, nearbyTargets, projectile.radius);
        if (hit) {
          if (hit.state.kind === "player") {
            this.context.entities.update(hit.id, current => current.state.kind === "player"
              ? { ...current, state: { ...current.state,
                health: Math.max(0, current.state.health - projectile.state.damage) } }
              : current);
          } else {
            this.#applyHit(projectile, { ...hit, state: hit.state });
          }
          this.context.entities.remove(projectile.id);
          removed = true;
          break;
        }
        previous = desired;
      }
      if (!removed) {
        this.context.entities.update(projectile.id, (current) => ({
          ...current,
          position: previous
        }));
      }
    }
  }

  #applyHit(
    projectile: DefaultEntity & { state: DefaultProjectileState },
    npc: DefaultEntity & { state: DefaultNpcState }
  ): void {
    const remainingHealth = npc.state.health - projectile.state.damage;
    if (remainingHealth > 0) {
      this.context.entities.update(npc.id, (current) => {
        if (current.state.kind !== "npc") {
          return current;
        }
        return { ...current, state: { ...current.state, health: remainingHealth } };
      });
      return;
    }

    this.context.entities.remove(npc.id);
    if (this.awardKill) {
      this.awardKill(projectile.state.ownerAccountId);
      return;
    }
    const player = this.#findPlayer(projectile.state.ownerAccountId);
    if (!player) {
      return;
    }
    this.context.entities.update(player.id, (current) => {
      if (current.state.kind !== "player") {
        return current;
      }
      return {
        ...current,
        state: {
          ...current.state,
          points: current.state.points + 100,
          kills: current.state.kills + 1
        }
      };
    });
  }

  #findPlayer(accountId: string):
    | (DefaultEntity & { state: DefaultPlayerState })
    | undefined {
    return this.context.entities.values().find(
      (entity): entity is DefaultEntity & { state: DefaultPlayerState } =>
        entity.state.kind === "player" && entity.state.accountId === accountId
    );
  }

  #projectileCount(): number {
    let count = 0;
    for (const entity of this.context.entities.values()) {
      if (entity.state.kind === "projectile") {
        count += 1;
      }
    }
    return count;
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Default combat simulator has been disposed.");
    }
  }
}

function nearestSegmentHit(
  start: Point2,
  end: Point2,
  npcs: readonly (DefaultEntity & { state: DefaultNpcState | DefaultPlayerState })[],
  projectileRadius: number
): (DefaultEntity & { state: DefaultNpcState | DefaultPlayerState }) | undefined {
  let nearest: (DefaultEntity & { state: DefaultNpcState | DefaultPlayerState }) | undefined;
  let nearestT = Infinity;
  for (const npc of npcs) {
    const t = segmentProjection(start, end, npc.position);
    const closest = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    };
    if (distance(closest, npc.position) <= npc.radius + projectileRadius && t < nearestT) {
      nearest = npc;
      nearestT = t;
    }
  }
  return nearest;
}

function segmentProjection(start: Point2, end: Point2, point: Point2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
}

function normalize(vector: Point2): Point2 | undefined {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0 || !Number.isFinite(magnitude)) {
    return undefined;
  }
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

function rotate(vector: Point2, angle: number): Point2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine
  };
}

function distance(from: Point2, to: Point2): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}
