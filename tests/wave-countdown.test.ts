import { describe, expect, it } from "vitest";
import { SessionWorld, SeededRandom } from "@multiplayer-game/engine";
import { Countdown, type ModuleContext } from "@multiplayer-game/theme-sdk";
import {
  calculateWaveDurationSeconds, defaultModuleFactory, generateMap, type DefaultEntity
} from "@multiplayer-game/default-theme";
import { createSpectatorView } from "../apps/server/src/transport/spectator-view.js";
import { DEFAULT_GAME_SETTINGS, GameSettingsSchema } from "@multiplayer-game/protocol";

describe("wave countdown", () => {
  it.each([
    [0, 120], [1, 126], [10, 180], [20, 240], [39, 354], [40, 360], [41, 360], [2000, 360]
  ])("gives %i starting NPCs a %i-second budget", (npcs, seconds) => {
    expect(calculateWaveDurationSeconds(npcs)).toBe(seconds);
  });

  it("hides the no-kill countdown from player and spectator snapshots", () => {
    const simulation = createSimulation(40);
    try {
      const playerSnapshot = simulation.module.snapshot({ accountId: "alice", role: "player" });
      expect(playerSnapshot).not.toHaveProperty("waveRemainingSeconds");
      expect(createSpectatorView("alice", playerSnapshot)).not.toHaveProperty("waveRemainingSeconds");
    } finally { simulation.module.dispose(); }
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

  it("defaults omitted no-kill settings and rejects invalid configured durations", () => {
    const { noKillTimeoutSeconds: _omitted, ...legacy } = DEFAULT_GAME_SETTINGS;
    expect(GameSettingsSchema.parse(legacy).noKillTimeoutSeconds).toBe(360);
    expect(DEFAULT_GAME_SETTINGS.noKillTimeoutSeconds).toBe(360);
    for (const seconds of [0, -1, Infinity, NaN, 3601, null, "60"]) {
      expect(GameSettingsSchema.safeParse({
        ...legacy, noKillTimeoutSeconds: seconds
      }).success).toBe(false);
    }
    expect(GameSettingsSchema.parse({ ...legacy, noKillTimeoutSeconds: 12.5 })
      .noKillTimeoutSeconds).toBe(12.5);
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

  it("advances once on a clear and starts a fresh no-kill timer on the next wave", () => {
    const simulation = createSimulation(1, 60);
    try {
      expect(simulation.module.state).toMatchObject({ level: 1, phase: "active" });
      simulation.now = 59_999;
      simulation.removeNpcs();
      simulation.module.step(0, 1);
      simulation.module.step(0, 2);
      expect(simulation.requests).toEqual([{ kind: "level", reason: "level-1-cleared" }]);
      expect(simulation.module.state).toMatchObject({ phase: "intermission" });
      expect(simulation.module.state).not.toHaveProperty("waveRemainingSeconds");
      simulation.now = 150_000;
      simulation.module.step(0, 151);
      expect(simulation.module.state).toMatchObject({
        phase: "active", level: 2
      });
      expect(simulation.world.entities().filter(entity => entity.state.kind === "npc")).toHaveLength(2);
      simulation.now = 209_999;
      simulation.module.step(0, 152);
      expect(simulation.module.state.phase).toBe("active");
      simulation.now = 210_000;
      simulation.module.step(0, 153);
      expect(simulation.requests).toEqual([
        { kind: "level", reason: "level-1-cleared" },
        { kind: "match", reason: "wave-timeout" }
      ]);
    } finally { simulation.module.dispose(); }
  });

  it("still completes normally when the final wave is cleared", () => {
    const simulation = createSimulation();
    try {
      simulation.removeNpcs();
      simulation.module.step(0, 1);
      simulation.module.step(0, 151);
      simulation.removeNpcs();
      simulation.module.step(0, 152);
      simulation.module.step(0, 153);
      expect(simulation.requests).toEqual([
        { kind: "level", reason: "level-1-cleared" },
        { kind: "match", reason: "maximum-level-cleared" }
      ]);
    } finally { simulation.module.dispose(); }
  });

  it("keeps the timer hidden and running through death, respawn and disconnect", () => {
    const simulation = createSimulation(1, 60);
    try {
      simulation.world.addEntity({
        ...simulation.world.getEntity("player:alice")!,
        state: { kind: "player", accountId: "alice", health: 0, points: 200, kills: 2, deaths: 0 }
      });
      simulation.now = 10_000;
      simulation.module.step(0, 10);
      const snapshot = () => simulation.module.snapshot({ accountId: "alice", role: "player" });
      expect(snapshot()).toMatchObject({
        players: [{ alive: false, points: 200, respawnAtTick: 160 }]
      });
      expect(createSpectatorView("alice", snapshot())).toMatchObject({
        spectatorView: { death: { alive: false } }
      });
      simulation.now = 15_000;
      simulation.module.step(0, 160);
      expect(snapshot()).toMatchObject({
        players: [{ alive: true, points: 200, health: 200 }]
      });
      simulation.now = 20_000;
      simulation.module.setPlayerPresence?.("alice", "disconnected");
      simulation.module.step(0, 161);
      expect(snapshot()).not.toHaveProperty("waveRemainingSeconds");
      simulation.now = 60_000;
      simulation.module.step(0, 162);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
    } finally { simulation.module.dispose(); }
  });

  it("times out once at the exact deadline, even if the last NPC is cleared then", () => {
    const simulation = createSimulation(1, 60);
    try {
      simulation.now = 59_999;
      simulation.module.step(0, 1);
      expect(simulation.requests).toEqual([]);
      simulation.now = 60_000;
      simulation.removeNpcs();
      simulation.module.step(0, 2);
      simulation.module.step(0, 3);
      simulation.now = 133_000;
      simulation.module.step(0, 4);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
      expect(simulation.module.state).toMatchObject({
        phase: "complete", level: 1
      });
      expect(simulation.module.results()).toMatchObject({ status: "finished", finalLevel: 1 });
    } finally { simulation.module.dispose(); }
  });

  it("does not respawn a dead player when their return coincides with expiry", () => {
    const simulation = createSimulation(1, 60);
    try {
      const player = simulation.world.getEntity("player:alice")!;
      simulation.world.addEntity({ ...player, state: { ...player.state, health: 0 } });
      simulation.now = 55_000;
      simulation.module.step(0, 1);
      simulation.now = 60_000;
      simulation.module.step(0, 151);
      expect(simulation.world.getEntity(player.id)).toBeUndefined();
      expect(simulation.module.results()).toMatchObject({
        status: "finished", standings: [{ deaths: 1 }]
      });
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
    } finally { simulation.module.dispose(); }
  });

  it("resets on another player's confirmed kills and plays beyond the old fixed deadline", () => {
    const simulation = createSimulation(4, 60, true);
    try {
      for (const [index, time] of [59_000, 118_000, 177_000, 236_000].entries()) {
        simulation.now = time;
        simulation.hit("bob", index + 1, 1);
        expect(simulation.module.state.phase).toBe("active");
        expect(simulation.requests).toEqual([]);
      }
      // Eight starting NPCs previously imposed a fixed 168-second deadline.
      expect(simulation.module.results()).toMatchObject({
        standings: [
          expect.objectContaining({ accountId: "bob", kills: 4, points: 400 }),
          expect.objectContaining({ accountId: "alice", kills: 0, points: 0 })
        ]
      });
      simulation.now = 295_999;
      simulation.module.step(0, 100);
      expect(simulation.requests).toEqual([]);
      simulation.now = 296_000;
      simulation.module.step(0, 101);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
    } finally { simulation.module.dispose(); }
  });

  it("does not reset for movement, misses or damage without a kill", () => {
    const simulation = createSimulation(2, 60);
    try {
      simulation.now = 59_000;
      simulation.module.applyInput("alice", {
        type: "combat", moveX: 1, moveY: 0, aimX: 0, aimY: 0, fire: true
      });
      const position = simulation.world.getEntity("player:alice")!.position;
      simulation.module.step(1 / 30, 1);
      expect(simulation.world.getEntity("player:alice")!.position).not.toEqual(position);
      expect(simulation.world.entities().some(entity => entity.state.kind === "projectile")).toBe(true);
      simulation.hit("alice", 2, 1000);
      expect(simulation.world.entities().find(entity =>
        entity.id === "target:2")?.state.health).toBe(999);
      simulation.now = 60_000;
      simulation.module.step(1 / 30, 3);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
    } finally { simulation.module.dispose(); }
  });

  it("uses the configured duration for an idle player", () => {
    const simulation = createSimulation(1, 12.5);
    try {
      simulation.now = 12_499;
      simulation.module.step(0, 1);
      expect(simulation.requests).toEqual([]);
      simulation.now = 12_500;
      simulation.module.step(0, 2);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
    } finally { simulation.module.dispose(); }
  });

  it("keeps a default match active past three minutes and times out at six minutes", () => {
    const simulation = createSimulation();
    try {
      expect(DEFAULT_GAME_SETTINGS.noKillTimeoutSeconds).toBe(360);
      simulation.now = 180_001;
      simulation.module.step(0, 1);
      expect(simulation.requests).toEqual([]);
      expect(simulation.module.state.phase).toBe("active");

      simulation.now = 359_999;
      simulation.module.step(0, 2);
      expect(simulation.requests).toEqual([]);
      simulation.now = 360_000;
      simulation.module.step(0, 3);
      expect(simulation.requests).toEqual([{ kind: "match", reason: "wave-timeout" }]);
      expect(simulation.module.results()).toMatchObject({
        status: "finished", finalLevel: 1, standings: [{ kills: 0 }]
      });
    } finally { simulation.module.dispose(); }
  });
});

function createSimulation(
  initialNpcsPerPlayer = 1,
  noKillTimeoutSeconds = DEFAULT_GAME_SETTINGS.noKillTimeoutSeconds,
  multiplayer = false
) {
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
    initialNpcsPerPlayer, npcPopulationGrowthPercent: 100, maxLevels: 2,
    noKillTimeoutSeconds, npcMovementSpeed: 0, npcDetectionRange: 0
  }, [
    { accountId: "alice", username: "Alice", joinedOrder: 0 },
    ...(multiplayer ? [{ accountId: "bob", username: "Bob", joinedOrder: 1 }] : [])
  ], 42);
  module.initialize();
  return {
    module, world, requests,
    get now() { return now; }, set now(value: number) { now = value; },
    hit(ownerAccountId: string, tick: number, health: number) {
      const npc = world.entities().find(entity => entity.state.kind === "npc")!;
      world.removeEntity(npc.id);
      world.addEntity({ ...npc, id: `target:${tick}`, position: { x: 112, y: 16 },
        state: { ...npc.state, health } });
      world.addEntity({
        id: `test-shot:${tick}`, typeId: "projectile.player", radius: 3,
        position: { x: 112, y: 16 },
        state: { kind: "projectile", ownerAccountId, damage: 1,
          velocity: { x: 0, y: 1 }, expiresAtTick: tick + 10 }
      });
      module.step(0, tick);
    },
    removeNpcs() {
      for (const entity of world.entities()) {
        if (entity.state.kind === "npc") world.removeEntity(entity.id);
      }
    }
  };
}
