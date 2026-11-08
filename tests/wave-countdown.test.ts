import { describe, expect, it } from "vitest";
import { SessionWorld, SeededRandom } from "@multiplayer-game/engine";
import { Countdown, type ModuleContext } from "@multiplayer-game/theme-sdk";
import {
  calculateWaveDurationSeconds, defaultModuleFactory, generateMap, type DefaultEntity
} from "@multiplayer-game/default-theme";
import { createSpectatorView } from "../apps/server/src/transport/spectator-view.js";

describe("wave countdown", () => {
  it.each([
    [0, 60], [1, 63], [10, 90], [79, 297], [80, 300], [81, 300], [2000, 300]
  ])("gives %i starting NPCs a %i-second budget", (npcs, seconds) => {
    expect(calculateWaveDurationSeconds(npcs)).toBe(seconds);
  });

  it("rejects invalid counts, durations and clocks", () => {
    for (const count of [-1, 0.5, Infinity, NaN]) {
      expect(() => calculateWaveDurationSeconds(count)).toThrow(RangeError);
    }
    for (const seconds of [0, -1, Infinity, NaN]) {
      expect(() => new Countdown({ nowMs: () => 0 }, seconds)).toThrow(RangeError);
    }
    expect(() => new Countdown({ nowMs: () => NaN }, 60)).toThrow(RangeError);
  });

  it("uses a monotonic deadline without applying gameplay or scheduling policy", () => {
    let now = 1000;
    const countdown = new Countdown({ nowMs: () => now }, 60);
    expect(countdown.deadlineMs).toBe(61_000);
    now = 60_999;
    expect(countdown.remainingSeconds).toBeCloseTo(0.001);
    expect(countdown.expired).toBe(false);
    now = 61_000;
    expect(countdown.expired).toBe(true);
    now = 70_000;
    expect(countdown.remainingSeconds).toBe(0);
  });

  it("advances once on a pre-deadline clear and resets the next wave from its starting count", () => {
    const simulation = createSimulation();
    try {
      expect(simulation.module.state).toMatchObject({ level: 1, waveRemainingSeconds: 63 });
      simulation.now = 62_999;
      simulation.removeNpcs();
      simulation.module.step(0, 1);
      simulation.module.step(0, 2);
      expect(simulation.requests).toEqual([{ kind: "level", reason: "level-1-cleared" }]);
      expect(simulation.module.state).toMatchObject({ phase: "intermission" });
      expect(simulation.module.state).not.toHaveProperty("waveRemainingSeconds");
      simulation.now = 90_000;
      simulation.module.step(0, 151);
      expect(simulation.module.state).toMatchObject({
        phase: "active", level: 2, waveRemainingSeconds: 66
      });
      expect(simulation.world.entities().filter(entity => entity.state.kind === "npc")).toHaveLength(2);
      simulation.now = 91_000;
      simulation.removeNpcs();
      simulation.module.step(0, 152);
      simulation.module.step(0, 153);
      expect(simulation.requests).toEqual([
        { kind: "level", reason: "level-1-cleared" },
        { kind: "match", reason: "maximum-level-cleared" }
      ]);
    } finally { simulation.module.dispose(); }
  });

  it("keeps ticking through death and respawn and projects the same time to spectators", () => {
    const simulation = createSimulation();
    try {
      simulation.world.addEntity({
        ...simulation.world.getEntity("player:alice")!,
        state: { kind: "player", accountId: "alice", health: 0, points: 200, kills: 2, deaths: 0 }
      });
      simulation.now = 10_000;
      simulation.module.step(0, 10);
      const snapshot = () => simulation.module.snapshot({ accountId: "alice", role: "player" });
      expect(snapshot()).toMatchObject({
        waveRemainingSeconds: 53, players: [{ alive: false, points: 200, respawnAtTick: 160 }]
      });
      expect(createSpectatorView("alice", snapshot())).toMatchObject({
        waveRemainingSeconds: 53, spectatorView: { death: { alive: false } }
      });
      simulation.now = 15_000;
      simulation.module.step(0, 160);
      expect(snapshot()).toMatchObject({
        waveRemainingSeconds: 48, players: [{ alive: true, points: 200, health: 100 }]
      });
      simulation.now = 20_000;
      simulation.module.setPlayerPresence?.("alice", "disconnected");
      simulation.module.step(0, 161);
      expect(snapshot().waveRemainingSeconds).toBe(43);
    } finally { simulation.module.dispose(); }
  });

  it("times out once at the exact deadline, even if the last NPC is cleared then", () => {
    const simulation = createSimulation();
    try {
      simulation.now = 62_999;
      simulation.module.step(0, 1);
      expect(simulation.requests).toEqual([]);
      simulation.now = 63_000;
      simulation.removeNpcs();
      simulation.module.step(0, 2);
      simulation.module.step(0, 3);
      simulation.now = 70_000;
      simulation.module.step(0, 4);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
      expect(simulation.module.state).toMatchObject({
        phase: "complete", level: 1, waveRemainingSeconds: 0
      });
      expect(simulation.module.results()).toMatchObject({ status: "finished", finalLevel: 1 });
    } finally { simulation.module.dispose(); }
  });

  it("does not respawn a dead player when their return coincides with expiry", () => {
    const simulation = createSimulation();
    try {
      const player = simulation.world.getEntity("player:alice")!;
      simulation.world.addEntity({ ...player, state: { ...player.state, health: 0 } });
      simulation.now = 58_000;
      simulation.module.step(0, 1);
      simulation.now = 63_000;
      simulation.module.step(0, 151);
      expect(simulation.world.getEntity(player.id)).toBeUndefined();
      expect(simulation.module.results()).toMatchObject({
        status: "finished", standings: [{ deaths: 1 }]
      });
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
    } finally { simulation.module.dispose(); }
  });
});

function createSimulation() {
  let now = 0;
  const map = generateMap(42).map;
  const world = new SessionWorld<DefaultEntity>("wave-test", map.definition.bounds, map.obstacles);
  const requests: Array<{ kind: "level" | "match"; reason: string }> = [];
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => now }, random: new SeededRandom(42),
    entities: {
      get: id => world.getEntity(id), add: entity => world.addEntity(entity),
      update: (id, update) => {
        const entity = world.getEntity(id);
        if (!entity) throw new Error(`Missing ${id}.`);
        world.addEntity(update(entity));
      },
      remove: id => world.removeEntity(id), values: () => world.entities(),
      queryRadius: (position, radius, cells) => world.queryEntities(position, radius, cells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {}, requestCompletion: request => requests.push(request),
    metrics: { increment: () => {}, gauge: () => {} }
  };
  const module = defaultModuleFactory.create(context, {
    initialNpcsPerPlayer: 1, npcPopulationGrowthPercent: 100, maxLevels: 2
  }, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 42);
  module.initialize();
  return {
    module, world, requests,
    get now() { return now; }, set now(value: number) { now = value; },
    removeNpcs() {
      for (const entity of world.entities()) {
        if (entity.state.kind === "npc") world.removeEntity(entity.id);
      }
    }
  };
}
