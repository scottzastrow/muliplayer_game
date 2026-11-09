import { describe, expect, it } from "vitest";
import authoredMapFixture from "../themes/default/maps/authored-fixture.json" with { type: "json" };
import {
  BoundedNavigation,
  WorldGeometry
} from "@multiplayer-game/engine";
import {
  DEFAULT_ARENA_ID,
  DEFAULT_ARENA_NAME,
  MAX_MAP_GENERATION_ATTEMPTS,
  MapValidationError,
  generateMap,
  loadMap
} from "@multiplayer-game/default-theme";
import { validateMapDefinition } from "@multiplayer-game/theme-sdk";

describe("default theme maps", () => {
  it("loads authored map documents through the shared validation and geometry path", () => {
    const map = loadMap(authoredMapFixture);
    const definition = validateMapDefinition(authoredMapFixture);

    expect(map.definition).toEqual(definition);
    expect(map.definition.id).toBe("authored-compatibility-fixture");
    expect(map.definition.objects[0]).toMatchObject({
      id: "fixture-pillar",
      typeId: "terrain.pillar",
      tags: ["obstacle", "fixture"],
      properties: { material: "test-stone", decorative: true }
    });
    expect(map.obstacles).toEqual([{ x: 112, y: 112, width: 32, height: 32 }]);
    expect(map.isWalkable({ x: 48, y: 48 }, 14)).toBe(true);
    expect(map.isWalkable({ x: 128, y: 128 }, 0)).toBe(false);
  });

  it("rejects malformed, blocked, or unreachable authored spawns", () => {
    expect(() => loadMap({ ...authoredMapFixture, extra: true })).toThrow(MapValidationError);

    const blockedSpawn = structuredClone(authoredMapFixture);
    blockedSpawn.spawns[0]!.position = { x: 112, y: 112 };
    expect(() => loadMap(blockedSpawn)).toThrow(/Spawn fixture-player-a is not walkable/);

    const disconnected = structuredClone(authoredMapFixture);
    disconnected.objects = [
      {
        id: "divider",
        typeId: "terrain.wall",
        position: { x: 128, y: 128 },
        tags: ["obstacle"]
      }
    ];
    disconnected.collisions = [
      {
        id: "divider-collision",
        objectId: "divider",
        shape: { type: "rect", width: 32, height: 256 }
      }
    ];
    expect(() => loadMap(disconnected)).toThrow(/unreachable by a player/);
  });

  it("keeps Tile Cluster Arena fixed across seeds", () => {
    const first = generateMap(42);
    const second = generateMap(42);
    const otherSeed = generateMap(43);

    expect(first.source).toBe("fixed");
    expect(first.attempts).toBe(0);
    expect(first.map.definition).toEqual(second.map.definition);
    expect(first.map.definition.id).toBe(DEFAULT_ARENA_ID);
    expect(first.map.definition.name).toBe(DEFAULT_ARENA_NAME);
    expect(first.map.definition.bounds).toEqual({ width: 2_048, height: 2_048 });
    expect(first.map.definition.cellSize).toBe(32);
    expect(first.map.definition.spawns.filter((spawn) => spawn.kind === "player")).toHaveLength(32);
    expect(first.map.obstacles).toHaveLength(64);
    expect(otherSeed.map.obstacles).toEqual(first.map.obstacles);
    for (const spawn of first.map.definition.spawns) {
      expect(first.map.isWalkable(spawn.position, spawn.radius)).toBe(true);
    }
    for (const obstacle of first.map.obstacles) {
      expect(
        first.map.isWalkable(
          { x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 },
          0
        )
      ).toBe(false);
    }
  });

  it("keeps expanded fixed terrain clear of spawns and every walkable region connected", () => {
    const map = generateMap(42).map;
    const geometry = new WorldGeometry(map.definition.bounds, map.obstacles);
    for (const spawn of map.definition.spawns) {
      expect(geometry.isCircleWalkable(spawn.position, spawn.radius + 64)).toBe(true);
    }
    for (let coordinate = 80; coordinate <= 1_968; coordinate += 16) {
      expect(geometry.isCircleWalkable({ x: 1_008, y: coordinate }, 14)).toBe(true);
      expect(geometry.isCircleWalkable({ x: coordinate, y: 1_008 }, 14)).toBe(true);
    }
    const navigation = new BoundedNavigation(geometry, { cellSize: 32, agentRadius: 14 });
    const start = navigation.grid.cellAt(map.definition.spawns[0]!.position)!;
    const visited = new Set([start.index]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      for (const next of navigation.grid.neighbors(queue[head]!)) {
        if (visited.has(next.index)) continue;
        visited.add(next.index);
        queue.push(next);
      }
    }
    for (let index = 0; index < 64 * 64; index += 1) {
      const cell = navigation.grid.cellByIndex(index);
      if (navigation.grid.isWalkable(cell)) expect(visited.has(index)).toBe(true);
    }
    expect(new Set(map.definition.objects.map(object => object.properties?.clusterId)).size).toBe(16);
    for (const [x, y] of [[0, 0], [1_024, 0], [0, 1_024], [1_024, 1_024]] as const) {
      expect(map.obstacles.filter(obstacle =>
        obstacle.x >= x && obstacle.x < x + 1_024 &&
        obstacle.y >= y && obstacle.y < y + 1_024
      )).toHaveLength(16);
    }
  });

  it("generates repeatable, varied layouts validated for every spawn", () => {
    const first = generateMap(42, "simple-generated");
    const repeat = generateMap(42, "simple-generated");
    const other = generateMap(43, "simple-generated");
    expect(first.source).toBe("generated");
    expect(first.map.definition).toEqual(repeat.map.definition);
    expect(first.attempts).toBe(repeat.attempts);
    expect(other.source).toBe("generated");
    expect(other.map.obstacles).not.toEqual(first.map.obstacles);
    expect(first.map.definition.name).toBe("Simple Generated");
    expect(first.map.obstacles).toHaveLength(16);
    for (let seed = 0; seed < 32; seed += 1) {
      const { map, attempts } = generateMap(seed, "simple-generated");
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(attempts).toBeLessThanOrEqual(MAX_MAP_GENERATION_ATTEMPTS);
      expect(loadMap(map.definition).obstacles).toEqual(map.obstacles);
      for (const spawn of map.definition.spawns) {
        expect(map.isWalkable(spawn.position, spawn.radius)).toBe(true);
      }
    }
  });

  it("clears the seed-42 walk-around at full player radius, including west-face tangency", () => {
    const map = generateMap(42, "simple-generated").map;
    const geometry = new WorldGeometry(map.definition.bounds, map.obstacles);
    const route = [
      { x: 530, y: 464 }, { x: 530, y: 400 },
      { x: 704, y: 400 }, { x: 704, y: 464 }
    ];
    for (let index = 1; index < route.length; index += 1) {
      const from = route[index - 1]!;
      const to = route[index]!;
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y));
      for (let step = 0; step <= steps; step += 1) {
        const point = {
          x: from.x + (to.x - from.x) * step / steps,
          y: from.y + (to.y - from.y) * step / steps
        };
        expect(map.isWalkable(point, 14)).toBe(true);
        expect(geometry.isCircleWalkable(point, 14)).toBe(true);
      }
      expect(geometry.moveCircle(from, { x: to.x - from.x, y: to.y - from.y }, 14))
        .toEqual(to);
    }
    expect(map.isWalkable({ x: 624, y: 464 }, 14)).toBe(false);
    expect(map.isWalkable({ x: 650, y: 464 }, 0)).toBe(true);
    expect(map.isWalkable({ x: 650, y: 464 }, 14)).toBe(false);
  });

  it("falls back to the fixed arena after four invalid candidates and propagates other failures", () => {
    const fixed = generateMap(42, "fixed").map;
    const invalid = structuredClone(fixed.definition);
    invalid.spawns[0]!.position = {
      x: fixed.obstacles[0]!.x + 16,
      y: fixed.obstacles[0]!.y + 16
    };
    const attempts: number[] = [];
    const fallback = generateMap(42, "simple-generated", (_seed, attempt) => {
      attempts.push(attempt);
      return invalid;
    });
    expect(attempts).toEqual([0, 1, 2, 3]);
    expect(fallback.source).toBe("fallback");
    expect(fallback.attempts).toBe(MAX_MAP_GENERATION_ATTEMPTS);
    expect(fallback.map.definition).toEqual(fixed.definition);
    expect(() => generateMap(42, "simple-generated", () => {
      throw new Error("generator failure");
    })).toThrow("generator failure");
    expect(() => generateMap(Number.NaN, "fixed")).toThrow(RangeError);
  });

  it("blocks direct movement and routes around the encounter cluster", () => {
    const map = generateMap(42).map;
    const geometry = new WorldGeometry(map.definition.bounds, map.obstacles);
    let position = { x: 272, y: 272 };
    let encounteredBlock = false;
    for (let tick = 0; tick < 40; tick += 1) {
      const desired = { x: position.x + 6, y: position.y + 6 };
      position = geometry.moveCircle(position, { x: 6, y: 6 }, 14);
      if (position.x !== desired.x || position.y !== desired.y) encounteredBlock = true;
      expect(geometry.isCircleWalkable(position, 14)).toBe(true);
    }
    expect(encounteredBlock).toBe(true);

    const navigation = new BoundedNavigation(geometry, { cellSize: 32, agentRadius: 8 });
    let result:
      | { status: "found" | "no-path" | "limit"; path: readonly { x: number; y: number }[] }
      | undefined;
    navigation.requestPath({ x: 528, y: 528 }, { x: 272, y: 272 }, (pathResult) => {
      result = pathResult;
    });
    for (let tick = 0; tick < 10 && !result; tick += 1) navigation.processTick();

    expect(result?.status).toBe("found");
    const path = result?.path ?? [];
    expect(path.slice(1, -1).some((point) => point.x < 384 || point.y < 384)).toBe(true);
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1]!;
      const to = path[index]!;
      const reached = geometry.moveCircle(
        from,
        { x: to.x - from.x, y: to.y - from.y },
        8
      );
      expect(reached.x).toBeCloseTo(to.x, 5);
      expect(reached.y).toBeCloseTo(to.y, 5);
    }
  });

  it("uses a bounded map validation retry budget", () => {
    expect(MAX_MAP_GENERATION_ATTEMPTS).toBe(4);
    expect(generateMap(0).attempts).toBeLessThanOrEqual(MAX_MAP_GENERATION_ATTEMPTS);
  });
});
