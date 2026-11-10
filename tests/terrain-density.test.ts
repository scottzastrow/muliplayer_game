import { describe, expect, it } from "vitest";
import { GameSettingsSchema, DEFAULT_GAME_SETTINGS, resolveTerrainDensity } from "@multiplayer-game/protocol";
import { AuthoritativeMapTransition, BoundedNavigation, SessionWorld, WorldGeometry } from "@multiplayer-game/engine";
import { generateDensityMap, loadMap, defaultModuleFactory, PLAYER_RADIUS, SAFE_SPAWN_MARGIN,
  type DefaultEntity } from "@multiplayer-game/default-theme";
import type { ModuleContext, NavigationPathResult } from "@multiplayer-game/theme-sdk";
import { DefaultViewSchema } from "../themes/default/src/skin/view.js";

describe("terrain density schedules", () => {
  it("resolves Incremental, caps at ten and supports steady zero increase", () => {
    const schedule = { mode: "incremental", startingDensity: 3, increasePerLevel: 2 };
    expect(Array.from({ length: 6 }, (_, index) => resolveTerrainDensity(schedule, index + 1, 6)))
      .toEqual([3, 5, 7, 9, 10, 10]);
    expect(resolveTerrainDensity({ ...schedule, increasePerLevel: 0 }, 6, 6)).toBe(3);
    expect(resolveTerrainDensity(undefined, 1, 5)).toBe(3);
  });

  it("resolves explicit Per Level and rejects invalid shapes, values and counts", () => {
    const schedule = { mode: "per-level", densities: [0, 3, 10] };
    expect([1, 2, 3].map(level => resolveTerrainDensity(schedule, level, 3))).toEqual([0, 3, 10]);
    for (const terrainDensity of [
      null,
      { mode: "incremental", increasePerLevel: 0 },
      { mode: "per-level", densities: [0, 3] },
      { mode: "per-level", densities: [0, 3, 10.1] },
      { mode: "incremental", startingDensity: -1, increasePerLevel: 0 },
      { mode: "incremental", startingDensity: 3, increasePerLevel: 11 },
      { mode: "incremental", startingDensity: 3, increasePerLevel: 0.5 },
      { mode: "incremental", startingDensity: 3, increasePerLevel: 0, extra: true }
    ]) expect(GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS, maxLevels: 3, terrainDensity }).success)
      .toBe(false);
    expect(() => resolveTerrainDensity(schedule, 0, 3)).toThrow();
    expect(() => resolveTerrainDensity(schedule, 4, 3)).toThrow();
    expect(GameSettingsSchema.parse(DEFAULT_GAME_SETTINGS)).not.toHaveProperty("terrainDensity");
    expect(GameSettingsSchema.parse(DEFAULT_GAME_SETTINGS)).not.toHaveProperty("mapMode");
  });

  it("keeps Fixed/legacy maps intact and defaults explicit generated mode to 3/0", () => {
    expect(defaultModuleFactory.createInitialMap?.({}, 42)).toBeUndefined();
    const fixed = defaultModuleFactory.createInitialMap?.({ mapMode: "fixed",
      terrainDensity: { mode: "incremental", startingDensity: 10, increasePerLevel: 10 } }, 42);
    const fixedWithoutDensity = defaultModuleFactory.createInitialMap?.({ mapMode: "fixed" }, 42);
    expect(fixed).toEqual(fixedWithoutDensity);
    expect(fixed!.collisions).toHaveLength(641);
    expect(defaultModuleFactory.createInitialMap?.({ mapMode: "simple-generated" }, 42))
      .toEqual(generateDensityMap(42, 1, 3).map.definition);
  });
});

