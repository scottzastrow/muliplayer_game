import { describe, expect, it } from "vitest";
import { BoundedNavigation, SeededRandom, SessionWorld, type Rect } from "@multiplayer-game/engine";
import type { ModuleContext, NavigationPathResult, Point2 } from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  generateMap,
  PROJECTILE_RADIUS,
  type DefaultEntity
} from "@multiplayer-game/default-theme";

describe("integrated default gameplay", () => {
  it("keeps five simultaneous worlds, inputs, scores, death clocks and completion isolated", () => {
    const sessions = Array.from({ length: 5 }, (_, index) =>
      simulation(`room-${index}`, [], index === 2 ? { npcMovementSpeed: 0 } : {})
    );
    try {
      const before = sessions.map(({ module }) => module.snapshot({ accountId: "alice", role: "player" }));
      sessions[0]!.module.applyInput("alice", {
        type: "combat", moveX: 1, moveY: 0, aimX: 0, aimY: 0, fire: false
      });
      sessions[1]!.update("player:alice", (entity) => {
        if (entity.state.kind !== "player") throw new Error("Expected player.");
        return { ...entity, state: { ...entity.state, health: 0, points: 700 } };
      });
      sessions[2]!.killWave(1);
      for (const session of sessions) session.step(1);
      expect(sessions[0]!.world.getEntity("player:alice")?.position.x).toBe(278);
      expect(sessions[1]!.world.getEntity("player:alice")).toBeUndefined();
      expect(sessions[1]!.module.results().standings).toEqual(
        expect.arrayContaining([expect.objectContaining({ accountId: "alice", points: 700, deaths: 1 })])
      );
      expect(sessions[2]!.module.state).toMatchObject({ phase: "intermission", level: 1 });
      for (const index of [3, 4]) {
        const after = sessions[index]!.module.snapshot({ accountId: "alice", role: "player" });
        expect(after.players).toEqual(before[index]!.players);
        expect(after.acceptedInputs).toBe(0);
        expect(after.phase).toBe("active");
        expect(sessions[index]!.requests.length).toBeLessThanOrEqual(8);
      }
      expect(sessions[0]!.world.getEntity("player:alice")?.state).toMatchObject({ points: 0, deaths: 0 });
      sessions[1]!.step(150, 0);
      expect(sessions[1]!.world.getEntity("player:alice")).toBeUndefined();
      sessions[1]!.step(151, 0);
      expect(sessions[1]!.world.getEntity("player:alice")?.state).toMatchObject({ points: 700, deaths: 1 });
      const otherState = sessions[4]!.module.snapshot({ accountId: "alice", role: "player" });
      sessions[3]!.module.dispose();
      expect(sessions[4]!.module.snapshot({ accountId: "alice", role: "player" })).toEqual(otherState);
    } finally {
      for (const session of sessions) session.module.dispose();
    }
  });

  it("repeats bounded obstacle navigation deterministically and attracts only local NPCs", () => {
    const wall: Rect = { x: 600, y: 800, width: 32, height: 400 };
    const distantStart = { x: 112, y: 16 };
    const a = simulation("nav-a", [wall]);
    const b = simulation("nav-b", [wall]);
    try {
      for (const session of [a, b]) {
        session.update("player:alice", (entity) => ({ ...entity, position: { x: 700, y: 1000 } }));
        session.update("player:bob", (entity) => ({ ...entity, position: { x: 1776, y: 1776 } }));
        session.update("npc:npc-northwest", (entity) => ({ ...entity, position: { x: 590, y: 1000 } }));
        session.update("npc:npc-southwest", (entity) => ({ ...entity, position: distantStart }));
      }
      const positions: Point2[] = [];
      for (let tick = 1; tick <= 240; tick++) {
        for (const session of [a, b]) {
          session.step(tick);
          expect(session.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2048);
          expect(session.navigation.stats.startedSearches).toBeLessThanOrEqual(8);
        }
        const npc = a.world.getEntity("npc:npc-northwest")!;
        expect(npc.position).toEqual(b.world.getEntity(npc.id)?.position);
        expect(a.world.geometry.isCircleWalkable(npc.position, npc.radius)).toBe(true);
        positions.push(npc.position);
      }
      expect(positions.some((position) =>
        position.x > wall.x + wall.width && Math.abs(position.y - 1000) > wall.height / 2
      )).toBe(true);
      const distant = a.world.getEntity("npc:npc-southwest")!.position;
      expect(distant).not.toEqual(distantStart);
      expect(distant).toEqual(b.world.getEntity("npc:npc-southwest")!.position);
      expect(Math.hypot(distant.x - distantStart.x, distant.y - distantStart.y)).toBeLessThan(135);
    } finally {
      a.module.dispose();
      b.module.dispose();
    }
  });

  it("single-claims pickups and grows frozen-roster waves; simultaneous last hits complete once", () => {
    const session = simulation("growth", [], {
      npcPopulationGrowthPercent: 100, npcHealthGrowthPercent: 100, baseNpcHealth: 25,
      npcMovementSpeed: 0
    });
    try {
      for (const id of ["player:alice", "player:bob"]) {
        session.update(id, (entity) => {
          if (entity.state.kind !== "player") throw new Error("Expected player.");
          return { ...entity, position: { x: 272, y: 272 }, state: { ...entity.state, health: 50 } };
        });
      }
      session.update("pickup:pickup-health", (entity) => ({ ...entity, position: { x: 272, y: 272 } }));
      session.step(1, 0);
      expect(session.world.getEntity("pickup:pickup-health")).toBeUndefined();
      const health = ["alice", "bob"].map((id) => session.world.getEntity(`player:${id}`)!.state.health);
      expect(health).toEqual([75, 50]);
      session.step(2, 0);
      expect(["alice", "bob"].map((id) => session.world.getEntity(`player:${id}`)!.state.health)).toEqual(health);
      session.killWave(10);
      session.step(10, 0);
      expect(session.requests).toEqual([{ kind: "level", reason: "level-1-cleared" }]);
      session.step(159, 0);
      expect(session.module.state?.phase).toBe("intermission");
      session.step(160, 0);
      const npcs = session.world.entities().filter((entity) => entity.state.kind === "npc");
      expect(npcs).toHaveLength(4);
      expect(npcs.every((entity) => entity.state.health === 50)).toBe(true);
      session.killWave(161);
      session.step(161, 0);
      session.step(162, 0);
      expect(session.requests.filter((request) => request.kind === "match")).toHaveLength(1);
      expect(session.module.results()).toMatchObject({ status: "finished", finalLevel: 2 });
      expect(session.module.results().standings).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: "alice", points: 300, kills: 3 }),
        expect.objectContaining({ accountId: "bob", points: 300, kills: 3 })
      ]));
    } finally {
      session.module.dispose();
    }
  });

  it("retains scores through a five-second death, bounded blocked retry and immediate post-return damage", () => {
    const session = simulation("death");
    try {
      session.update("player:alice", (entity) => {
        if (entity.state.kind !== "player") throw new Error("Expected player.");
        return { ...entity, state: { ...entity.state, health: 0, points: 400, kills: 4 } };
      });
      session.step(20, 0);
      session.step(169, 0);
      expect(session.world.getEntity("player:alice")).toBeUndefined();
      session.blocked = true;
      session.walkabilityChecks = 0;
      session.step(170, 0);
      expect(session.walkabilityChecks).toBeLessThanOrEqual(64);
      expect(session.module.snapshot({ accountId: "alice", role: "player" })).toMatchObject({
        players: [expect.objectContaining({ alive: false, points: 400, respawnAtTick: 170, respawnBlocked: true }), expect.any(Object)]
      });
      expect(session.metrics.get("default.respawn.blocked")).toBe(1);
      session.blocked = false;
      session.step(171, 0);
      const player = session.world.getEntity("player:alice")!;
      expect(session.world.geometry.isCircleWalkable(player.position, player.radius + 64)).toBe(true);
      for (const entity of session.world.entities()) {
        if (entity.state.kind === "npc" || entity.state.kind === "projectile") {
          expect(Math.hypot(entity.position.x - player.position.x, entity.position.y - player.position.y))
            .toBeGreaterThan(player.radius + entity.radius + 64);
        }
      }
      expect(player.state).toMatchObject({ health: 100, points: 400, kills: 4, deaths: 1 });
      expect(player.state).not.toHaveProperty("immune");
      session.update("npc:npc-northwest", (entity) => ({ ...entity, position: player.position }));
      session.step(172, 0);
      expect(session.world.getEntity(player.id)?.state.health).toBe(90);
    } finally {
      session.module.dispose();
    }
  });
});

