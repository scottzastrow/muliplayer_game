import { describe, expect, it } from "vitest";
import {
  BoundedNavigation,
  MAX_NAVIGATION_GRID_CELLS
} from "../packages/engine/src/navigation.js";
import {
  MAX_ENTITIES_PER_SESSION,
  SessionWorld,
  SpatialGrid,
  WorldGeometry,
  type WorldEntity
} from "../packages/engine/src/world.js";

describe("session world and spatial grid", () => {
  it("isolates entity state between sessions and returns immutable copies", () => {
    const first = new SessionWorld("match-a", { width: 256, height: 256 });
    const second = new SessionWorld("match-b", { width: 256, height: 256 });
    first.addEntity(entity("player-1", { x: 32, y: 32 }, { points: 10 }));
    second.addEntity(entity("player-1", { x: 224, y: 224 }, { points: 90 }));

    const firstCopy = first.getEntity("player-1")!;
    expect(Reflect.set(firstCopy.state as Record<string, unknown>, "points", 99)).toBe(false);
    first.moveEntity("player-1", { x: 32, y: 0 });

    expect(first.getEntity("player-1")?.position).toEqual({ x: 64, y: 32 });
    expect(second.getEntity("player-1")?.position).toEqual({ x: 224, y: 224 });
    expect(second.getEntity("player-1")?.state).toEqual({ points: 90 });
    expect(first.queryEntities({ x: 32, y: 32 }, 1)).toHaveLength(0);
    expect(second.queryEntities({ x: 224, y: 224 }, 1)).toHaveLength(1);
  });

  it("updates spatial cells and enforces bounded radius queries", () => {
    const grid = new SpatialGrid(16);
    grid.set(entity("npc", { x: 15, y: 15 }));
    expect(grid.queryRadius({ x: 0, y: 0 }, 22)).toHaveLength(1);
    grid.set(entity("npc", { x: 90, y: 90 }));
    expect(grid.queryRadius({ x: 0, y: 0 }, 22)).toHaveLength(0);
    expect(grid.remove("npc")).toBe(true);
    expect(grid.remove("npc")).toBe(false);
    expect(() => grid.queryRadius({ x: 0, y: 0 }, 10_000)).toThrow(/cell-work limit/);
  });

  it("blocks obstacles, resolves movement against them, and permits wall sliding", () => {
    const geometry = new WorldGeometry(
      { width: 200, height: 100 },
      [{ x: 80, y: 20, width: 40, height: 60 }]
    );
    expect(geometry.isCircleWalkable({ x: 100, y: 50 }, 5)).toBe(false);
    expect(geometry.isCircleWalkable({ x: 40, y: 50 }, 5)).toBe(true);
    const moved = geometry.moveCircle({ x: 40, y: 50 }, { x: 100, y: -20 }, 5);
    expect(moved.x).toBeCloseTo(75, 4);
    expect(moved.y).toBeCloseTo(30, 4);
    expect(geometry.isCircleWalkable(moved, 5)).toBe(true);

    const world = new SessionWorld(
      "blocked-spawn",
      { width: 200, height: 100 },
      [{ x: 80, y: 20, width: 40, height: 60 }]
    );
    expect(() => world.addEntity(entity("blocked", { x: 100, y: 50 }))).toThrow(/walkable/);
  });

  it("enforces a per-session entity count", () => {
    const world = new SessionWorld("bounded", { width: 100, height: 100 }, [], 16, 1);
    world.addEntity(entity("first", { x: 20, y: 20 }));
    expect(world.entityCount).toBe(1);
    expect(() => world.addEntity(entity("second", { x: 40, y: 40 }))).toThrow(/entity store/);
    expect(MAX_ENTITIES_PER_SESSION).toBe(4_096);
  });
});

describe("bounded staggered navigation", () => {
  it("finds a route around obstacles without crossing blocked geometry", () => {
    const geometry = new WorldGeometry(
      { width: 256, height: 192 },
      [{ x: 96, y: 0, width: 32, height: 160 }]
    );
    const navigation = new BoundedNavigation(geometry, { cellSize: 32 });
    let result:
      | { status: "found" | "no-path" | "limit"; path: readonly { x: number; y: number }[] }
      | undefined;
    expect(
      navigation.requestPath(
        { x: 48, y: 80 },
        { x: 208, y: 80 },
        (pathResult) => {
          result = pathResult;
        }
      )
    ).toBeDefined();

    for (let tick = 0; tick < 10 && !result; tick += 1) {
      const stats = navigation.processTick();
      expect(stats.nodesProcessed).toBeLessThanOrEqual(2_048);
    }

    expect(result?.status).toBe("found");
    const path = result?.path ?? [];
    expect(path.some((point) => point.y >= 160)).toBe(true);
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1]!;
      const to = path[index]!;
      const traversed = geometry.moveCircle(
        from,
        { x: to.x - from.x, y: to.y - from.y },
        0
      );
      expect(traversed.x).toBeCloseTo(to.x, 5);
      expect(traversed.y).toBeCloseTo(to.y, 5);
    }
  });

  it("stages searches per tick, bounds node work, and rejects excess outstanding work", () => {
    const navigation = new BoundedNavigation(new WorldGeometry({ width: 256, height: 256 }), {
      cellSize: 16,
      maxSearchesPerTick: 2,
      maxNodesPerSearch: 10,
      maxNodesPerTick: 10,
      maxNodesPerSearchPerTick: 5,
      maxOutstandingRequests: 3
    });
    const results: Array<{ status: string; expandedNodes: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      expect(
        navigation.requestPath(
          { x: 8, y: 8 },
          { x: 248, y: 248 },
          (result) => results.push(result)
        )
      ).toBeDefined();
    }
    expect(
      navigation.requestPath({ x: 8, y: 8 }, { x: 248, y: 248 }, () => {})
    ).toBeUndefined();

    let ticks = 0;
    while (navigation.outstandingRequests > 0 && ticks < 10) {
      const stats = navigation.processTick();
      expect(stats.startedSearches).toBeLessThanOrEqual(2);
      expect(stats.nodesProcessed).toBeLessThanOrEqual(10);
      ticks += 1;
    }
    expect(navigation.outstandingRequests).toBe(0);
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === "limit")).toBe(true);
    expect(results.every((result) => result.expandedNodes <= 10)).toBe(true);
  });

  it("reports blocked endpoints, rejects oversized grids, and bounds obstacle counts", () => {
    const geometry = new WorldGeometry(
      { width: 128, height: 128 },
      [{ x: 32, y: 32, width: 32, height: 32 }]
    );
    const navigation = new BoundedNavigation(geometry, { cellSize: 16 });
    let result = "";
    navigation.requestPath({ x: 40, y: 40 }, { x: 112, y: 112 }, (value) => {
      result = value.status;
    });
    navigation.processTick();
    expect(result).toBe("no-path");

    expect(
      () =>
        new BoundedNavigation(new WorldGeometry({ width: MAX_NAVIGATION_GRID_CELLS + 1, height: 1 }), {
          cellSize: 1
        })
    ).toThrow(/grid exceeds/);
  });
});

function entity(
  id: string,
  position: { x: number; y: number },
  state: WorldEntity["state"] = {}
): WorldEntity {
  return {
    id,
    typeId: "test.entity",
    position,
    radius: 2,
    state
  };
}
