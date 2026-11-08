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

  it("generates deterministic connected maps with legal default spawns", () => {
    const first = generateMap(42);
    const second = generateMap(42);
    const otherSeed = generateMap(43);

    expect(first.map.definition).toEqual(second.map.definition);
    expect(first.map.definition.id).toBe(DEFAULT_ARENA_ID);
    expect(first.map.definition.name).toBe(DEFAULT_ARENA_NAME);
    expect(first.map.definition.bounds).toEqual({ width: 2_048, height: 2_048 });
    expect(first.map.definition.cellSize).toBe(32);
    expect(first.map.definition.spawns.filter((spawn) => spawn.kind === "player")).toHaveLength(32);
    expect(first.map.obstacles).toHaveLength(16);
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