describe("density geometry", () => {
  it.each([0, 3, 10])("measures density %i, safe spawns and all connected collision-resolved routes", density => {
    const generated = generateDensityMap(42, 1, density);
    const { map, terrain } = generated;
    expect(loadMap(map.definition).definition).toEqual(map.definition);
    const geometry = new WorldGeometry(map.definition.bounds, map.obstacles);
    const area = map.obstacles.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(terrain.actualCoveragePercent).toBe(area / (2048 * 2048) * 100);
    expect(terrain.targetCoveragePercent).toBe(density * 8);
    expect(terrain.actualCoveragePercent).toBeLessThanOrEqual(terrain.targetCoveragePercent);
    if (density === 0) expect(map.obstacles).toHaveLength(0);
    if (density === 3) expect(terrain.actualCoveragePercent).toBeGreaterThan(23.9);
    if (density === 10) expect(terrain.budgetExhausted).toBe(true);
    for (const spawn of map.definition.spawns) {
      expect(geometry.isCircleWalkable(spawn.position, spawn.radius + SAFE_SPAWN_MARGIN)).toBe(true);
    }
    const positions = Array.from({ length: 4096 }, (_, index) =>
      ({ x: (index % 64 + 0.5) * 32, y: (Math.floor(index / 64) + 0.5) * 32 }));
    const walkable = positions.map(position => geometry.isCircleWalkable(position, PLAYER_RADIUS));
    const first = walkable.findIndex(Boolean);
    const seen = new Set([first]);
    const queue = [first];
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head]!;
      for (const next of [index % 64 > 0 ? index - 1 : -1, index % 64 < 63 ? index + 1 : -1,
        index >= 64 ? index - 64 : -1, index < 4032 ? index + 64 : -1]) {
        if (next < 0 || seen.has(next) || !walkable[next]) continue;
        const from = positions[index]!, to = positions[next]!;
        expect(geometry.moveCircle(from, { x: to.x - from.x, y: to.y - from.y }, PLAYER_RADIUS))
          .toEqual(to);
        seen.add(next);
        queue.push(next);
      }
    }
    expect(seen.size).toBe(walkable.filter(Boolean).length);
    console.log(`density=${density} seed=42 level=1 target=${terrain.targetCoveragePercent}% actual=${terrain.actualCoveragePercent}% shortfall=${terrain.budgetExhausted}`);
  });

  it("repeats by seed/level/density and changes with each input", () => {
    const first = generateDensityMap(42, 1, 3);
    const repeated = generateDensityMap(42, 1, 3);
    expect(repeated.map.definition).toEqual(first.map.definition);
    expect(repeated.terrain).toEqual(first.terrain);
    expect(generateDensityMap(43, 1, 3).map.definition).not.toEqual(first.map.definition);
    expect(generateDensityMap(42, 2, 3).map.obstacles).not.toEqual(first.map.obstacles);
    expect(generateDensityMap(42, 1, 4).map.obstacles).not.toEqual(first.map.obstacles);
    expect(generateDensityMap(42, 2, 10).map.obstacles)
      .not.toEqual(generateDensityMap(42, 1, 10).map.obstacles);
  });
});

