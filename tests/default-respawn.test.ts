import { describe, expect, it } from "vitest";
import { SessionWorld, type Rect } from "@multiplayer-game/engine";
import type { ModuleContext } from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  generateMap,
  type DefaultEntity
} from "@multiplayer-game/default-theme";
import { createSpectatorView } from "../apps/server/src/transport/spectator-view.js";

describe("default player respawn", () => {
  it.each([undefined, 275])("refills living players once per next-wave boundary with maximum %s", maximum => {
    const expected = maximum ?? 200;
    const { module, world } = createSimulation({
      maxLevels: 3, initialNpcsPerPlayer: 1, npcMovementSpeed: 0, npcDetectionRange: 0,
      ...(maximum === undefined ? {} : { playerMaxHealth: maximum })
    });
    const wound = () => {
      const player = world.getEntity("player:alice")!;
      world.addEntity({ ...player, state: { ...player.state, health: 70, points: 400, kills: 4 } });
    };
    const clearWave = () => {
      for (const entity of world.entities()) {
        if (entity.state.kind === "npc") world.removeEntity(entity.id);
      }
    };
    try {
      wound();
      const before = world.getEntity("player:alice")!;
      for (const [clearTick, startTick] of [[1, 151], [153, 303]] as const) {
        clearWave();
        module.step(0, clearTick);
        module.step(0, startTick - 1);
        expect(world.getEntity(before.id)!.state.health).toBe(70);
        module.step(0, startTick);
        expect(world.getEntity(before.id)).toEqual({
          ...before, state: { ...before.state, health: expected }
        });
        for (const role of ["player", "spectator"] as const) {
          expect(module.snapshot({ accountId: "alice", role })).toMatchObject({
            phase: "active", playerMaxHealth: expected,
            players: [{ health: expected, points: 400, kills: 4, deaths: 0, alive: true }]
          });
        }
        wound();
        module.step(0, startTick + 1);
        expect(world.getEntity(before.id)!.state.health).toBe(70);
      }
      clearWave();
      module.step(0, 305);
      expect(module.state.phase).toBe("complete");
      expect(world.getEntity(before.id)!.state.health).toBe(70);
    } finally { module.dispose(); }
  });

  it.each([undefined, 275])("does not advance an intermission death deadline with maximum %s", maximum => {
    const { module, world } = createSimulation({
      maxLevels: 2, initialNpcsPerPlayer: 1, npcMovementSpeed: 0, npcDetectionRange: 0,
      ...(maximum === undefined ? {} : { playerMaxHealth: maximum })
    });
    try {
      for (const entity of world.entities()) {
        if (entity.state.kind === "npc") world.removeEntity(entity.id);
      }
      module.step(0, 1);
      defeat(world, 300, 3);
      module.step(0, 100);
      module.step(0, 151);
      expect(world.getEntity("player:alice")).toBeUndefined();
      expect(module.state).toMatchObject({
        phase: "active", level: 2,
        players: [{ health: 0, alive: false, respawnAtTick: 250, points: 300, deaths: 1 }]
      });
      module.step(0, 249);
      expect(world.getEntity("player:alice")).toBeUndefined();
      module.step(0, 250);
      expect(world.getEntity("player:alice")!.state).toMatchObject({
        health: maximum ?? 200, points: 300, kills: 3, deaths: 1
      });
    } finally { module.dispose(); }
  });

  it.each([undefined, 37, 100, 150, 275])("uses maximum %s for spawn, HUD snapshots and death respawn", maximum => {
    const expected = maximum ?? 200;
    const { module, world } = createSimulation(maximum === undefined ? {} : { playerMaxHealth: maximum });
    try {
      expect(world.getEntity("player:alice")!.state.health).toBe(expected);
      expect(world.entities().filter(entity => entity.state.kind === "npc")).toHaveLength(5);
      for (const role of ["player", "spectator"] as const) {
        expect(module.snapshot({ accountId: "alice", role })).toMatchObject({
          playerMaxHealth: expected, players: [{ health: expected }]
        });
      }
      defeat(world, 300, 3);
      module.step(0, 1);
      module.step(0, 151);
      expect(world.getEntity("player:alice")!.state).toMatchObject({
        health: expected, points: 300, deaths: 1
      });
      for (const role of ["player", "spectator"] as const) {
        expect(module.snapshot({ accountId: "alice", role })).toMatchObject({
          playerMaxHealth: expected, players: [{ health: expected }]
        });
      }
      const player = world.getEntity("player:alice")!;
      world.addEntity({ ...player, state: { ...player.state, health: 12 } });
      module.setPlayerPresence?.("alice", "disconnected");
      module.setPlayerPresence?.("alice", "connected");
      expect(world.getEntity("player:alice")!.state.health).toBe(12);
      expect(createSpectatorView("alice", module.snapshot({ accountId: "alice", role: "player" })))
        .toMatchObject({ playerMaxHealth: expected, spectatorView: { hud: { health: 12 } } });
    } finally { module.dispose(); }
  });

  it("resumes score and pending death without changing the frozen NPC budget or duplicating an avatar", () => {
    const { module, world } = createSimulation();
    try {
      const npcCount = () => world.entities().filter(entity => entity.state.kind === "npc").length;
      const initialNpcs = npcCount();
      const color = world.getEntity("player:alice")!.state.color;
      defeat(world, 500, 5);
      module.step(0, 10);
      module.setPlayerPresence?.("alice", "disconnected");
      module.step(0, 100);
      expect(world.getEntity("player:alice")).toBeUndefined();
      module.setPlayerPresence?.("alice", "connected");
      module.setPlayerPresence?.("alice", "connected");
      expect(module.snapshot({ accountId: "alice", role: "player" })).toMatchObject({
        players: [{ points: 500, deaths: 1, alive: false, respawnAtTick: 160 }]
      });
      module.step(0, 159);
      expect(world.getEntity("player:alice")).toBeUndefined();
      module.step(0, 160);
      expect(world.entities().filter(entity => entity.state.kind === "player")).toHaveLength(1);
      expect(world.getEntity("player:alice")?.state).toMatchObject({ points: 500, kills: 5, deaths: 1, color });
      expect(npcCount()).toBe(initialNpcs);
      module.setPlayerPresence?.("alice", "disconnected");
      module.step(0, 200);
      expect(world.getEntity("player:alice")).toBeUndefined();
      module.setPlayerPresence?.("alice", "connected");
      expect(world.entities().filter(entity => entity.state.kind === "player")).toHaveLength(1);
      expect(world.getEntity("player:alice")?.state).toMatchObject({ points: 500, deaths: 1, color });
    } finally { module.dispose(); }
  });

  it("continues a death deadline while disconnected but only places the player on authorized return", () => {
    const { module, world } = createSimulation();
    try {
      defeat(world, 300, 3);
      module.step(0, 1);
      module.setPlayerPresence?.("alice", "disconnected");
      module.step(0, 200);
      expect(world.getEntity("player:alice")).toBeUndefined();
      module.setPlayerPresence?.("alice", "connected");
      expect(world.getEntity("player:alice")?.state).toMatchObject({ points: 300, health: 200, deaths: 1 });
      module.setPlayerPresence?.("alice", "expired");
      module.step(0, 300);
      expect(world.getEntity("player:alice")).toBeUndefined();
      expect(() => module.setPlayerPresence?.("alice", "connected")).toThrow();
    } finally { module.dispose(); }
  });

  it("bounds a blocked live return and retries safely without resetting health or score", () => {
    const { module, world, setBlocked, walkabilityChecks } = createSimulation();
    try {
      const player = world.getEntity("player:alice")!;
      world.addEntity({ ...player, state: { ...player.state, health: 40, points: 200 } });
      module.setPlayerPresence?.("alice", "disconnected");
      setBlocked(true);
      const before = walkabilityChecks();
      module.setPlayerPresence?.("alice", "connected");
      expect(walkabilityChecks() - before).toBeLessThanOrEqual(65);
      expect(world.getEntity("player:alice")).toBeUndefined();
      expect(module.snapshot({ accountId: "alice", role: "player" })).toMatchObject({
        players: [{ points: 200, health: 40, connected: true, alive: false, respawnBlocked: true }]
      });
      setBlocked(false);
      module.step(0, 10);
      const returned = world.getEntity("player:alice")!;
      expect(returned.state).toMatchObject({ points: 200, health: 40 });
      expect(world.geometry.intersectsObstacle(returned.position, returned.radius + 64)).toBe(false);
    } finally { module.dispose(); }
  });

  it("projects a spectator's real module death deadline, retained HUD and safe return anchor", () => {
    const { module, world } = createSimulation();
    try {
      const originalPosition = world.getEntity("player:alice")!.position;
      defeat(world, 275, 3);
      module.step(0, 10);
      const view = () => createSpectatorView("alice", module.snapshot({ accountId: "alice", role: "player" }));
      expect(view()).toMatchObject({
        viewerAccountId: "alice", viewerRole: "spectator",
        spectatorView: { cameraAnchor: originalPosition, hud: { points: 275, health: 0 },
          death: { alive: false, respawnAtTick: 160, remainingSeconds: 5 } }
      });
      module.step(0, 159);
      expect(view()).toMatchObject({
        spectatorView: { cameraAnchor: originalPosition, death: { remainingSeconds: 1 / 30 } }
      });
      module.step(0, 160);
      const returned = world.getEntity("player:alice")!;
      expect(returned.position).not.toEqual(originalPosition);
      expect(view()).toMatchObject({
        spectatorView: { cameraAnchor: returned.position, hud: { points: 275, health: 200 },
          death: { alive: true, remainingSeconds: 0 } }
      });
    } finally {
      module.dispose();
    }
  });

  it("removes a defeated avatar and retains standings until the five-second deadline", () => {
    const { module, world } = createSimulation();
    defeat(world, 275, 3);
    module.step(0, 10);
    expect(world.getEntity("player:alice")).toBeUndefined();
    expect(module.snapshot({ accountId: "alice", role: "player" })).toMatchObject({
      players: [
        { accountId: "alice", alive: false, points: 275, kills: 3, deaths: 1, respawnAtTick: 160 }
      ]
    });
    module.applyInput("alice", {
      type: "combat", moveX: 1, moveY: 0, aimX: 500, aimY: 500, fire: true
    });
    module.step(1 / 30, 159);
    expect(world.getEntity("player:alice")).toBeUndefined();
    expect(world.entities().some((entity) => entity.state.kind === "projectile")).toBe(false);
    module.step(0, 160);
    expect(world.getEntity("player:alice")?.state).toMatchObject({
      health: 200, points: 275, kills: 3, deaths: 1
    });
    expect(module.results().standings).toMatchObject([
      { accountId: "alice", points: 275, kills: 3, deaths: 1 }
    ]);
    const position = world.getEntity("player:alice")!.position;
    module.step(1 / 30, 161);
    expect(world.getEntity("player:alice")?.position).toEqual(position);
    module.dispose();
  });

  it("uses random safe cells with obstacle, enemy and projectile clearance", () => {
    const first = createSimulation({}, 0, [{ x: 64, y: 64, width: 32, height: 32 }]);
    const second = createSimulation({}, 0.75);
    const positions = [];
    for (const simulation of [first, second]) {
      simulation.world.addEntity({
        id: "npc:spawn-hazard", typeId: "npc", radius: 8, position: { x: 240, y: 80 },
        state: {
          kind: "npc", health: 100,
          attackCapability: { typeId: "default.contact-attack", damage: 10, cooldownTicks: 30 }
        }
      });
      simulation.world.addEntity({
        id: "projectile:spawn-hazard", typeId: "projectile.player", radius: 3,
        position: { x: 496, y: 240 },
        state: {
          kind: "projectile", ownerAccountId: "alice", damage: 25,
          velocity: { x: 0, y: 0 }, expiresAtTick: 1_000
        }
      });
      defeat(simulation.world);
      simulation.module.step(0, 1);
      simulation.module.step(0, 151);
      const player = simulation.world.getEntity("player:alice")!;
      expect(player).toBeDefined();
      expect(simulation.world.geometry.isCircleWalkable(player.position, player.radius + 64))
        .toBe(true);
      positions.push(player.position);
      for (const entity of simulation.world.entities()) {
        if (entity.state.kind !== "npc" && entity.state.kind !== "projectile") continue;
        expect(Math.hypot(
          player.position.x - entity.position.x,
          player.position.y - entity.position.y
        )).toBeGreaterThan(player.radius + entity.radius + 64);
      }
      simulation.module.dispose();
    }
    expect(positions[0]).not.toEqual(positions[1]);
  });

  it("bounds blocked spawn work, exposes the blocked state, and retries without resetting the deadline", () => {
    const simulation = createSimulation();
    defeat(simulation.world);
    simulation.module.step(0, 1);
    simulation.setBlocked(true);
    simulation.module.step(0, 151);
    expect(simulation.world.getEntity("player:alice")).toBeUndefined();
    expect(simulation.walkabilityChecks()).toBeLessThanOrEqual(64);
    expect(simulation.module.snapshot({ accountId: "alice", role: "player" })).toMatchObject({
      players: [{ alive: false, respawnAtTick: 151, respawnBlocked: true }]
    });
    expect(simulation.metrics.get("default.respawn.blocked")).toBe(1);
    simulation.setBlocked(false);
    simulation.module.step(0, 152);
    expect(simulation.world.getEntity("player:alice")?.state).toMatchObject({ health: 200 });
    simulation.module.dispose();
  });

  it("removes contact damage but allows ranged hits immediately on return, without immunity", () => {
    const { module, world } = createSimulation();
    defeat(world);
    module.step(0, 1);
    module.step(0, 151);
    const player = world.getEntity("player:alice")!;
    expect(player.state).not.toHaveProperty("immune");
    world.addEntity({
      id: "npc:contact", typeId: "npc", radius: 8, position: player.position,
      state: {
        kind: "npc", health: 100,
        attackCapability: { typeId: "default.contact-attack", damage: 10, cooldownTicks: 30 }
      }
    });
    module.step(0, 152);
    expect(world.getEntity("player:alice")?.state).toMatchObject({ health: 200, deaths: 1 });
    world.addEntity({
      id: "npc-shot", typeId: "projectile.npc", radius: 6 / Math.SQRT2,
      position: player.position,
      state: { kind: "projectile", ownerAccountId: "", ownerNpcId: "npc:contact",
        damage: 10, velocity: { x: 300, y: 0 }, expiresAtTick: 180 }
    });
    module.step(0, 153);
    expect(world.getEntity("player:alice")?.state).toMatchObject({ health: 190, deaths: 1 });
    module.dispose();
  });

  it("honors configured deadlines through a level transition instead of respawning early", () => {
    const { module, world } = createSimulation({ respawnDelaySeconds: 10, maxLevels: 2 });
    for (const entity of world.entities()) {
      if (entity.state.kind === "npc") world.removeEntity(entity.id);
    }
    module.step(0, 1);
    defeat(world, 400, 4);
    module.step(0, 20);
    module.step(0, 151);
    expect(module.state).toMatchObject({ level: 2, phase: "active" });
    expect(world.getEntity("player:alice")).toBeUndefined();
    module.step(0, 319);
    expect(world.getEntity("player:alice")).toBeUndefined();
    module.step(0, 320);
    expect(world.getEntity("player:alice")?.state).toMatchObject({ points: 400, health: 200 });
    module.dispose();
  });

  it("rounds fractional delays up to fixed ticks and accepts a zero delay", () => {
    for (const delay of [0, 0.05]) {
      const { module, world } = createSimulation({ respawnDelaySeconds: delay });
      defeat(world);
      module.step(0, 10);
      if (delay > 0) {
        module.step(0, 11);
        expect(world.getEntity("player:alice")).toBeUndefined();
        module.step(0, 12);
      }
      expect(world.getEntity("player:alice")?.state).toMatchObject({ health: 200, deaths: 1 });
      module.dispose();
    }
  });

  it("credits a defeated player's in-flight final hit and retains standings at completion", () => {
    const { module, world } = createSimulation({ maxLevels: 1 });
    for (const entity of world.entities()) {
      if (entity.state.kind === "npc") world.removeEntity(entity.id);
    }
    world.addEntity({
      id: "npc:final", typeId: "npc", radius: 8, position: { x: 400, y: 272 },
      state: {
        kind: "npc", health: 25,
        attackCapability: { typeId: "default.contact-attack", damage: 10, cooldownTicks: 30 }
      }
    });
    world.addEntity({
      id: "projectile:final", typeId: "projectile.player", radius: 3,
      position: { x: 380, y: 272 },
      state: {
        kind: "projectile", ownerAccountId: "alice", damage: 25,
        velocity: { x: 600, y: 0 }, expiresAtTick: 60
      }
    });
    defeat(world, 200, 2);
    module.step(0, 1);
    expect(world.getEntity("player:alice")).toBeUndefined();
    expect(module.results()).toMatchObject({
      status: "finished", standings: [{ accountId: "alice", points: 300, kills: 3, deaths: 1 }]
    });
    module.step(0, 151);
    expect(world.getEntity("player:alice")).toBeUndefined();
    module.dispose();
  });
});

