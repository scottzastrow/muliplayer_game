import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { combatIntent, LoadViewSchema, seededRandom, WorkloadSchema } from "../tools/load/index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const config = {
  target: "http://127.0.0.1:3000", seed: 42, playersPerRoom: 1, spectatorsPerRoom: 0,
  warmupSeconds: 0, steps: [{ rooms: 1, seconds: 1 }], soakSeconds: 0,
  settings: DEFAULT_GAME_SETTINGS
};

describe("external load workload", () => {
  it("validates the supplied matrix and bounds clients, timing, target and roster settings", () => {
    expect(WorkloadSchema.parse(JSON.parse(readFileSync(join("tools", "load", "workloads.json"), "utf8")))
      .steps.map(({ rooms }) => rooms)).toEqual([1, 3, 5]);
    for (const change of [
      { target: "https://user:password@example.test" },
      { steps: [{ rooms: 6, seconds: 1 }] },
      { steps: [{ rooms: 3, seconds: 1 }, { rooms: 1, seconds: 1 }] },
      { playersPerRoom: 33 },
      { spectatorsPerRoom: 65 },
      { playersPerRoom: 5 },
      { soakSeconds: 1801 }
    ]) expect(WorkloadSchema.safeParse({ ...config, ...change }).success).toBe(false);
  });

  it("replays seeded movement, pursues/fires at enemies, seeks pickups and neutralizes death", () => {
    const randomA = seededRandom(42), randomB = seededRandom(42);
    expect(Array.from({ length: 10 }, randomA)).toEqual(Array.from({ length: 10 }, randomB));
    const view = LoadViewSchema.parse({
      phase: "active", map: { width: 2048, height: 2048, obstacles: [] },
      players: [{ accountId: "player", position: { x: 100, y: 100 }, health: 100, alive: true }],
      entities: [
        { id: "enemy", position: { x: 200, y: 100 }, state: { kind: "npc" } },
        { id: "pickup", position: { x: 100, y: 200 }, state: { kind: "pickup" } }
      ]
    });
    expect(combatIntent(view, "player", seededRandom(42)))
      .toMatchObject({ moveX: 1, moveY: 0, aimX: 200, aimY: 100, fire: true });
    const player = view.players[0];
    if (!player) throw new Error("Missing player fixture.");
    player.health = 20;
    expect(combatIntent(view, "player", seededRandom(42))).toMatchObject({ moveX: 0, moveY: 1 });
    player.alive = false;
    expect(combatIntent(view, "player", seededRandom(42))).toMatchObject({
      moveX: 0, moveY: 0, fire: false
    });
    player.alive = true;
    view.map.obstacles.push({ x: 115, y: 80, width: 40, height: 40 });
    player.health = 100;
    expect(combatIntent(view, "player", seededRandom(42)).moveX).not.toBe(1);
  });
});
