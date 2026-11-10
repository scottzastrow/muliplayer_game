import { describe, expect, it, vi } from "vitest";
import { BoundedNavigation, SessionWorld, WorldGeometry, type Rect } from "@multiplayer-game/engine";
import {
  defaultModuleFactory, generateMap, loadMap, type DefaultEntity
} from "@multiplayer-game/default-theme";
import type { ModuleContext, Point2 } from "@multiplayer-game/theme-sdk";
import { selectNpcSpawns } from "../themes/default/src/module/npc-spawns.js";

function setup(seed: number, mode: "fixed" | "simple-generated", count = 40, extra: Rect[] = []) {
  const map = generateMap(seed, mode).map;
  const world = new SessionWorld<DefaultEntity>("spawns", map.definition.bounds, [...map.obstacles, ...extra]);
  const metrics = { increment: vi.fn(), gauge: vi.fn() };
  const context: ModuleContext<DefaultEntity> & { defaultMapDefinition: typeof map.definition } = {
    defaultMapDefinition: map.definition,
    clock: { nowMs: () => 0 },
    random: { next: () => { throw new Error("Placement must not consume the shared RNG."); } },
    entities: {
      get: id => world.getEntity(id),
      add: entity => world.addEntity(entity),
      update: (id, update) => {
        const entity = world.getEntity(id);
        if (!entity) throw new Error(`Missing entity ${id}`);
        world.addEntity(update(entity));
      },
      remove: id => world.removeEntity(id),
      values: () => world.entities(),
      queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {}, requestCompletion: () => {}, metrics
  };
  const module = defaultModuleFactory.create(context, {
    initialNpcsPerPlayer: count, npcPopulationGrowthPercent: 25, maxLevels: 2
  }, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], seed);
  module.initialize();
  const snapshot = () => module.snapshot({ accountId: "alice", role: "player" });
  return { context, world, map, module, snapshot, metrics };
}

const npcs = (simulation: ReturnType<typeof setup>) =>
  simulation.world.entities().filter(entity => entity.state.kind === "npc");
const zone = (point: Point2) => `${Math.floor(point.x / 512)},${Math.floor(point.y / 512)}`;
const band = (point: Point2, bounds: { width: number; height: number }) => {
  const ratio = Math.min(point.x, point.y, bounds.width - point.x, bounds.height - point.y) /
    Math.min(bounds.width, bounds.height);
  return ratio < 0.1 ? "outer" : ratio < 0.25 ? "middle" : "interior";
};
const quadrant = (point: Point2, bounds: { width: number; height: number }) =>
  `${point.x >= bounds.width / 2 ? 1 : 0},${point.y >= bounds.height / 2 ? 1 : 0}`;

