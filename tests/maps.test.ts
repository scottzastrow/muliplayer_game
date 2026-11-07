import { describe, expect, it } from "vitest";
import authoredMapFixture from "../themes/default/maps/authored-fixture.json" with { type: "json" };
import {
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

    expect(first.map.definition).toEqual(second.map.definition);
    expect(first.map.definition.bounds).toEqual({ width: 2_048, height: 2_048 });
    expect(first.map.definition.cellSize).toBe(32);
    expect(first.map.definition.spawns.filter((spawn) => spawn.kind === "player")).toHaveLength(32);
    expect(first.map.obstacles.length).toBeGreaterThan(0);
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

  it("uses a known-valid fallback after the fixed generation attempt budget", () => {
    const fallback = Array.from({ length: 128 }, (_, seed) => generateMap(seed))
      .find((result) => result.source === "fallback");

    expect(fallback).toBeDefined();
    expect(fallback?.attempts).toBe(MAX_MAP_GENERATION_ATTEMPTS);
    expect(fallback?.map.definition.id).toBe("fallback-open-arena");
    for (const spawn of fallback?.map.definition.spawns ?? []) {
      expect(fallback?.map.isWalkable(spawn.position, spawn.radius)).toBe(true);
    }
  });
});
