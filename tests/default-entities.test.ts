import { describe, expect, it, vi } from "vitest";
import type { GameSettings } from "@multiplayer-game/protocol";
import {
  BoundedNavigation,
  SeededRandom,
  SpatialGrid,
  WorldGeometry,
  type Rect
} from "@multiplayer-game/engine";
import type {
  EntityStore,
  ModuleContext,
  NavigationPathResult,
  Point2,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  MAX_PENDING_NPC_PATHS,
  NPC_CONTACT_COOLDOWN_TICKS,
  NPC_EXPLORE_MAX_DISTANCE,
  NPC_EXPLORE_MIN_DISTANCE,
  NPC_EXPLORE_PAUSE_TICKS,
  NPC_EXPLORE_SPEED_FACTOR,
  NPC_REPATH_INTERVAL_TICKS,
  PLAYER_SPEED,
  type DefaultEntity,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";

const roster: readonly RosterMember[] = [
  { accountId: "player-a", username: "Alice", joinedOrder: 0 }
];

describe("default entity movement and pursuit", () => {
  it("normalizes diagonal player movement to the configured speed", () => {
    const simulation = createSimulation();
    const player = simulation.context.entities.get("player:player-a")!;
    const action: DefaultPlayerAction = {
      type: "combat",
      moveX: 1,
      moveY: 1,
      aimX: 0,
      aimY: 0,
      fire: false
    };

    simulation.module.applyInput("player-a", action);
    simulation.module.step(1 / 30, 1);

    const moved = simulation.context.entities.get(player.id)!;
    expect(Math.hypot(
      moved.position.x - player.position.x,
      moved.position.y - player.position.y
    )).toBeCloseTo(PLAYER_SPEED / 30, 8);
    expect(moved.position.x - player.position.x).toBeCloseTo(
      (PLAYER_SPEED / 30) / Math.sqrt(2),
      8
    );
    expect(
      simulation.module.snapshot({ accountId: "player-a", role: "player" }).entities
    ).toContainEqual(expect.objectContaining({
      id: player.id,
      position: moved.position
    }));
    simulation.module.dispose();
  });

  it.each([400, 700])(
    "explores outside the %i-unit range, pursues on entry and resumes exploring on exit",
    npcDetectionRange => {
      const npcMovementSpeed = 33.75;
      const simulation = createSimulation([], {
        npcMovementSpeed, npcDetectionRange, initialNpcsPerPlayer: 1
      });
      try {
        const npc = simulation.context.entities.get("npc:npc-northwest")!;
        const player = simulation.context.entities.get("player:player-a")!;
        simulation.context.entities.update(npc.id, entity => ({
          ...entity, position: { x: 700, y: 700 }
        }));
        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: 1_900, y: 1_900 }
        }));

        for (let tick = 1; tick <= 120; tick += 1) {
          simulation.navigation.processTick();
          simulation.module.step(1 / 30, tick);
        }
        const wandering = simulation.context.entities.get(npc.id)!.position;
        expect(wandering).not.toEqual({ x: 700, y: 700 });

        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: wandering.x + npcDetectionRange, y: wandering.y }
        }));
        simulation.module.step(1 / 30, 121);

        expect(simulation.context.entities.get(npc.id)!.position.x).toBeCloseTo(
          wandering.x + npcMovementSpeed / 30,
          6
        );
        const pursuing = simulation.context.entities.get(npc.id)!.position;
        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: 1_900, y: 1_900 }
        }));
        for (let tick = 122; tick <= 242; tick += 1) {
          simulation.navigation.processTick();
          simulation.module.step(1 / 30, tick);
        }
        expect(simulation.context.entities.get(npc.id)!.position).not.toEqual(pursuing);
      } finally { simulation.module.dispose(); }
    }
  );

  it("explores without pursuit or contact targeting when NPC detection range is zero", () => {
    const simulation = createSimulation([], { npcDetectionRange: 0 });
    try {
      const npcId = "npc:npc-northwest";
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      for (let tick = 1; tick <= 120; tick += 1) {
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
      }
      expect(simulation.context.entities.get(npcId)!.position).not.toEqual({ x: 700, y: 700 });
      expect(simulation.context.entities.get("player:player-a")!.state).toMatchObject({ health: 100 });
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(0);
    } finally { simulation.module.dispose(); }
  });

  it("repeats seeded half-speed exploration with short pauses within the navigation budget", () => {
    const a = createSimulation([], { npcDetectionRange: 0 });
    const b = createSimulation([], { npcDetectionRange: 0 });
    const other = createSimulation([], { npcDetectionRange: 0 }, 43);
    const id = "npc:npc-northwest";
    const spawn = a.context.entities.get(id)!.position;
    let movingTicks = 0;
    let pausedAfterMovement = 0;
    let stationaryRun = 0;
    let longestStationary = 0;
    let farthestFromSpawn = 0;
    try {
      for (let tick = 1; tick <= 900; tick += 1) {
        const previous = a.context.entities.get(id)!.position;
        for (const simulation of [a, b, other]) {
          const requests = simulation.navigation.requestsSubmitted;
          simulation.navigation.processTick();
          simulation.module.step(1 / 30, tick);
          expect(simulation.navigation.requestsSubmitted - requests)
            .toBeLessThanOrEqual(MAX_NPC_PATH_REQUESTS_PER_TICK);
          expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);
        }
        const position = a.context.entities.get(id)!.position;
        expect(position).toEqual(b.context.entities.get(id)!.position);
        expect(a.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
        const travel = Math.hypot(position.x - previous.x, position.y - previous.y);
        expect(travel).toBeLessThanOrEqual(67.5 * NPC_EXPLORE_SPEED_FACTOR / 30 + 1e-8);
        if (tick === 1) expect(travel, "explore starts on the first update").toBeGreaterThan(0);
        if (travel > 0) {
          movingTicks += 1;
          stationaryRun = 0;
        } else {
          stationaryRun += 1;
          longestStationary = Math.max(longestStationary, stationaryRun);
          if (movingTicks > 0) pausedAfterMovement += 1;
        }
        farthestFromSpawn = Math.max(farthestFromSpawn,
          Math.hypot(position.x - spawn.x, position.y - spawn.y));
      }
      expect(movingTicks).toBeGreaterThan(780);
      expect(pausedAfterMovement).toBeGreaterThan(0);
      expect(longestStationary).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
      expect(farthestFromSpawn, "explores beyond its spawn neighbourhood").toBeGreaterThan(384);
      expect(a.context.entities.get(id)!.position).not.toEqual(other.context.entities.get(id)!.position);
    } finally {
      for (const simulation of [a, b, other]) simulation.module.dispose();
    }
  });

  it("keeps speed-zero NPCs stationary with no path requests", () => {
    const simulation = createSimulation([], { npcMovementSpeed: 0, npcDetectionRange: 0 });
    try {
      const before = simulation.context.entities.values().filter(entity => entity.state.kind === "npc");
      for (let tick = 1; tick <= 300; tick += 1) {
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
      }
      expect(simulation.context.entities.values().filter(entity => entity.state.kind === "npc")).toEqual(before);
      expect(simulation.navigation.requestsSubmitted).toBe(0);
    } finally { simulation.module.dispose(); }
  });

  it("explores reachable destinations away from its position next to terrain without entering it", () => {
    const wall = { x: 736, y: 600, width: 32, height: 200 };
    const simulation = createSimulation([wall], { npcDetectionRange: 0, initialNpcsPerPlayer: 1 });
    const id = "npc:npc-northwest";
    const requests = vi.spyOn(simulation.context.navigation, "requestPath");
    try {
      simulation.context.entities.update(id, entity => ({
        ...entity, position: { x: 720, y: 700 }
      }));
      let travelled = 0;
      for (let tick = 1; tick <= 600; tick += 1) {
        const previous = simulation.context.entities.get(id)!.position;
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        const position = simulation.context.entities.get(id)!.position;
        expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
        travelled += Math.hypot(position.x - previous.x, position.y - previous.y);
      }
      expect(travelled).toBeGreaterThan(0.75 * 600 * 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30);
      expect(requests.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const [from, to] of requests.mock.calls) {
        const separation = Math.hypot(to.x - from.x, to.y - from.y);
        expect(separation).toBeGreaterThanOrEqual(NPC_EXPLORE_MIN_DISTANCE / 2);
        expect(separation).toBeLessThanOrEqual(NPC_EXPLORE_MAX_DISTANCE + 32 * Math.SQRT2);
        expect(simulation.context.geometry.isWalkable(to.x, to.y, 8)).toBe(true);
      }
    } finally { simulation.module.dispose(); }
  });

  it("discards pending explore paths on pursuit entry and resumes exploring immediately on exit", () => {
    const wall = { x: 736, y: 600, width: 32, height: 200 };
    const simulation = createSimulation([wall], {
      npcDetectionRange: 200, initialNpcsPerPlayer: 1
    });
    const id = "npc:npc-northwest";
    const exploreStep = 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30;
    const position = () => simulation.context.entities.get(id)!.position;
    const place = (entityId: string, point: Point2) =>
      simulation.context.entities.update(entityId, entity => ({ ...entity, position: point }));
    try {
      place(id, { x: 720, y: 700 });
      place("player:player-a", { x: 1_900, y: 1_900 });
      simulation.module.step(1 / 30, 1);
      expect(position(), "explore moves on the first update").not.toEqual({ x: 720, y: 700 });
      expect(simulation.navigation.outstandingRequests).toBe(1);
      simulation.navigation.processTick();

      // Entry: the completed explore path is drained and direct pursuit wins.
      place(id, { x: 720, y: 700 });
      place("player:player-a", { x: 620, y: 700 });
      simulation.module.step(1 / 30, 2);
      expect(position()).toEqual({ x: 717.75, y: 700 });

      // Pursuit blocked by the wall submits a pursuit path request.
      place(id, { x: 727, y: 700 });
      place("player:player-a", { x: 820, y: 700 });
      simulation.module.step(1 / 30, 3);
      expect(simulation.navigation.outstandingRequests).toBe(1);

      // Exit: exploration resumes on the same update, at explore speed.
      place("player:player-a", { x: 1_900, y: 1_900 });
      const before = position();
      simulation.module.step(1 / 30, 4);
      const resumed = position();
      const resumedTravel = Math.hypot(resumed.x - before.x, resumed.y - before.y);
      expect(resumedTravel).toBeGreaterThan(0);
      expect(resumedTravel).toBeLessThanOrEqual(exploreStep + 1e-8);

      // Re-entry: the stale pursuit path is not followed; pursuit is direct at full speed.
      place("player:player-a", { x: resumed.x - 100, y: resumed.y });
      simulation.navigation.processTick();
      simulation.module.step(1 / 30, 5);
      expect(position().x).toBeCloseTo(resumed.x - 2.25, 6);
      expect(position().y).toBeCloseTo(resumed.y, 6);

      place("player:player-a", { x: 1_900, y: 1_900 });
      let stationary = 0;
      for (let tick = 6; tick <= 120; tick += 1) {
        const previous = position();
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        stationary = position().x === previous.x && position().y === previous.y ? stationary + 1 : 0;
        expect(stationary).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
      }
    } finally { simulation.module.dispose(); }
  });

  it("bounds explore path submissions and outstanding work for a large idle wave", () => {
    const simulation = createSimulation([], {
      npcDetectionRange: 0, initialNpcsPerPlayer: 100
    });
    try {
      for (let tick = 1; tick <= 240; tick += 1) {
        const before = simulation.navigation.requestsSubmitted;
        // Leave results pending to exercise the shared outstanding-request ceiling.
        simulation.module.step(1 / 30, tick);
        expect(simulation.navigation.requestsSubmitted - before).toBeLessThanOrEqual(8);
        expect(simulation.navigation.outstandingRequests).toBeLessThanOrEqual(MAX_PENDING_NPC_PATHS);
      }
      expect(simulation.navigation.outstandingRequests).toBe(MAX_PENDING_NPC_PATHS);
    } finally { simulation.module.dispose(); }
  });

  it("abandons unreachable explore goals without idling and retries a reachable destination", () => {
    const simulation = createSimulation(
      [{ x: 736, y: 0, width: 32, height: 2_048 }],
      { npcDetectionRange: 0, initialNpcsPerPlayer: 1 }
    );
    const id = "npc:npc-northwest";
    const metric = vi.spyOn(simulation.context.metrics, "increment");
    // Angle 0 and minimum reach: every candidate lies east of the full-height wall.
    const random = vi.spyOn(simulation.context.random, "next").mockReturnValue(0);
    let stationaryRun = 0;
    let longestStationary = 0;
    let travelled = 0;
    const observe = (tick: number) => {
      const previous = simulation.context.entities.get(id)!.position;
      simulation.navigation.processTick();
      simulation.module.step(1 / 30, tick);
      const position = simulation.context.entities.get(id)!.position;
      expect(position.x).toBeLessThan(736);
      expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
      const travel = Math.hypot(position.x - previous.x, position.y - previous.y);
      travelled += travel;
      stationaryRun = travel > 0 ? 0 : stationaryRun + 1;
      longestStationary = Math.max(longestStationary, stationaryRun);
    };
    try {
      simulation.context.entities.update(id, entity => ({
        ...entity, position: { x: 720, y: 700 }
      }));
      let tick = 0;
      while (!metric.mock.calls.some(([name]) => name === "default.npc_explore.no-path") && tick < 60) {
        observe(tick += 1);
      }
      expect(metric).toHaveBeenCalledWith("default.npc_explore.no-path");
      random.mockRestore();
      const requestsBefore = simulation.navigation.requestsSubmitted;
      for (const end = tick + 300; tick < end;) observe(tick += 1);
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(requestsBefore);
      expect(longestStationary).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
      expect(travelled).toBeGreaterThan(0.75 * tick * 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30);
    } finally { simulation.module.dispose(); }
  });

  it("keeps exploring and retries at the request interval when path requests are rejected", () => {
    const simulation = createSimulation([], { npcDetectionRange: 0, initialNpcsPerPlayer: 1 });
    const id = "npc:npc-northwest";
    const metric = vi.spyOn(simulation.context.metrics, "increment");
    const rejected = vi.spyOn(simulation.context.navigation, "requestPath").mockReturnValue(undefined);
    try {
      const requestTicks: number[] = [];
      let travelled = 0;
      for (let tick = 1; tick <= 90; tick += 1) {
        const calls = rejected.mock.calls.length;
        const previous = simulation.context.entities.get(id)!.position;
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        const position = simulation.context.entities.get(id)!.position;
        travelled += Math.hypot(position.x - previous.x, position.y - previous.y);
        if (rejected.mock.calls.length > calls) requestTicks.push(tick);
      }
      expect(metric).toHaveBeenCalledWith("default.npc_explore.request_rejected");
      expect(requestTicks[0]).toBe(1);
      expect(requestTicks.length).toBeGreaterThanOrEqual(4);
      for (let index = 1; index < requestTicks.length; index += 1) {
        expect(requestTicks[index]! - requestTicks[index - 1]!)
          .toBeGreaterThanOrEqual(NPC_REPATH_INTERVAL_TICKS);
      }
      expect(travelled).toBeGreaterThan(0.75 * 90 * 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30);
      rejected.mockRestore();
      const before = simulation.navigation.requestsSubmitted;
      for (let tick = 91; tick <= 150; tick += 1) {
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
      }
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(before);
    } finally { simulation.module.dispose(); }
  });

  it.each([0, 33.75, 67.5, 90, 180])("travels at %s units/second during direct pursuit", npcMovementSpeed => {
    const simulation = createSimulation([], { npcMovementSpeed });
    const npcId = "npc:npc-northwest";
    try {
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 1_100, y: 700 }
      }));
      for (let tick = 1; tick <= 30; tick += 1) simulation.module.step(1 / 30, tick);
      expect(simulation.context.entities.get(npcId)!.position.x - 700)
        .toBeCloseTo(npcMovementSpeed, 6);
      expect(simulation.context.entities.get(npcId)!.position.y).toBe(700);
    } finally { simulation.module.dispose(); }
  });

  it("keeps zero-speed NPCs stationary without disabling contact damage", () => {
    const simulation = createSimulation([], { npcMovementSpeed: 0 });
    try {
      const npcId = "npc:npc-northwest";
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 710, y: 700 }
      }));
      simulation.module.step(1 / 30, 1);
      expect(simulation.context.entities.get(npcId)!.position).toEqual({ x: 700, y: 700 });
      expect(simulation.context.entities.get("player:player-a")!.state).toMatchObject({ health: 90 });
      expect(simulation.navigation.requestsSubmitted).toBe(0);
    } finally { simulation.module.dispose(); }
  });

  it.each([33.75, 67.5, 90, 180])("routes an attracted NPC around an obstacle at %s units/second", npcMovementSpeed => {
    const wall: Rect = { x: 1_000, y: 800, width: 32, height: 400 };
    const simulation = createSimulation([wall], { npcMovementSpeed, initialNpcsPerPlayer: 1 });
    const npcId = "npc:npc-northwest";
    const playerId = "player:player-a";
    simulation.context.entities.update(npcId, (entity) => ({
      ...entity,
      position: { x: 990, y: 1_000 }
    }));
    simulation.context.entities.update(playerId, (entity) => ({
      ...entity,
      position: { x: 1_100, y: 1_000 }
    }));

    let requestTick = 0;
    do {
      requestTick += 1;
      simulation.module.step(1 / 30, requestTick);
    } while (simulation.navigation.outstandingRequests === 0 && requestTick < 10);
    expect(simulation.navigation.outstandingRequests).toBeGreaterThan(0);
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);

    let travelled = 0;
    for (let tick = requestTick + 1; tick <= Math.ceil(600 / npcMovementSpeed * 30); tick += 1) {
      simulation.navigation.processTick();
      const previous = simulation.context.entities.get(npcId)!.position;
      simulation.module.step(1 / 30, tick);
      const position = simulation.context.entities.get(npcId)!.position;
      const distance = Math.hypot(position.x - previous.x, position.y - previous.y);
      expect(distance).toBeLessThanOrEqual(npcMovementSpeed / 30 + 1e-8);
      expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
      travelled += distance;
      if (tick === requestTick + 30) expect(travelled).toBeCloseTo(npcMovementSpeed, 6);
      if (position.x > wall.x + wall.width && Math.abs(position.y - 1_000) > wall.height / 2) {
        break;
      }
    }

    const position = simulation.context.entities.get(npcId)!.position;
    expect(position.x).toBeGreaterThan(wall.x + wall.width);
    expect(Math.abs(position.y - 1_000)).toBeGreaterThan(wall.height / 2);
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);
    simulation.module.dispose();
  });

  it("caps per-tick path submissions and keeps contact attacks capability-scoped", () => {
    const wall: Rect = { x: 1_000, y: 700, width: 32, height: 700 };
    const simulation = createSimulation([wall]);
    const playerId = "player:player-a";
    simulation.context.entities.update(playerId, (entity) => ({
      ...entity,
      position: { x: 1_100, y: 1_000 }
    }));
    for (let index = 0; index < 20; index += 1) {
      simulation.context.entities.add({
        id: `npc:extra-${index}`,
        typeId: "npc",
        position: { x: 990, y: 720 + index * 30 },
        radius: 8,
        state: {
          kind: "npc",
          attackCapability: {
            typeId: "default.contact-attack",
            damage: 10,
            cooldownTicks: NPC_CONTACT_COOLDOWN_TICKS
          }
        }
      });
    }
    const originalNpc = simulation.context.entities.get("npc:npc-northwest")!;
    simulation.context.entities.update(originalNpc.id, (entity) => ({
      ...entity,
      position: { x: 990, y: 1_000 }
    }));

    simulation.module.step(1 / 30, 1);
    expect(simulation.navigation.requestsSubmitted).toBeLessThanOrEqual(
      MAX_NPC_PATH_REQUESTS_PER_TICK
    );
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);

    simulation.context.entities.update(playerId, (entity) => ({
      ...entity,
      position: { x: 978, y: 1_000 }
    }));
    simulation.module.step(1 / 30, 2);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 90
    });
    simulation.module.step(0, 20);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 90
    });
    simulation.module.step(0, 2 + NPC_CONTACT_COOLDOWN_TICKS);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 80
    });
    simulation.module.dispose();
  });
});

