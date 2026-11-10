import type {
  ModuleContext,
  MapSpawn,
  Point2,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import { MAP_CELL_SIZE } from "@multiplayer-game/theme-sdk";
import {
  DEFAULT_RUNTIME_LIMITS,
  GameSettingsSchema,
  type JsonValue
} from "@multiplayer-game/protocol";
import {
  NPC_ATTRACTION_RADIUS,
  NPC_CONTACT_COOLDOWN_TICKS,
  NPC_CONTACT_DAMAGE,
  NPC_AWARENESS_RANGE_FACTOR,
  NPC_SHOT_RANGE,
  NPC_KEEP_DISTANCE,
  NPC_TURN_RADIANS_PER_SECOND,
  NPC_FIRE_COOLDOWN_TICKS,
  NPC_SHOT_DAMAGE,
  MAX_NPC_ATTACKERS_PER_PLAYER,
  NPC_REPATH_INTERVAL_TICKS,
  NPC_SPEED,
  PLAYER_HEALTH,
  MAX_PICKUPS_PER_SESSION,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_FACING_MOVEMENT_BLEND,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  MAX_PENDING_NPC_PATHS,
  MAX_ATTRACTION_QUERY_CELLS,
  NPC_EXPLORE_SPEED_FACTOR,
  NPC_EXPLORE_MAP_DISTANCE_FACTOR,
  NPC_EXPLORE_REGION_SIZE,
  NPC_EXPLORE_PAUSE_TICKS,
  NPC_EXPLORE_STUCK_TICKS,
  MAX_NPC_EXPLORE_CANDIDATES
} from "./tuning.js";
import type { DefaultPlayerAction } from "./actions.js";
import type {
  DefaultEntity,
  DefaultFacing,
  DefaultNpcState,
  DefaultPlayerState
} from "./types.js";
import type { LoadedMap } from "./maps.js";
import { selectNpcSpawns } from "./npc-spawns.js";
import { hasNpcShot } from "./npc-shot.js";
import { PLAYER_COLORS } from "../colors.js";

export interface DefaultContactAttackCapability extends Record<string, JsonValue> {
  readonly typeId: "default.contact-attack";
  readonly damage: number;
  readonly cooldownTicks: number;
}

/** @deprecated Retained for old consumers; the simulator never applies contact damage. */
export const defaultContactAttackCapability: DefaultContactAttackCapability =
  Object.freeze({
    typeId: "default.contact-attack",
    damage: NPC_CONTACT_DAMAGE,
    cooldownTicks: NPC_CONTACT_COOLDOWN_TICKS
  });

interface NpcNavigationState {
  targetId?: string;
  requestId?: string;
  goalVersion: number;
  requestVersion?: number;
  pauseUntilTick?: number;
  path?: readonly Point2[];
  nextPathPoint: number;
  lastRequestTick: number;
  /** Explore is the default state whenever no pursuit slot is assigned. */
  readonly home: Point2;
  readonly visitedAt: Map<number, number>;
  exploreGoal?: Point2;
  exploreDistanceScale: number;
  bestGoalDistance: number;
  progressTick: number;
}

function newNavigation(home: Point2): NpcNavigationState {
  return {
    nextPathPoint: 0, lastRequestTick: -Infinity, goalVersion: 0,
    home, visitedAt: new Map(), exploreDistanceScale: 1,
    bestGoalDistance: Infinity, progressTick: 0
  };
}

const EMPTY_MOVEMENT = Object.freeze({ x: 0, y: 0 });
const DEFAULT_FACING: DefaultFacing = Object.freeze({ x: 1, y: 0 });

export class DefaultEntitySimulator {
  readonly #movementByAccount = new Map<string, Point2>();
  readonly #firstPersonAccounts = new Set<string>();
  readonly #npcNavigation = new Map<string, NpcNavigationState>();
  readonly #playerIds = new Map<string, string>();
  readonly #pickupIds = new Set<string>();
  #map: LoadedMap | undefined;
  #roster: readonly RosterMember[] = [];
  #initialized = false;
  #disposed = false;

  constructor(
    readonly context: ModuleContext<DefaultEntity>,
    readonly npcMovementSpeed = NPC_SPEED,
    readonly npcDetectionRange = NPC_ATTRACTION_RADIUS,
    readonly seed = 0
  ) {
    GameSettingsSchema.shape.npcMovementSpeed.parse(npcMovementSpeed);
    GameSettingsSchema.shape.npcDetectionRange.parse(npcDetectionRange);
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("NPC placement seed must be a safe integer.");
    }
  }

  initialize(
    map: LoadedMap,
    roster: readonly RosterMember[],
    initialNpcCount?: number,
    initialNpcHealth = 100
  ): void {
    this.#assertActive();
    if (this.#initialized) {
      throw new Error("Default entity simulator is already initialized.");
    }

    const playerSpawns = map.definition.spawns.filter((spawn) => spawn.kind === "player");
    if (roster.length > playerSpawns.length) {
      throw new RangeError("Map does not provide enough player spawns for the session roster.");
    }
    if (roster.length > PLAYER_COLORS.length) {
      throw new RangeError("The default theme supports at most 32 distinct player colors.");
    }
    for (const [index, member] of roster.entries()) {
      const spawn = playerSpawns[index]!;
      const id = `player:${member.accountId}`;
      const state: DefaultPlayerState = {
        kind: "player",
        accountId: member.accountId,
        health: PLAYER_HEALTH,
        points: 0,
        kills: 0,
        deaths: 0,
        color: PLAYER_COLORS[index]!,
        facing: DEFAULT_FACING
      };
      this.context.entities.add({
        id,
        typeId: "player",
        position: spawn.position,
        radius: PLAYER_RADIUS,
        state
      });
      this.#playerIds.set(member.accountId, id);
      this.#movementByAccount.set(member.accountId, EMPTY_MOVEMENT);
    }

    this.#map = map;
    this.#roster = Object.freeze([...roster]);
    const npcSpawns = map.definition.spawns.filter((candidate) => candidate.kind === "npc");
    this.#spawnNpcs(
      initialNpcCount ?? npcSpawns.length,
      initialNpcHealth,
      1,
      npcSpawns
    );
    const pickupSpawns = map.definition.spawns.filter((candidate) => candidate.kind === "pickup");
    if (pickupSpawns.length > MAX_PICKUPS_PER_SESSION) {
      this.context.metrics.increment("default.pickup.rejected_cap");
      throw new RangeError("Map exceeds the supported pickup limit.");
    }
    for (const spawn of pickupSpawns) {
      const pickupType = spawn.pickupType;
      if (!pickupType) {
        throw new TypeError(`Pickup spawn ${spawn.id} has no pickup type.`);
      }
      const pickupId = `pickup:${spawn.id}`;
      this.context.entities.add({
        id: pickupId,
        typeId: `pickup.${pickupType}`,
        position: spawn.position,
        radius: spawn.radius,
        state: { kind: "pickup", pickupType }
      });
      this.#pickupIds.add(pickupId);
    }
    this.#initialized = true;
  }

  startLevel(level: number, npcCount: number, npcHealth: number, nextMap?: LoadedMap): void {
    this.#assertInitialized();
    if (!Number.isSafeInteger(level) || level < 2) {
      throw new RangeError("Subsequent level number must be a safe integer of at least two.");
    }
    for (const id of this.#npcNavigation.keys()) {
      this.context.entities.remove(id);
    }
    this.#npcNavigation.clear();
    if (nextMap) this.#map = nextMap;
    const map = this.#map;
    if (!map) {
      throw new Error("Default entity simulator has no loaded map.");
    }
    this.#spawnNpcs(npcCount, npcHealth, level, []);
  }

  applyInput(accountId: string, action: Readonly<DefaultPlayerAction>): void {
    this.#assertInitialized();
    if (!this.#playerIds.has(accountId)) {
      throw new RangeError("Movement account is not part of this session.");
    }
    if (action.type === "combat") {
      this.#movementByAccount.set(accountId, normalizeMovement(action.moveX, action.moveY));
      if (action.controlMode === "first-person") this.#firstPersonAccounts.add(accountId);
      else this.#firstPersonAccounts.delete(accountId);
      const id = this.#playerIds.get(accountId);
      const player = id ? this.context.entities.get(id) : undefined;
      if (id && player?.state.kind === "player") {
        const facing = normalizedFacing({
          x: action.aimX - player.position.x,
          y: action.aimY - player.position.y
        });
        if (facing) {
          this.context.entities.update(id, (current) => current.state.kind === "player"
            ? { ...current, state: { ...current.state, facing } }
            : current);
        }
      }
    }
  }

  resetPlayerInput(accountId: string): void {
    this.#movementByAccount.set(accountId, EMPTY_MOVEMENT);
    this.#firstPersonAccounts.delete(accountId);
  }

  step(dtSeconds: number, tick: number): void {
    this.#assertInitialized();
    if (
      !Number.isFinite(dtSeconds) ||
      dtSeconds < 0 ||
      !Number.isSafeInteger(tick) ||
      tick < 0
    ) {
      throw new RangeError("Entity simulation step must have a finite duration and safe tick.");
    }
    this.#movePlayers(dtSeconds);
    this.#moveNpcs(dtSeconds, tick);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    for (const id of this.#playerIds.values()) {
      this.context.entities.remove(id);
    }
    for (const id of this.#npcNavigation.keys()) {
      this.context.entities.remove(id);
    }
    for (const id of this.#pickupIds) {
      this.context.entities.remove(id);
    }
    this.#movementByAccount.clear();
    this.#firstPersonAccounts.clear();
    this.#playerIds.clear();
    this.#npcNavigation.clear();
    this.#pickupIds.clear();
    this.#map = undefined;
    this.#roster = [];
    this.#disposed = true;
  }

  #spawnNpcs(
    npcCount: number,
    npcHealth: number,
    level: number,
    preferredSpawns: readonly MapSpawn[]
  ): void {
    if (
      !Number.isSafeInteger(npcCount) ||
      npcCount < 1 ||
      npcCount > DEFAULT_RUNTIME_LIMITS.maxNpcsPerSession ||
      !Number.isSafeInteger(npcHealth) ||
      npcHealth < 1 ||
      npcHealth > DEFAULT_RUNTIME_LIMITS.maxNpcHealth
    ) {
      throw new RangeError("Level NPC count or health exceeds the supported runtime ceiling.");
    }
    const map = this.#map;
    if (!map) {
      throw new Error("Default entity simulator has no loaded map.");
    }
    const existingPlayerPositions = this.#roster.flatMap((member) => {
      const player = this.context.entities.get(this.#playerIds.get(member.accountId)!);
      return player?.state.kind === "player" && player.state.health > 0 ? [player.position] : [];
    });
    const selected = selectNpcSpawns(
      this.context, map, existingPlayerPositions, this.seed, level, npcCount
    );
    for (const [index, position] of selected.entries()) {
      const preferredId = preferredSpawns[index]?.id;
      const id = preferredId && level === 1
        ? `npc:${preferredId}`
        : `npc:level-${level}-${String(index + 1).padStart(4, "0")}`;
      const state: DefaultNpcState = {
        kind: "npc",
        health: npcHealth,
        attackCapability: {
          typeId: "default.ranged-attack", damage: NPC_SHOT_DAMAGE,
          cooldownTicks: NPC_FIRE_COOLDOWN_TICKS
        },
        facing: DEFAULT_FACING,
        targetId: "",
        readyToFire: false
      };
      this.context.entities.add({
        id,
        typeId: "npc",
        position,
        radius: 8,
        state
      });
      this.#npcNavigation.set(id, newNavigation(position));
    }
  }

  #movePlayers(dtSeconds: number): void {
    for (const [accountId, id] of this.#playerIds) {
      const entity = this.context.entities.get(id);
      if (!entity || entity.state.kind !== "player" || entity.state.health <= 0) {
        continue;
      }
      let movement = this.#movementByAccount.get(accountId) ?? EMPTY_MOVEMENT;
      const magnitude = Math.hypot(movement.x, movement.y);
      if (magnitude > 0 && this.#firstPersonAccounts.has(accountId)) {
        const facing = entity.state.facing;
        const difference = Math.atan2(
          movement.x * facing.y - movement.y * facing.x,
          movement.x * facing.x + movement.y * facing.y
        );
        const angle = Math.atan2(movement.y, movement.x) + difference * PLAYER_FACING_MOVEMENT_BLEND;
        movement = { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
      }
      const moved = this.context.geometry.moveCircle(
        entity.position,
        { x: movement.x * PLAYER_SPEED * dtSeconds, y: movement.y * PLAYER_SPEED * dtSeconds },
        entity.radius
      );
      this.context.entities.update(id, (current) => ({ ...current, position: moved }));
    }
  }

  #moveNpcs(dtSeconds: number, tick: number): void {
    let pathRequests = 0;
    for (const id of this.#npcNavigation.keys()) {
      if (this.context.entities.get(id)?.state.kind !== "npc") {
        this.#npcNavigation.delete(id);
      }
    }
    const npcs = this.context.entities.values().filter(
      (entity): entity is DefaultEntity =>
        entity.state.kind === "npc" && entity.typeId === "npc" && entity.state.health > 0
    );
    const targets = this.#assignNpcTargets(npcs);
    let pendingPaths = this.#pendingPathCount();
    for (const npc of npcs) {
      let navigation = this.#npcNavigation.get(npc.id);
      if (!navigation) {
        navigation = newNavigation(npc.position);
        this.#npcNavigation.set(npc.id, navigation);
      }
      const target = targets.get(npc.id);
      const targetChanged = navigation.targetId !== target?.id;
      if (targetChanged) {
        navigation.goalVersion += 1;
        delete navigation.path;
        delete navigation.pauseUntilTick;
        delete navigation.exploreGoal;
        navigation.exploreDistanceScale = 1;
        navigation.nextPathPoint = 0;
        navigation.lastRequestTick = -Infinity;
        navigation.progressTick = tick;
        if (target) navigation.targetId = target.id;
        else delete navigation.targetId;
      }
      if (this.#pollPath(navigation, tick)) pendingPaths -= 1;
      if (!target || target.state.kind !== "player") {
        if (targetChanged || npc.state.readyToFire) {
          this.context.entities.update(npc.id, current => current.state.kind === "npc"
            ? { ...current, state: { ...current.state, targetId: "", readyToFire: false } }
            : current);
        }
        if (this.#explore(npc, navigation, dtSeconds, tick, pathRequests, pendingPaths)) {
          pathRequests += 1;
          pendingPaths += 1;
        }
        continue;
      }

      const facing = turnFacing(
        npc.state.kind === "npc" ? npc.state.facing ?? DEFAULT_FACING : DEFAULT_FACING,
        npc.position, target.position, dtSeconds
      );
      const range = distance(npc.position, target.position);
      const clearShot = range <= NPC_SHOT_RANGE &&
        hasNpcShot(this.context, npc.position, target.position);
      const crowdedBy = this.context.entities.queryRadius(
        npc.position, npc.radius + 24, MAX_ATTRACTION_QUERY_CELLS
      ).find(other => other.id !== npc.id && other.state.kind === "npc" &&
        other.state.health > 0 &&
        distance(other.position, npc.position) < npc.radius + other.radius + 16 &&
        hasNpcShot(this.context, npc.position, other.position));
      const retreat = (range < NPC_KEEP_DISTANCE && clearShot) || crowdedBy !== undefined;
      const wantedFacing = normalizedFacing({
        x: target.position.x - npc.position.x, y: target.position.y - npc.position.y
      });
      this.context.entities.update(npc.id, current => current.state.kind === "npc"
        ? { ...current, state: { ...current.state, facing, targetId: target.id,
          readyToFire: clearShot && !retreat && wantedFacing !== undefined &&
            facing.x * wantedFacing.x + facing.y * wantedFacing.y >= Math.cos(0.1) } }
        : current);
      if (clearShot && !retreat) continue;

      const awayFrom = crowdedBy?.position ?? target.position;
      const escape = distance(npc.position, awayFrom) > 1e-6
        ? normalizedDelta(awayFrom, npc.position, NPC_KEEP_DISTANCE)
        : crowdedBy
          ? { x: compareIds(npc.id, crowdedBy.id) < 0 ? -NPC_KEEP_DISTANCE : NPC_KEEP_DISTANCE, y: 0 }
          : { x: -facing.x * NPC_KEEP_DISTANCE, y: -facing.y * NPC_KEEP_DISTANCE };
      let destination = retreat ? {
        x: npc.position.x + escape.x, y: npc.position.y + escape.y
      } : target.position;
      const currentPath = navigation.path;
      const pathPoint = retreat ? undefined : currentPath?.[navigation.nextPathPoint];
      if (pathPoint) {
        destination = pathPoint;
        if (distance(npc.position, pathPoint) <= this.npcMovementSpeed * dtSeconds) {
          navigation.nextPathPoint += 1;
          destination = currentPath?.[navigation.nextPathPoint] ?? target.position;
        }
      }
      if (currentPath && navigation.nextPathPoint >= currentPath.length) {
        delete navigation.path;
      }
      if (tick - navigation.progressTick > NPC_EXPLORE_STUCK_TICKS) {
        delete navigation.path;
      }

      const delta = normalizedDelta(npc.position, destination, this.npcMovementSpeed * dtSeconds);
      const desired = { x: npc.position.x + delta.x, y: npc.position.y + delta.y };
      const blocked = !isWalkable(this.context, desired, npc.radius);
      if (
        this.npcMovementSpeed > 0 && !retreat && !navigation.path && (blocked || !clearShot) &&
        !navigation.requestId &&
        pathRequests < MAX_NPC_PATH_REQUESTS_PER_TICK &&
        pendingPaths < MAX_PENDING_NPC_PATHS &&
        tick - navigation.lastRequestTick >= NPC_REPATH_INTERVAL_TICKS
      ) {
        const requestId = this.context.navigation.requestPath(npc.position, target.position);
        navigation.lastRequestTick = tick;
        if (requestId) {
          navigation.requestId = requestId;
          navigation.requestVersion = navigation.goalVersion;
          pathRequests += 1;
          pendingPaths += 1;
        }
      }

      const moved = this.#steer(npc.position, destination,
        this.npcMovementSpeed * dtSeconds, npc.radius);
      if (distance(npc.position, moved) > 1e-3) navigation.progressTick = tick;
      this.context.entities.update(npc.id, (current) => ({ ...current, position: moved }));
    }
  }

  #assignNpcTargets(npcs: readonly DefaultEntity[]): Map<string, DefaultEntity> {
    const targets = new Map<string, DefaultEntity>();
    if (this.npcDetectionRange === 0) return targets;
    const slots = new Map<string, number>();
    const candidates: { npcId: string; player: DefaultEntity; distance: number }[] = [];
    for (const npc of npcs) {
      const previousId = this.#npcNavigation.get(npc.id)?.targetId;
      const previous = previousId ? this.context.entities.get(previousId) : undefined;
      if (previous?.state.kind === "player" && previous.state.health > 0 &&
        distance(npc.position, previous.position) <= this.npcDetectionRange &&
        (slots.get(previous.id) ?? 0) < MAX_NPC_ATTACKERS_PER_PLAYER) {
        targets.set(npc.id, previous);
        slots.set(previous.id, (slots.get(previous.id) ?? 0) + 1);
        continue;
      }
      for (const player of this.context.entities.queryRadius(
        npc.position, this.npcDetectionRange, MAX_ATTRACTION_QUERY_CELLS
      )) {
        if (player.typeId === "player" && player.state.kind === "player" &&
          player.state.health > 0) {
          candidates.push({ npcId: npc.id, player, distance: distance(npc.position, player.position) });
        }
      }
    }
    // Reserve all surviving engagements before admitting globally closest free pairs.
    candidates.sort((a, b) => a.distance - b.distance ||
      compareIds(a.npcId, b.npcId) || compareIds(a.player.id, b.player.id));
    for (const candidate of candidates) {
      if (targets.has(candidate.npcId) ||
        (slots.get(candidate.player.id) ?? 0) >= MAX_NPC_ATTACKERS_PER_PLAYER) continue;
      targets.set(candidate.npcId, candidate.player);
      slots.set(candidate.player.id, (slots.get(candidate.player.id) ?? 0) + 1);
    }
    return targets;
  }

  #explore(
    npc: DefaultEntity,
    navigation: NpcNavigationState,
    dtSeconds: number,
    tick: number,
    pathRequests: number,
    pendingPaths: number
  ): boolean {
    if (this.npcMovementSpeed === 0 || dtSeconds === 0) return false;
    this.#markVisited(navigation, npc.position, tick);
    if (tick < (navigation.pauseUntilTick ?? 0)) return false;

    if (!navigation.exploreGoal) {
      const goal = this.#chooseExploreGoal(npc, navigation, tick);
      if (!goal) {
        this.context.metrics.increment("default.npc_explore.no_destination");
        this.#shortenExploreDistance(navigation);
        navigation.pauseUntilTick = tick + NPC_EXPLORE_PAUSE_TICKS;
        return false;
      }
      navigation.exploreGoal = goal;
      navigation.goalVersion += 1;
      delete navigation.path;
      navigation.nextPathPoint = 0;
      navigation.bestGoalDistance = distance(npc.position, goal);
      navigation.progressTick = tick;
    }
    const goal = navigation.exploreGoal;

    let requested = false;
    if (!navigation.path && !navigation.requestId &&
      pathRequests < MAX_NPC_PATH_REQUESTS_PER_TICK && pendingPaths < MAX_PENDING_NPC_PATHS &&
      tick - navigation.lastRequestTick >= NPC_REPATH_INTERVAL_TICKS) {
      const requestId = this.context.navigation.requestPath(npc.position, goal);
      navigation.lastRequestTick = tick;
      if (requestId) {
        navigation.requestId = requestId;
        navigation.requestVersion = navigation.goalVersion;
        requested = true;
      } else {
        this.context.metrics.increment("default.npc_explore.request_rejected");
      }
    }

    const step = this.npcMovementSpeed * NPC_EXPLORE_SPEED_FACTOR * dtSeconds;
    let position = npc.position;
    let arrived = false;
    let progressed = false;
    if (navigation.path) {
      // Carry leftover distance through waypoints so explore speed stays constant.
      let remaining = step;
      for (let legs = 0; legs < 4 && remaining > 1e-9; legs += 1) {
        const point = navigation.path[navigation.nextPathPoint];
        if (!point) break;
        const moved = this.context.geometry.moveCircle(
          position, normalizedDelta(position, point, remaining), npc.radius
        );
        remaining -= distance(position, moved);
        position = moved;
        if (distance(moved, point) >= 1e-6) break;
        navigation.nextPathPoint += 1;
      }
      arrived = navigation.nextPathPoint >= navigation.path.length;
      progressed = distance(npc.position, position) >= step * 0.25;
    } else {
      // Steer toward the goal until its path arrives so movement starts immediately.
      position = this.#steer(npc.position, goal, step, npc.radius);
      arrived = distance(position, goal) < 1e-6;
      const remaining = distance(position, goal);
      progressed = remaining < navigation.bestGoalDistance - 1e-3;
      if (progressed) navigation.bestGoalDistance = remaining;
    }
    if (position !== npc.position) {
      const facing = turnFacing(
        npc.state.kind === "npc" ? npc.state.facing ?? DEFAULT_FACING : DEFAULT_FACING,
        npc.position, goal, dtSeconds
      );
      this.context.entities.update(npc.id, current => current.state.kind === "npc"
        ? { ...current, position, state: { ...current.state, facing } } : current);
    }
    if (progressed) navigation.progressTick = tick;

    if (arrived) {
      this.#clearExploreGoal(navigation);
      navigation.exploreDistanceScale = 1;
      navigation.pauseUntilTick = tick + NPC_EXPLORE_PAUSE_TICKS +
        Math.floor(this.context.random.next() * (NPC_EXPLORE_PAUSE_TICKS + 1));
    } else if (tick - navigation.progressTick > NPC_EXPLORE_STUCK_TICKS) {
      this.context.metrics.increment("default.npc_explore.stuck");
      this.#shortenExploreDistance(navigation);
      this.#clearExploreGoal(navigation);
    }
    return requested;
  }

  #clearExploreGoal(navigation: NpcNavigationState): void {
    delete navigation.exploreGoal;
    delete navigation.path;
    navigation.nextPathPoint = 0;
    // Any in-flight request for the abandoned goal is drained but never followed.
    navigation.goalVersion += 1;
  }

  #shortenExploreDistance(navigation: NpcNavigationState): void {
    const bounds = this.#map!.definition.bounds;
    const target = Math.min(bounds.width, bounds.height) * NPC_EXPLORE_MAP_DISTANCE_FACTOR;
    navigation.exploreDistanceScale = Math.max(
      MAP_CELL_SIZE / target, navigation.exploreDistanceScale / 2
    );
  }

  #steer(from: Point2, goal: Point2, step: number, radius: number): Point2 {
    const wanted = Math.min(step, distance(from, goal));
    const direct = this.context.geometry.moveCircle(
      from, normalizedDelta(from, goal, step), radius
    );
    if (distance(from, direct) >= wanted - 1e-6) return direct;
    const toward = { x: goal.x - from.x, y: goal.y - from.y };
    const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
      .sort((a, b) => (b.x * toward.x + b.y * toward.y) - (a.x * toward.x + a.y * toward.y));
    let best = direct;
    for (const axis of axes) {
      const moved = this.context.geometry.moveCircle(
        from, { x: axis.x * step, y: axis.y * step }, radius
      );
      if (distance(from, moved) >= step - 1e-6) return moved;
      if (distance(from, moved) > distance(from, best)) best = moved;
    }
    return best;
  }

  #chooseExploreGoal(
    npc: DefaultEntity,
    navigation: NpcNavigationState,
    tick: number
  ): Point2 | undefined {
    const bounds = this.#map!.definition.bounds;
    const columns = Math.floor(bounds.width / MAP_CELL_SIZE);
    const rows = Math.floor(bounds.height / MAP_CELL_SIZE);
    const shorterSide = Math.min(bounds.width, bounds.height);
    const target = shorterSide * NPC_EXPLORE_MAP_DISTANCE_FACTOR *
      navigation.exploreDistanceScale;
    const action = [...this.#playerIds.values()].map(id => this.context.entities.get(id))
      .filter((entity): entity is DefaultEntity => this.npcDetectionRange > 0 &&
        entity?.state.kind === "player" && entity.state.health > 0 &&
        distance(entity.position, npc.position) <= this.npcDetectionRange * NPC_AWARENESS_RANGE_FACTOR)
      .sort((a, b) => distance(a.position, npc.position) - distance(b.position, npc.position))[0];
    const currentEdgeDistance = Math.min(
      npc.position.x,
      npc.position.y,
      bounds.width - npc.position.x,
      bounds.height - npc.position.y
    );
    const seekInterior = currentEdgeDistance < shorterSide * 0.25 &&
      navigation.exploreDistanceScale === 1;
    const centerBearing = Math.atan2(
      bounds.height / 2 - npc.position.y,
      bounds.width / 2 - npc.position.x
    );
    let best: Point2 | undefined;
    let bestInward = -Infinity;
    let bestNovelty = -Infinity;
    let bestAway = -Infinity;
    for (let attempt = 0; attempt < MAX_NPC_EXPLORE_CANDIDATES; attempt += 1) {
      const randomAngle = this.context.random.next();
      const angle = action ? randomAngle * Math.PI * 2 : seekInterior
        ? attempt === 0 ? centerBearing : centerBearing + (randomAngle - 0.5) * Math.PI
        : randomAngle * Math.PI * 2;
      const reach = action ? shorterSide * (0.06 + this.context.random.next() * 0.19) *
        navigation.exploreDistanceScale
        : target * (0.9 + this.context.random.next() * 0.2);
      const focus = action ? {
        x: clamp(action.position.x, shorterSide * 0.25, bounds.width - shorterSide * 0.25),
        y: clamp(action.position.y, shorterSide * 0.25, bounds.height - shorterSide * 0.25)
      } : npc.position;
      const center = action ? {
        x: npc.position.x + (focus.x - npc.position.x) * navigation.exploreDistanceScale,
        y: npc.position.y + (focus.y - npc.position.y) * navigation.exploreDistanceScale
      } : focus;
      const column = clamp(Math.floor((center.x + Math.cos(angle) * reach) / MAP_CELL_SIZE),
        0, columns - 1);
      const row = clamp(Math.floor((center.y + Math.sin(angle) * reach) / MAP_CELL_SIZE),
        0, rows - 1);
      const candidate = { x: (column + 0.5) * MAP_CELL_SIZE, y: (row + 0.5) * MAP_CELL_SIZE };
      if (distance(npc.position, candidate) <
        (action ? Math.min(MAP_CELL_SIZE * 2, target * 0.75) : target * 0.75) ||
        !isWalkable(this.context, candidate, npc.radius)) continue;
      const candidateEdgeDistance = Math.min(
        candidate.x,
        candidate.y,
        bounds.width - candidate.x,
        bounds.height - candidate.y
      );
      const inward = action ? candidateEdgeDistance >= shorterSide * 0.25 ? 2 : 1 : seekInterior
        ? candidateEdgeDistance >= shorterSide * 0.25
          ? attempt === 0 ? 3 : 2
          : candidateEdgeDistance > currentEdgeDistance ? 1 : 0
        : 0;
      const lastVisit = navigation.visitedAt.get(this.#regionOf(candidate));
      // Unvisited regions win, then the least recently visited, then distance from spawn.
      const novelty = lastVisit === undefined ? Infinity : tick - lastVisit;
      const away = distance(navigation.home, candidate);
      if (inward > bestInward || (inward === bestInward &&
        (novelty > bestNovelty || (novelty === bestNovelty && away > bestAway)))) {
        best = candidate;
        bestInward = inward;
        bestNovelty = novelty;
        bestAway = away;
      }
    }
    return best;
  }

  #markVisited(navigation: NpcNavigationState, position: Point2, tick: number): void {
    navigation.visitedAt.set(this.#regionOf(position), tick);
  }

  #regionOf(position: Point2): number {
    const bounds = this.#map!.definition.bounds;
    const size = Math.max(MAP_CELL_SIZE,
      Math.min(NPC_EXPLORE_REGION_SIZE, Math.min(bounds.width, bounds.height) / 8));
    const columns = Math.ceil(bounds.width / size);
    return Math.floor(position.y / size) * columns + Math.floor(position.x / size);
  }

  #pollPath(navigation: NpcNavigationState, tick: number): boolean {
    if (!navigation.requestId) {
      return false;
    }
    const result = this.context.navigation.getPath(navigation.requestId);
    if (!result) {
      return false;
    }
    delete navigation.requestId;
    // The public service cannot cancel; drain results but never follow an obsolete goal.
    if (navigation.requestVersion !== navigation.goalVersion) {
      return true;
    }
    if (result.status === "found" && result.path.length > 1) {
      navigation.path = result.path;
      navigation.nextPathPoint = 1;
      navigation.progressTick = tick;
    } else {
      delete navigation.path;
      navigation.nextPathPoint = 0;
      if (!navigation.targetId) {
        // Pick another destination at once; the request interval still bounds retries.
        this.context.metrics.increment(`default.npc_explore.${result.status}`);
        this.#shortenExploreDistance(navigation);
        this.#clearExploreGoal(navigation);
      }
    }
    return true;
  }

  #pendingPathCount(): number {
    let count = 0;
    for (const navigation of this.#npcNavigation.values()) {
      if (navigation.requestId) {
        count += 1;
      }
    }
    return count;
  }

  #assertInitialized(): void {
    this.#assertActive();
    if (!this.#initialized) {
      throw new Error("Default entity simulator is not initialized.");
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Default entity simulator has been disposed.");
    }
  }
}