function createSimulation(
  settings: Record<string, number> = {},
  random = 0.5,
  obstacles: readonly Rect[] = []
) {
  const map = generateMap(42).map;
  const world = new SessionWorld<DefaultEntity>(
    "respawn-test", map.definition.bounds, [...map.obstacles, ...obstacles]
  );
  const metrics = new Map<string, number>();
  let blocked = false;
  let checks = 0;
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: { next: () => random },
    entities: {
      get: (id) => world.getEntity(id),
      add: (entity) => world.addEntity(entity),
      update: (id, update) => {
        const entity = world.getEntity(id);
        if (!entity) throw new Error(`Missing entity ${id}.`);
        world.addEntity(update(entity));
      },
      remove: (id) => world.removeEntity(id),
      values: () => world.entities(),
      queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => {
        checks += 1;
        return !blocked && world.geometry.isCircleWalkable({ x, y }, radius);
      },
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {},
    requestCompletion: () => {},
    metrics: {
      increment: (name, amount = 1) => metrics.set(name, (metrics.get(name) ?? 0) + amount),
      gauge: () => {}
    }
  };
  const module = defaultModuleFactory.create(
    context, settings, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 42
  );
  module.initialize();
  return {
    module, world, metrics,
    setBlocked(value: boolean) { blocked = value; checks = 0; },
    walkabilityChecks: () => checks
  };
}

function defeat(world: SessionWorld<DefaultEntity>, points = 0, kills = 0): void {
  const entity = world.getEntity("player:alice");
  if (!entity || entity.state.kind !== "player") throw new Error("Player is missing.");
  world.addEntity({ ...entity, state: { ...entity.state, health: 0, points, kills } });
}
