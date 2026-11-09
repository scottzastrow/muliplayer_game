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
  NPC_REPATH_INTERVAL_TICKS,
  NPC_SPEED,
  PLAYER_HEALTH,
  MAX_PICKUPS_PER_SESSION,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  MAX_PENDING_NPC_PATHS,
  MAX_ATTRACTION_QUERY_CELLS,
  NPC_WANDER_SPEED_FACTOR,
  NPC_WANDER_RADIUS,
  NPC_WANDER_PAUSE_TICKS,
  MAX_NPC_WANDER_CANDIDATES
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

export interface DefaultContactAttackCapability extends Record<string, JsonValue> {
  readonly typeId: "default.contact-attack";
  readonly damage: number;
  readonly cooldownTicks: number;
}

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
}

const EMPTY_MOVEMENT = Object.freeze({ x: 0, y: 0 });
const PLAYER_COLORS = Object.freeze(Array.from({ length: 32 }, (_, index) =>
  `hsl(${Math.round((25 + (index * 360) / 32) % 360)} 78% 58%)`
));
const DEFAULT_FACING: DefaultFacing = Object.freeze({ x: 1, y: 0 });

export class DefaultEntitySimulator {
  readonly #movementByAccount = new Map<string, Point2>();
  readonly #npcNavigation = new Map<string, NpcNavigationState>();
  readonly #lastContactAttackTick = new Map<string, number>();
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