function createSimulation(obstacles: readonly Rect[] = [], settings: Partial<GameSettings> = {}, seed = 42) {
  const entities = new Map<string, DefaultEntity>();
  const spatialGrid = new SpatialGrid(32);
  const store: EntityStore<DefaultEntity> = {
    get: (id) => entities.get(id),
    add: (entity) => {
      if (entities.has(entity.id)) {
        throw new TypeError(`Duplicate entity ID ${entity.id}.`);
      }
      entities.set(entity.id, entity);
      spatialGrid.set(entity);
    },
    update: (id, update) => {
      const entity = entities.get(id);
      if (!entity) {
        throw new RangeError(`Entity ${id} does not exist.`);
      }
      const updated = update(entity);
      entities.set(id, updated);
      spatialGrid.set(updated);
    },
    remove: (id) => {
      spatialGrid.remove(id);
      return entities.delete(id);
    },
    values: () => [...entities.values()],
    queryRadius: (center, radius, maxCells) =>
      spatialGrid.queryRadius(center, radius, maxCells).map(({ id }) => entities.get(id)!)
  };
  const geometry = new WorldGeometry({ width: 2_048, height: 2_048 }, obstacles);
  const navigation = new BoundedNavigation(geometry, {
    cellSize: 32,
    agentRadius: 8
  });
  let requestsSubmitted = 0;
  const results = new Map<string, NavigationPathResult>();
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: new SeededRandom(seed),
    entities: store,
    geometry: {
      isWalkable: (x, y, radius = 0) => geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => geometry.moveCircle(position, delta, radius)
    },
    navigation: {
      requestPath: (from, to) => {
        requestsSubmitted += 1;
        let resultId: string | undefined;
        const requestId = navigation.requestPath(from, to, (result) => {
          if (resultId) {
            results.set(resultId, result);
          }
        });
        if (requestId === undefined) {
          return undefined;
        }
        resultId = String(requestId);
        return resultId;
      },
      getPath: (requestId) => results.get(requestId)
    },
    emit: () => {},
    requestCompletion: () => {},
    metrics: {
      increment: () => {},
      gauge: () => {}
    }
  };
  const module = defaultModuleFactory.create(context, settings, roster, seed);
  module.initialize();
  return {
    context,
    module,
    navigation: {
      processTick: () => navigation.processTick(),
      get outstandingRequests() { return navigation.outstandingRequests; },
      get stats() { return navigation.stats; },
      get requestsSubmitted() { return requestsSubmitted; }
    }
  };
}