describe("reusable authoritative map transition", () => {
  it("prepares without mutation and commits atomically, rejecting invalid/stale tokens", () => {
    const world = new SessionWorld("transition", { width: 128, height: 128 });
    const navigation = new BoundedNavigation(world.geometry);
    const results = new Map();
    const transition = new AuthoritativeMapTransition(world, navigation, () => results.clear());
    const entity = { id: "player", typeId: "player", radius: 8, position: { x: 16, y: 16 }, state: null };
    world.addEntity(entity);
    navigation.requestPath(entity.position, { x: 112, y: 112 }, () => results.set("old", true));
    const token = transition.prepare({ bounds: world.geometry.bounds, cellSize: 32,
      obstacles: [{ x: 0, y: 0, width: 32, height: 32 }] });
    const other = new SessionWorld("other", { width: 128, height: 128 });
    const otherTransition = new AuthoritativeMapTransition(other, new BoundedNavigation(other.geometry), () => {});
    const otherToken = otherTransition.prepare({ bounds: other.geometry.bounds, cellSize: 32, obstacles: [] });
    expect(() => transition.commit(otherToken, [])).toThrow();
    expect(() => otherTransition.commit(token, [])).toThrow();
    expect(world.geometry.obstacles).toHaveLength(0);
    expect(() => transition.commit(token, [entity])).toThrow(/walkable/);
    expect(world.getEntity(entity.id)).toEqual(entity);
    expect(world.geometry.obstacles).toHaveLength(0);
    transition.commit(token, [{ ...entity, position: { x: 80, y: 80 } }]);
    expect(world.geometry.obstacles).toHaveLength(1);
    expect(navigation.geometry).toBe(world.geometry);
    expect(navigation.outstandingRequests).toBe(0);
    navigation.processTick();
    expect(results.size).toBe(0);
    expect(() => transition.commit(token, [])).toThrow();
    expect(() => transition.commit(-1, [])).toThrow();
  });

  it("uses new geometry for collision, blocked shots, paths and safe returns without resetting players", () => {
    const initial = generateDensityMap(42, 1, 0);
    const world = new SessionWorld<DefaultEntity>("density-game", initial.map.definition.bounds);
    const navigation = new BoundedNavigation(world.geometry, { agentRadius: 8 });
    const paths = new Map<string, NavigationPathResult>();
    const maps = new AuthoritativeMapTransition(world, navigation, () => paths.clear());
    let nextId = 0;
    const context: ModuleContext<DefaultEntity> & { defaultMapDefinition: typeof initial.map.definition } = {
      defaultMapDefinition: initial.map.definition, maps,
      clock: { nowMs: () => 0 }, random: { next: () => 0.5 },
      entities: {
        get: id => world.getEntity(id), add: entity => world.addEntity(entity),
        update: (id, update) => world.addEntity(update(world.getEntity(id)!)),
        remove: id => world.removeEntity(id), values: () => world.entities(),
        queryRadius: (point, radius, maxCells) => world.queryEntities(point, radius, maxCells)
      },
      geometry: {
        isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
        intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
        moveCircle: (point, delta, radius) => world.geometry.moveCircle(point, delta, radius)
      },
      navigation: {
        requestPath: (from, to) => {
          const id = String(++nextId);
          return navigation.requestPath(from, to, result => paths.set(id, result)) === undefined
            ? undefined : id;
        },
        getPath: id => paths.get(id)
      },
      emit: () => {}, requestCompletion: () => {}, metrics: { gauge: () => {}, increment: () => {} }
    };
    const roster = [{ accountId: "alice", username: "Alice", joinedOrder: 0 },
      { accountId: "bob", username: "Bob", joinedOrder: 1 }];
    const module = defaultModuleFactory.create(context, {
      mapMode: "simple-generated", terrainDensity: { mode: "per-level", densities: [0, 3] },
      maxLevels: 2, initialNpcsPerPlayer: 1, npcMovementSpeed: 0, respawnDelaySeconds: 10
    }, roster, 42);
    try {
      module.initialize();
      context.entities.update("player:alice", entity => ({ ...entity,
        state: { ...entity.state, health: 70, points: 400, kills: 4 } }));
      context.entities.update("player:bob", entity => ({ ...entity,
        state: { ...entity.state, health: 0, points: 200 } }));
      for (const entity of world.entities()) if (entity.state.kind === "npc") world.removeEntity(entity.id);
      module.step(0, 1);
      const cleared = DefaultViewSchema.parse(module.snapshot({ accountId: "alice", role: "player" }));
      expect(cleared.players[1]).toMatchObject({ alive: false, respawnAtTick: 301, points: 200 });
      module.step(0, 150);
      expect(world.geometry.obstacles).toHaveLength(0);
      module.step(0, 151);
      expect(world.getEntity("player:alice")!.state).toMatchObject({ health: 70, points: 400, kills: 4 });
      expect(world.getEntity("player:bob")).toBeUndefined();
      const changed = DefaultViewSchema.parse(module.snapshot({ accountId: "alice", role: "player" }));
      expect(changed.players[1]).toMatchObject({ alive: false, respawnAtTick: 301, points: 200 });
      expect(changed.map.obstacles).toEqual(world.geometry.obstacles);
      const encounter = world.geometry.obstacles.map(obstacle => ({
        obstacle, start: { x: obstacle.x - 30, y: obstacle.y + 16 },
        target: { x: obstacle.x + obstacle.width + 30, y: obstacle.y + 16 }
      })).find(({ start, target }) => world.geometry.isCircleWalkable(start, 14) &&
        world.geometry.isCircleWalkable(target, 8));
      expect(encounter).toBeDefined();
      const { obstacle, start, target } = encounter!;
      context.entities.update("player:alice", entity => ({ ...entity, position: start }));
      const npc = world.entities().find(entity => entity.state.kind === "npc")!;
      context.entities.update(npc.id, entity => ({ ...entity, position: target }));
      const pathId = context.navigation.requestPath(start, target)!;
      for (let work = 0; work < 20 && !paths.has(pathId); work += 1) navigation.processTick();
      expect(paths.get(pathId)?.status).toBe("found");
      for (const point of paths.get(pathId)!.path) expect(world.geometry.isCircleWalkable(point, 8)).toBe(true);
      module.applyInput("alice", { type: "combat", moveX: 1, moveY: 0,
        aimX: target.x, aimY: target.y, fire: true });
      for (let tick = 152; tick <= 181; tick += 1) module.step(1 / 30, tick);
      expect(world.getEntity("player:alice")!.position.x).toBeLessThanOrEqual(obstacle.x - 14);
      expect(world.getEntity(npc.id)!.state.health).toBe(npc.state.health);
      expect(world.entities().filter(entity => entity.state.kind === "projectile")).toHaveLength(0);
      module.applyInput("alice", { type: "combat", moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false });
      module.step(0, 300);
      expect(world.getEntity("player:bob")).toBeUndefined();
      module.step(0, 301);
      const bob = world.getEntity("player:bob")!;
      expect(bob.state).toMatchObject({ health: 150, points: 200, deaths: 1 });
      expect(world.geometry.isCircleWalkable(bob.position, bob.radius + SAFE_SPAWN_MARGIN)).toBe(true);
    } finally {
      module.dispose();
    }
  });
});
