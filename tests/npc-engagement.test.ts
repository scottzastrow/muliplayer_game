import { describe, expect, it, vi } from "vitest";
import {
  BoundedNavigation, SeededRandom, SessionWorld
} from "@multiplayer-game/engine";
import {
  defaultModuleFactory, generateMap, type DefaultEntity
} from "@multiplayer-game/default-theme";
import type {
  ModuleContext, NavigationPathResult, Point2
} from "@multiplayer-game/theme-sdk";

function simulation(players = 1, npcMovementSpeed = 67.5, fixed = false) {
  const map = generateMap(42, "fixed").map;
  const world = new SessionWorld<DefaultEntity>(
    "engagement", map.definition.bounds, fixed ? map.obstacles : []
  );
  const navigation = new BoundedNavigation(world.geometry, { cellSize: 32, agentRadius: 8 });
  const results = new Map<string, NavigationPathResult>();
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: new SeededRandom(42),
    entities: {
      get: id => world.getEntity(id),
      add: entity => world.addEntity(entity),
      update: (id, update) => {
        const entity = world.getEntity(id);
        if (!entity) throw new Error(`Missing entity ${id}`);
        world.addEntity(update(entity));
      },
      remove: id => world.removeEntity(id),
      values: () => world.entities(),
      queryRadius: (point, radius, maxCells) => world.queryEntities(point, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (point, delta, radius) => world.geometry.moveCircle(point, delta, radius)
    },
    navigation: {
      requestPath: (from, to) => {
        let id: string | undefined;
        const request = navigation.requestPath(from, to, result => {
          if (id) results.set(id, result);
        });
        if (request !== undefined) id = String(request);
        return id;
      },
      getPath: id => {
        const result = results.get(id);
        results.delete(id);
        return result;
      }
    },
    emit: () => {}, requestCompletion: () => {},
    metrics: { increment: vi.fn(), gauge: vi.fn() }
  };
  const roster = Array.from({ length: players }, (_, index) => ({
    accountId: `p${index}`, username: `Player${index}`, joinedOrder: index
  }));
  const module = defaultModuleFactory.create(context, {
    mapMode: "fixed", npcMovementSpeed
  }, roster, 42);
  module.initialize();
  const npcs = () => world.entities().filter(entity => entity.state.kind === "npc");
  const place = (id: string, position: Point2) =>
    context.entities.update(id, entity => ({ ...entity, position }));
  const stage = (positions: Point2[]) => {
    for (const npc of npcs()) world.removeEntity(npc.id);
    for (const [index, position] of positions.entries()) {
      world.addEntity({
        id: `test:${index}`, typeId: "npc", radius: 8, position,
        state: { kind: "npc", health: 50, attackCapability: {
          typeId: "default.contact-attack", damage: 10, cooldownTicks: 30
        } }
      });
    }
  };
  const step = (tick: number) => {
    const before = new Map(npcs().map(npc => [npc.id, npc.position]));
    navigation.processTick();
    module.step(1 / 30, tick);
    return new Map(npcs().map(npc => {
      const previous = before.get(npc.id)!;
      return [npc.id, Math.hypot(npc.position.x - previous.x, npc.position.y - previous.y)];
    }));
  };
  const pursuers = (tick: number) => [...step(tick)].filter(([, travel]) =>
    Math.abs(travel - npcMovementSpeed / 30) < 1e-6).map(([id]) => id);
  return { world, module, context, navigation, npcs, place, stage, step, pursuers };
}

