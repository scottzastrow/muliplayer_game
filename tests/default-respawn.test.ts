import { describe, expect, it } from "vitest";
import { SessionWorld, type Rect } from "@multiplayer-game/engine";
import type { ModuleContext } from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  generateMap,
  type DefaultEntity
} from "@multiplayer-game/default-theme";

describe("default player respawn", () => {
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
      health: 100, points: 275, kills: 3, deaths: 1
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
        position: { x: 400, y: 80 },
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
    expect(simulation.world.getEntity("player:alice")?.state).toMatchObject({ health: 100 });
    simulation.module.dispose();
  });

  it("allows contact damage immediately on return, without a respawn immunity flag", () => {
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
    expect(world.getEntity("player:alice")?.state).toMatchObject({ health: 90, deaths: 1 });
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
    expect(world.getEntity("player:alice")?.state).toMatchObject({ points: 400, health: 100 });
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
      expect(world.getEntity("player:alice")?.state).toMatchObject({ health: 100, deaths: 1 });
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