  startLevel(level: number, npcCount: number, npcHealth: number): void {
    this.#assertInitialized();
    if (!Number.isSafeInteger(level) || level < 2) {
      throw new RangeError("Subsequent level number must be a safe integer of at least two.");
    }
    for (const id of this.#npcNavigation.keys()) {
      this.context.entities.remove(id);
    }
    this.#npcNavigation.clear();
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
    const playerId = this.#playerIds.get(accountId);
    if (playerId) this.#lastContactAttackTick.delete(playerId);
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
    this.#playerIds.clear();
    this.#npcNavigation.clear();
    this.#pickupIds.clear();
    this.#lastContactAttackTick.clear();
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
        attackCapability: defaultContactAttackCapability
      };
      this.context.entities.add({
        id,
        typeId: "npc",
        position,
        radius: 8,
        state
      });
      this.#npcNavigation.set(id, { nextPathPoint: 0, lastRequestTick: -Infinity, goalVersion: 0 });
    }
  }

  #movePlayers(dtSeconds: number): void {
    for (const [accountId, id] of this.#playerIds) {
      const entity = this.context.entities.get(id);
      if (!entity || entity.state.kind !== "player" || entity.state.health <= 0) {
        continue;
      }
      const movement = this.#movementByAccount.get(accountId) ?? EMPTY_MOVEMENT;
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
        entity.state.kind === "npc" && entity.typeId === "npc"
    );
    let pendingPaths = this.#pendingPathCount();
    for (const npc of npcs) {
      let navigation = this.#npcNavigation.get(npc.id);
      if (!navigation) {
        navigation = { nextPathPoint: 0, lastRequestTick: -Infinity, goalVersion: 0 };
        this.#npcNavigation.set(npc.id, navigation);
      }
      const nearbyPlayers = this.npcDetectionRange === 0 ? [] : this.context.entities
        .queryRadius(npc.position, this.npcDetectionRange, MAX_ATTRACTION_QUERY_CELLS)
        .filter(
          (entity): entity is DefaultEntity =>
            entity.typeId === "player" &&
            entity.state.kind === "player" &&
            entity.state.health > 0
        );
      const target = nearestEntity(npc.position, nearbyPlayers);
      const targetChanged = navigation.targetId !== target?.id;
      if (targetChanged) {
        navigation.goalVersion += 1;
        delete navigation.path;
        delete navigation.pauseUntilTick;
        navigation.nextPathPoint = 0;
        navigation.lastRequestTick = -Infinity;
        if (target) navigation.targetId = target.id;
        else delete navigation.targetId;
      }
      if (this.#pollPath(navigation, tick)) pendingPaths -= 1;
      if (!target || target.state.kind !== "player") {
        if (this.#wander(npc, navigation, dtSeconds, tick, pathRequests, pendingPaths)) {
          pathRequests += 1;
          pendingPaths += 1;
        }
        continue;
      }

      let destination = target.position;
      const currentPath = navigation.path;
      const pathPoint = currentPath?.[navigation.nextPathPoint];
      if (pathPoint) {
        destination = pathPoint;
        if (distance(npc.position, pathPoint) <= this.npcMovementSpeed * dtSeconds) {
          navigation.nextPathPoint += 1;
          destination = currentPath[navigation.nextPathPoint] ?? target.position;
        }
      }

      const delta = normalizedDelta(npc.position, destination, this.npcMovementSpeed * dtSeconds);
      const desired = { x: npc.position.x + delta.x, y: npc.position.y + delta.y };
      const blocked = !isWalkable(this.context, desired, npc.radius);
      if (
        blocked &&
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

      const moved = this.context.geometry.moveCircle(
        npc.position,
        delta,
        npc.radius
      );
      this.context.entities.update(npc.id, (current) => ({ ...current, position: moved }));
      this.#applyContactAttack(npc.id, target.id, tick);
    }
  }

  #wander(
    npc: DefaultEntity,
    navigation: NpcNavigationState,
    dtSeconds: number,
    tick: number,
    pathRequests: number,
    pendingPaths: number
  ): boolean {
    if (this.npcMovementSpeed === 0 || dtSeconds === 0 ||
      tick < (navigation.pauseUntilTick ?? 0)) return false;

    const pathPoint = navigation.path?.[navigation.nextPathPoint];
    if (pathPoint) {
      const delta = normalizedDelta(
        npc.position, pathPoint, this.npcMovementSpeed * NPC_WANDER_SPEED_FACTOR * dtSeconds
      );
      const moved = this.context.geometry.moveCircle(npc.position, delta, npc.radius);
      this.context.entities.update(npc.id, current => ({ ...current, position: moved }));
      if (distance(moved, pathPoint) < 1e-6) {
        navigation.nextPathPoint += 1;
        if (navigation.nextPathPoint === navigation.path!.length) {
          delete navigation.path;
          navigation.pauseUntilTick = tick + NPC_WANDER_PAUSE_TICKS +
            Math.floor(this.context.random.next() * (NPC_WANDER_PAUSE_TICKS + 1));
        }
      }
      return false;
    }
    if (navigation.requestId || pathRequests >= MAX_NPC_PATH_REQUESTS_PER_TICK ||
      pendingPaths >= MAX_PENDING_NPC_PATHS ||
      tick - navigation.lastRequestTick < NPC_REPATH_INTERVAL_TICKS) return false;

    for (let attempt = 0; attempt < MAX_NPC_WANDER_CANDIDATES; attempt += 1) {
      const destination = {
        x: (Math.floor(npc.position.x / MAP_CELL_SIZE) +
          Math.floor(this.context.random.next() * 7) - 3 + 0.5) * MAP_CELL_SIZE,
        y: (Math.floor(npc.position.y / MAP_CELL_SIZE) +
          Math.floor(this.context.random.next() * 7) - 3 + 0.5) * MAP_CELL_SIZE
      };
      const separation = distance(npc.position, destination);
      if (separation < MAP_CELL_SIZE || separation > NPC_WANDER_RADIUS ||
        !isWalkable(this.context, destination, npc.radius)) continue;
      const requestId = this.context.navigation.requestPath(npc.position, destination);
      navigation.lastRequestTick = tick;
      if (!requestId) {
        this.context.metrics.increment("default.npc_wander.request_rejected");
        return false;
      }
      navigation.requestId = requestId;
      navigation.goalVersion += 1;
      navigation.requestVersion = navigation.goalVersion;
      return true;
    }
    this.context.metrics.increment("default.npc_wander.no_destination");
    navigation.pauseUntilTick = tick + NPC_WANDER_PAUSE_TICKS;
    return false;
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
    } else {
      delete navigation.path;
      navigation.nextPathPoint = 0;
      if (!navigation.targetId) {
        navigation.pauseUntilTick = tick + NPC_REPATH_INTERVAL_TICKS;
        this.context.metrics.increment(`default.npc_wander.${result.status}`);
      }
    }
    return true;
  }

  #applyContactAttack(npcId: string, playerId: string, tick: number): void {
    const npc = this.context.entities.get(npcId);
    const player = this.context.entities.get(playerId);
    if (
      !npc ||
      npc.state.kind !== "npc" ||
      npc.state.attackCapability.typeId !== "default.contact-attack" ||
      !player ||
      player.state.kind !== "player" ||
      player.state.health <= 0 ||
      distance(npc.position, player.position) > npc.radius + player.radius
    ) {
      return;
    }
    const previousTick = this.#lastContactAttackTick.get(playerId) ?? -Infinity;
    if (tick - previousTick < npc.state.attackCapability.cooldownTicks) {
      return;
    }
    this.#lastContactAttackTick.set(playerId, tick);
    const damage = npc.state.attackCapability.damage;
    this.context.entities.update(playerId, (current) => {
      if (current.state.kind !== "player") {
        return current;
      }
      return {
        ...current,
        state: { ...current.state, health: Math.max(0, current.state.health - damage) }
      };
    });
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

function nearestEntity(from: Point2, entities: readonly DefaultEntity[]): DefaultEntity | undefined {
  let nearest: DefaultEntity | undefined;
  let nearestDistance = Infinity;
  for (const entity of entities) {
    const candidateDistance = distance(from, entity.position);
    if (candidateDistance < nearestDistance) {
      nearest = entity;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
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

function normalizedFacing(vector: Point2): DefaultFacing | undefined {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0 || !Number.isFinite(magnitude)) return undefined;
  return Object.freeze({ x: vector.x / magnitude, y: vector.y / magnitude });
}