function simulation(
  id: string,
  obstacles: readonly Rect[] = [],
  settings: Record<string, number> = {}
) {
  const map = generateMap(42).map;
  const world = new SessionWorld<DefaultEntity>(id, map.definition.bounds, [...map.obstacles, ...obstacles]);
  const navigation = new BoundedNavigation(world.geometry, { cellSize: 32, agentRadius: 8 });
  const paths = new Map<string, NavigationPathResult>();
  const requests: Array<{ kind: "level" | "match"; reason: string }> = [];
  const metrics = new Map<string, number>();
  const state = { blocked: false, walkabilityChecks: 0 };
  const update = (entityId: string, change: (entity: Readonly<DefaultEntity>) => DefaultEntity): void => {
    const entity = world.getEntity(entityId);
    if (!entity) throw new Error(`Missing ${entityId}.`);
    world.addEntity(change(entity));
  };
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 }, random: new SeededRandom(42),
    entities: {
      get: (entityId) => world.getEntity(entityId), add: (entity) => world.addEntity(entity),
      update, remove: (entityId) => world.removeEntity(entityId), values: () => world.entities(),
      queryRadius: (position, radius, cells) => world.queryEntities(position, radius, cells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => {
        if (radius === 78) state.walkabilityChecks++;
        return !state.blocked && world.geometry.isCircleWalkable({ x, y }, radius);
      },
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: {
      requestPath: (from, to) => {
        let pathId: string | undefined;
        const requestId = navigation.requestPath(from, to, (result) => {
          if (!pathId) throw new Error("Navigation completed before request registration.");
          paths.set(pathId, result);
        });
        pathId = requestId === undefined ? undefined : String(requestId);
        return pathId;
      },
      getPath: (pathId) => { const result = paths.get(pathId); paths.delete(pathId); return result; }
    },
    emit: () => {}, requestCompletion: (request) => requests.push(request),
    metrics: { increment: (name, amount = 1) => metrics.set(name, (metrics.get(name) ?? 0) + amount), gauge: () => {} }
  };
  const module = defaultModuleFactory.create(context, {
    initialNpcsPerPlayer: 1, maxLevels: 2, ...settings
  }, [
    { accountId: "alice", username: "Alice", joinedOrder: 0 },
    { accountId: "bob", username: "Bob", joinedOrder: 1 }
  ], 42);
  module.initialize();
  return {
    module, world, navigation, requests, metrics, update,
    get blocked() { return state.blocked; }, set blocked(value: boolean) { state.blocked = value; },
    get walkabilityChecks() { return state.walkabilityChecks; },
    set walkabilityChecks(value: number) { state.walkabilityChecks = value; },
    step(tick: number, dt = 1 / 30) { navigation.processTick(); module.step(dt, tick); },
    killWave(tick: number) {
      world.entities().filter((entity) => entity.state.kind === "npc").forEach((entity, index) => {
        const position = { x: 400 + index * 64, y: 272 };
        expect(world.geometry.isCircleWalkable(position, PROJECTILE_RADIUS)).toBe(true);
        for (let x = 272; x <= position.x; x += 1) {
          expect(world.geometry.isCircleWalkable({ x, y: 272 }, PROJECTILE_RADIUS)).toBe(true);
        }
        update(entity.id, (npc) => {
          if (npc.state.kind !== "npc") throw new Error("Expected NPC.");
          return { ...npc, position, state: { ...npc.state, health: 25 } };
        });
        world.addEntity({
          id: `projectile:fixture-${tick}-${index}`, typeId: "projectile.player",
          position, radius: 3,
          state: { kind: "projectile", ownerAccountId: index % 2 ? "bob" : "alice",
            damage: 25, velocity: { x: 600, y: 0 }, expiresAtTick: tick + 60 }
        });
      });
    }
  };
}