describe("NPC wave-start roaming and per-player engagement", () => {
  it.each([67.5, 0])("starts both Fixed waves outside detection at speed %s", speed => {
    const s = simulation(1, speed, true);
    try {
      for (const [wave, start] of [[1, 1], [2, 153]] as const) {
        if (wave === 2) {
          for (const npc of s.npcs()) s.world.removeEntity(npc.id);
          s.module.step(0, 2);
          s.module.step(0, 152);
        }
        expect(s.module.state.level).toBe(wave);
        const distant = generateMap(42, "fixed").map.definition.spawns.find(spawn =>
          spawn.kind === "player" && s.npcs().every(npc =>
            Math.hypot(npc.position.x - spawn.position.x, npc.position.y - spawn.position.y) > 514
          ));
        expect(distant, "a living player remains outside every NPC's detection range").toBeDefined();
        s.place("player:p0", distant!.position);
        const travel = s.step(start);
        expect(travel.size).toBe(wave === 1 ? 10 : 12);
        for (const amount of travel.values()) {
          expect(amount).toBeCloseTo(speed * 0.25 / 30, 8);
        }
        expect(s.navigation.outstandingRequests).toBe(0);
        for (const npc of s.npcs()) {
          expect(s.world.geometry.isCircleWalkable(npc.position, npc.radius)).toBe(true);
        }
      }
    } finally { s.module.dispose(); }
  });

  it("admits the closest two of four, retains slots, replaces death and range loss", () => {
    const s = simulation();
    try {
      s.place("player:p0", { x: 700, y: 700 });
      // Deliberately insert farthest first; iteration order must not win.
      s.stage([400, 500, 600, 650].map(x => ({ x, y: 700 })));
      expect(s.pursuers(1).sort()).toEqual(["test:2", "test:3"]);
      s.place("test:0", { x: 630, y: 700 });
      expect(s.pursuers(2).sort()).toEqual(["test:2", "test:3"]);
      s.world.removeEntity("test:3");
      expect(s.pursuers(3).sort()).toEqual(["test:0", "test:2"]);
      s.place("test:2", { x: 1_500, y: 700 });
      expect(s.pursuers(4).sort()).toEqual(["test:0", "test:1"]);
      const health = s.world.getEntity("player:p0")!.state.health;
      // Only a denied NPC is touching the player; it must not deal damage.
      s.place("test:2", { x: 700, y: 700 });
      for (let tick = 5; tick < 15; tick++) {
        expect(s.pursuers(tick).sort()).toEqual(["test:0", "test:1"]);
      }
      expect(s.world.getEntity("player:p0")!.state.health).toBe(health);
      s.world.removeEntity("player:p0");
      expect(s.pursuers(15)).toEqual([]);
    } finally { s.module.dispose(); }
  });

  it("frees zero-health NPC slots and does not target defeated players", () => {
    const s = simulation();
    try {
      s.place("player:p0", { x: 700, y: 700 });
      s.stage([500, 550, 600, 650].map(x => ({ x, y: 700 })));
      expect(s.pursuers(1).sort()).toEqual(["test:2", "test:3"]);
      s.context.entities.update("test:3", npc => ({
        ...npc, state: { ...npc.state, health: 0 }
      }));
      expect(s.pursuers(2).sort()).toEqual(["test:1", "test:2"]);
      s.context.entities.update("player:p0", player => ({
        ...player, state: { ...player.state, health: 0 }
      }));
      expect(s.pursuers(3)).toEqual([]);
    } finally { s.module.dispose(); }
  });

  it("assigns independent caps to overlapping players with one target per NPC", () => {
    const s = simulation(2);
    try {
      s.place("player:p0", { x: 700, y: 700 });
      s.place("player:p1", { x: 900, y: 700 });
      s.stage([640, 660, 680, 920, 940, 960].map(x => ({ x, y: 700 })));
      expect(s.pursuers(1).sort()).toEqual(["test:1", "test:2", "test:3", "test:4"]);
      expect(s.world.getEntity("test:1")!.position.x).toBeGreaterThan(660);
      expect(s.world.getEntity("test:2")!.position.x).toBeGreaterThan(680);
      expect(s.world.getEntity("test:3")!.position.x).toBeLessThan(920);
      expect(s.world.getEntity("test:4")!.position.x).toBeLessThan(940);
      // Getting closer to the other player does not steal an occupied slot.
      s.place("player:p1", { x: 665, y: 700 });
      expect(s.pursuers(2).sort()).toEqual(["test:1", "test:2", "test:3", "test:4"]);
      expect(s.world.getEntity("test:1")!.position.x).toBeGreaterThan(662);
    } finally { s.module.dispose(); }
  });

  it("preserves zero-speed contact for admitted NPCs but denies a third overlapping NPC", () => {
    const s = simulation(1, 0);
    try {
      s.place("player:p0", { x: 700, y: 700 });
      s.stage([600, 650, 400, 500].map(x => ({ x, y: 700 })));
      s.step(1);
      s.place("test:2", { x: 700, y: 700 });
      s.step(2);
      expect(s.world.getEntity("player:p0")!.state.health).toBe(100);
      s.place("test:0", { x: 710, y: 700 });
      s.step(3);
      expect(s.world.getEntity("player:p0")!.state.health).toBe(90);
      expect(s.world.getEntity("test:2")!.position).toEqual({ x: 700, y: 700 });
      expect(s.navigation.outstandingRequests).toBe(0);
    } finally { s.module.dispose(); }
  });
});