describe("scattered NPC wave placement", () => {
  it("keeps the obstacle browser encounter reproducible without a fixed NPC spawn", () => {
    const simulation = setup(4315, "fixed", 1);
    try {
      expect(npcs(simulation)[0]!.position).toEqual({ x: 880, y: 368 });
    } finally { simulation.module.dispose(); }
  });

  it.each(["fixed", "simple-generated"] as const)(
    "repeats by match seed and wave, spreads both waves and preserves difficulty/terrain on %s",
    mode => {
      const first = setup(42, mode);
      const repeat = setup(42, mode);
      const other = setup(43, mode);
      try {
        const original = first.snapshot();
        const positions = npcs(first).map(entity => entity.position);
        expect(npcs(first)).toHaveLength(40);
        expect(npcs(first).map(entity => entity.state.health)).toEqual(Array(40).fill(50));
        expect(positions).toEqual(npcs(repeat).map(entity => entity.position));
        expect(positions).not.toEqual(npcs(other).map(entity => entity.position));
        const bandCounts = new Map<string, number>();
        for (const position of positions) {
          const value = band(position, first.map.definition.bounds);
          bandCounts.set(value, (bandCounts.get(value) ?? 0) + 1);
        }
        expect(Object.fromEntries(bandCounts)).toEqual({ outer: 8, middle: 16, interior: 16 });
        const counts = new Map<string, number>();
        for (const position of positions) counts.set(zone(position), (counts.get(zone(position)) ?? 0) + 1);
        expect(counts.size).toBe(16);
        expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(4);
        for (const simulation of [first, repeat]) {
          for (const npc of npcs(simulation)) simulation.world.removeEntity(npc.id);
          simulation.context.entities.update("player:alice", entity => ({
            ...entity, position: { x: 700, y: 1_008 }
          }));
          simulation.module.step(0, 1);
          simulation.module.step(0, 151);
        }
        const next = npcs(first);
        expect(next).toHaveLength(50);
        expect(next.map(entity => entity.state.health)).toEqual(Array(50).fill(55));
        expect(next.map(entity => entity.position)).toEqual(npcs(repeat).map(entity => entity.position));
        expect(next.slice(0, 40).map(entity => entity.position)).not.toEqual(positions);
        expect(new Set(next.map(entity => zone(entity.position))).size).toBe(16);
        expect(next.every(entity => Math.hypot(entity.position.x - 700, entity.position.y - 1_008) >= 38))
          .toBe(true);
        expect(first.snapshot().map).toEqual(original.map);
        expect(first.snapshot().radar!.markers.filter(marker => marker.category === "enemy"))
          .toEqual(next.map(entity => ({ id: entity.id, category: "enemy", position: entity.position })));
      } finally {
        first.module.dispose(); repeat.module.dispose(); other.module.dispose();
      }
    }, 10_000
  );

  it("places a ten-NPC Fixed wave in the requested edge bands and across quadrants", () => {
    const simulation = setup(42, "fixed", 10);
    try {
      const positions = npcs(simulation).map(entity => entity.position);
      const bandCounts = new Map<string, number>();
      const quadrantCounts = new Map<string, number>();
      for (const position of positions) {
        const bandName = band(position, simulation.map.definition.bounds);
        const quadrantName = quadrant(position, simulation.map.definition.bounds);
        bandCounts.set(bandName, (bandCounts.get(bandName) ?? 0) + 1);
        quadrantCounts.set(quadrantName, (quadrantCounts.get(quadrantName) ?? 0) + 1);
      }
      expect(Object.fromEntries(bandCounts)).toEqual({ outer: 2, middle: 4, interior: 4 });
      expect(quadrantCounts.size).toBe(4);
      expect(Math.max(...quadrantCounts.values()) - Math.min(...quadrantCounts.values()))
        .toBeLessThanOrEqual(1);
    } finally { simulation.module.dispose(); }
  });

  it("redistributes missing interior-band capacity without truncating the wave", () => {
    const simulation = setup(42, "fixed", 10);
    try {
      const bounds = simulation.map.definition.bounds;
      const blocked = new WorldGeometry(bounds, [
        ...simulation.map.obstacles, { x: 512, y: 512, width: 1_024, height: 1_024 }
      ]);
      const context = { ...simulation.context, geometry: {
        isWalkable: (x: number, y: number, radius = 0) =>
          blocked.isCircleWalkable({ x, y }, radius),
        intersectsObstacle: (x: number, y: number, radius: number) =>
          blocked.intersectsObstacle({ x, y }, radius),
        moveCircle: (position: Point2, delta: Point2, radius: number) =>
          blocked.moveCircle(position, delta, radius)
      } };
      const positions = selectNpcSpawns(
        context, simulation.map, [{ x: 272, y: 272 }], 42, 2, 10
      );
      expect(positions).toHaveLength(10);
      expect(positions.every(position =>
        band(position, simulation.map.definition.bounds) !== "interior")).toBe(true);
      expect(simulation.metrics.increment)
        .toHaveBeenCalledWith("default.npc_spawn.zone_fallback");
    } finally { simulation.module.dispose(); }
  });

  it.each(["fixed", "simple-generated"] as const)(
    "keeps every spawn clear and navigable by a player across several seeds on %s", mode => {
      for (const seed of [0, 1, 42, 43, 999, Number.MAX_SAFE_INTEGER]) {
        const simulation = setup(seed, mode);
        try {
          const player = simulation.world.getEntity("player:alice")!;
          const enemies = npcs(simulation);
          const navigation = new BoundedNavigation(simulation.world.geometry, {
            cellSize: 32, agentRadius: 14, maxNodesPerSearch: 4_096
          });
          const start = navigation.grid.cellAt(player.position)!;
          expect(navigation.grid.canTraverse(player.position, start.position)).toBe(true);
          const visited = new Set([start.index]);
          const queue = [start];
          for (let head = 0; head < queue.length; head += 1) {
            for (const next of navigation.grid.neighbors(queue[head]!)) {
              if (visited.has(next.index)) continue;
              visited.add(next.index);
              queue.push(next);
            }
          }
          for (const [index, npc] of enemies.entries()) {
            expect(simulation.map.isWalkable(npc.position, 14)).toBe(true);
            expect(Math.hypot(npc.position.x - player.position.x, npc.position.y - player.position.y))
              .toBeGreaterThanOrEqual(38);
            for (const other of enemies.slice(0, index)) {
              expect(Math.hypot(npc.position.x - other.position.x, npc.position.y - other.position.y))
                .toBeGreaterThanOrEqual(32);
            }
            const cell = navigation.grid.cellAt(npc.position)!;
            expect(visited.has(cell.index)).toBe(true);
            expect(navigation.grid.canTraverse(cell.position, npc.position)).toBe(true);
          }
        } finally { simulation.module.dispose(); }
      }
    }, 40_000
  );

  it("excludes disconnected clear space and redistributes across remaining zones with bounded work", () => {
    const simulation = setup(42, "fixed", 40, [{ x: 1_024, y: 0, width: 32, height: 2_048 }]);
    try {
      expect(npcs(simulation).every(entity => entity.position.x < 1_024)).toBe(true);
      expect(new Set(npcs(simulation).map(entity => zone(entity.position))).size).toBe(8);
      expect(simulation.metrics.increment).toHaveBeenCalledWith("default.npc_spawn.zone_fallback");
      const move = vi.spyOn(simulation.context.geometry, "moveCircle");
      const positions = selectNpcSpawns(simulation.context, simulation.map, [{ x: 272, y: 272 }], 42, 2, 40);
      expect(positions).toHaveLength(40);
      expect(move.mock.calls.length).toBeLessThanOrEqual(4_096 * 4 + 1);
    } finally { simulation.module.dispose(); }
  });

  it.each(["fixed", "simple-generated"] as const)("fills the existing 2000-NPC ceiling on %s without overlaps or count truncation", mode => {
    const simulation = setup(42, mode);
    try {
      const positions = selectNpcSpawns(simulation.context, simulation.map, [{ x: 272, y: 272 }], 42, 1, 2_000);
      expect(positions).toHaveLength(2_000);
      expect(new Set(positions.map(point => `${point.x},${point.y}`)).size).toBe(2_000);
      expect(positions.every(position => simulation.map.isWalkable(position, 14))).toBe(true);
    } finally { simulation.module.dispose(); }
  });

  it("clears every current player and still spawns the full wave when all avatars are absent", () => {
    const simulation = setup(42, "simple-generated");
    try {
      const players = simulation.map.definition.spawns.filter(spawn => spawn.kind === "player")
        .map(spawn => spawn.position);
      const positions = selectNpcSpawns(simulation.context, simulation.map, players, 42, 2, 2_000);
      expect(positions).toHaveLength(2_000);
      for (const position of positions) {
        expect(players.every(player => Math.hypot(player.x - position.x, player.y - position.y) >= 38))
          .toBe(true);
      }
      expect(selectNpcSpawns(simulation.context, simulation.map, [], 42, 2, 40)).toHaveLength(40);
    } finally { simulation.module.dispose(); }
  });

  it("fails explicitly when all reachable zones lack space instead of overlapping or erasing enemies", () => {
    const simulation = setup(42, "fixed");
    try {
      const tiny = loadMap({
        formatVersion: 1, id: "tiny", name: "Tiny", bounds: { width: 64, height: 64 },
        cellSize: 32, objects: [], collisions: [],
        spawns: [
          { id: "a", kind: "player", position: { x: 16, y: 16 }, radius: 14 },
          { id: "b", kind: "player", position: { x: 48, y: 48 }, radius: 14 }
        ]
      });
      const geometry = new WorldGeometry(tiny.definition.bounds, tiny.obstacles);
      const context = { ...simulation.context, geometry: {
        isWalkable: (x: number, y: number, radius = 0) =>
          geometry.isCircleWalkable({ x, y }, radius),
        intersectsObstacle: (x: number, y: number, radius: number) =>
          geometry.intersectsObstacle({ x, y }, radius),
        moveCircle: (position: Point2, delta: Point2, radius: number) =>
          geometry.moveCircle(position, delta, radius)
      } };
      const before = npcs(simulation);
      expect(() => selectNpcSpawns(context, tiny, [{ x: 16, y: 16 }], 42, 1, 2))
        .toThrow("only 1 reachable clear NPC locations for 2 enemies");
      expect(simulation.metrics.increment).toHaveBeenCalledWith("default.npc_spawn.insufficient_space");
      expect(npcs(simulation)).toEqual(before);
    } finally { simulation.module.dispose(); }
  });
});