export function normalizeMovement(x: number, y: number): Point2 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("Movement input must be finite.");
  }
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 1) {
    return Object.freeze({ x, y });
  }
  return Object.freeze({ x: x / magnitude, y: y / magnitude });
}

function isWalkable(
  context: ModuleContext<DefaultEntity>,
  position: Point2,
  radius: number
): boolean {
  return (
    context.geometry.isWalkable(position.x, position.y, radius) &&
    !context.geometry.intersectsObstacle(position.x, position.y, radius)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedDelta(from: Point2, to: Point2, distanceToMove: number): Point2 {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const magnitude = Math.hypot(deltaX, deltaY);
  if (magnitude === 0 || distanceToMove === 0) {
    return { x: 0, y: 0 };
  }
  const distanceToDestination = Math.min(magnitude, distanceToMove);
  return {
    x: (deltaX / magnitude) * distanceToDestination,
    y: (deltaY / magnitude) * distanceToDestination
  };
}

function distance(from: Point2, to: Point2): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function turnFacing(facing: DefaultFacing, from: Point2, to: Point2, dt: number): DefaultFacing {
  if (distance(from, to) === 0) return facing;
  const angle = Math.atan2(facing.y, facing.x);
  const wanted = Math.atan2(to.y - from.y, to.x - from.x);
  const difference = Math.atan2(Math.sin(wanted - angle), Math.cos(wanted - angle));
  const next = angle + clamp(difference,
    -NPC_TURN_RADIANS_PER_SECOND * dt, NPC_TURN_RADIANS_PER_SECOND * dt);
  return { x: Math.cos(next), y: Math.sin(next) };
}

function normalizedFacing(vector: Point2): DefaultFacing | undefined {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0 || !Number.isFinite(magnitude)) return undefined;
  return Object.freeze({ x: vector.x / magnitude, y: vector.y / magnitude });
}
