import { describe, expect, it, vi } from "vitest";
import {
  BoundedNavigation, SeededRandom, SessionWorld
} from "@multiplayer-game/engine";
import {
  defaultModuleFactory, generateMap, MAX_NPC_PATH_REQUESTS_PER_TICK,
  NPC_EXPLORE_PAUSE_TICKS, NPC_EXPLORE_SPEED_FACTOR, type DefaultEntity
} from "@multiplayer-game/default-theme";
import type {
  ModuleContext, NavigationPathResult, Point2
} from "@multiplayer-game/theme-sdk";

function simulation(players = 1, npcMovementSpeed = 67.5, fixed = false, seed = 42) {
  const map = generateMap(seed, "fixed").map;
  const world = new SessionWorld<DefaultEntity>(
    "engagement", map.definition.bounds, fixed ? map.obstacles : []
  );
  const navigation = new BoundedNavigation(world.geometry, { cellSize: 32, agentRadius: 8 });
  const results = new Map<string, NavigationPathResult>();
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: new SeededRandom(seed),
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
  }, roster, seed);
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
  it.each([
    { seed: 42, speed: 67.5 }, { seed: 12, speed: 67.5 }, { seed: 12, speed: 0 }
  ])("sustains Fixed roaming for 15 seconds at seed $seed / speed $speed", ({ seed, speed }) => {
    const s = simulation(1, speed, true, seed);
    const playerPosition = s.world.getEntity("player:p0")!.position;
    const travel = new Map(s.npcs().map(npc => [npc.id, [0, 0, 0]]));
    const outsideThroughout = new Set(travel.keys());
    const requestsByNpc = new Map<string, number>();
    const requestPath = s.context.navigation.requestPath;
    const requests = vi.spyOn(s.context.navigation, "requestPath").mockImplementation((from, to) => {
      const npc = s.npcs().find(npc =>
        npc.position.x === from.x && npc.position.y === from.y);
      if (!npc) throw new Error("Navigation request must originate at a current NPC position.");
      const requestId = requestPath(from, to);
      if (requestId) requestsByNpc.set(npc.id, (requestsByNpc.get(npc.id) ?? 0) + 1);
      return requestId;
    });
    try {
      for (let tick = 1; tick <= 450; tick++) {
        const amounts = s.step(tick);
        expect(s.module.state.players).toContainEqual(expect.objectContaining({
          accountId: "p0", position: playerPosition
        }));
        for (const npc of s.npcs()) {
          if (Math.hypot(npc.position.x - playerPosition.x,
            npc.position.y - playerPosition.y) <= 512) outsideThroughout.delete(npc.id);
          travel.get(npc.id)![Math.floor((tick - 1) / 150)]! += amounts.get(npc.id)!;
          expect(s.world.geometry.isCircleWalkable(npc.position, npc.radius)).toBe(true);
        }
      }
      expect(outsideThroughout.size).toBeGreaterThanOrEqual(6);
      for (const id of outsideThroughout) {
        for (const amount of travel.get(id)!) {
          if (speed === 0) expect(amount).toBe(0);
          else expect(amount, `${id} must move in each five-second window`).toBeGreaterThan(10);
        }
        if (speed > 0) expect(requestsByNpc.get(id)).toBeGreaterThanOrEqual(1);
      }
      if (speed === 0) expect(requests).not.toHaveBeenCalled();
    } finally { s.module.dispose(); }
  });

  it("explores every non-pursuing NPC for 30 seconds with four in range of an idle player", () => {
    const s = simulation(1, 67.5, true);
    const fullStep = 67.5 / 30;
    const playerId = "player:p0";
    const center = s.world.getEntity(playerId)!.position;
    const staged = s.npcs().map(npc => npc.id).sort().slice(0, 4);
    const stagedAt = new Map<string, Point2>();
    for (const [index, id] of staged.entries()) {
      const reach = 120 + index * 80;
      for (let turn = 0; turn < 64 && !stagedAt.has(id); turn += 1) {
        const angle = index * Math.PI / 2 + turn * Math.PI / 32;
        const point = { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach };
        if (s.world.geometry.isCircleWalkable(point, 8)) stagedAt.set(id, point);
      }
      s.place(id, stagedAt.get(id)!);
    }
    const closestTwo = [...staged].sort((a, b) =>
      Math.hypot(stagedAt.get(a)!.x - center.x, stagedAt.get(a)!.y - center.y) -
      Math.hypot(stagedAt.get(b)!.x - center.x, stagedAt.get(b)!.y - center.y)).slice(0, 2);
    const starts = new Map(s.npcs().map(npc => [npc.id, npc.position]));
    const report = new Map(s.npcs().map(npc => [npc.id, {
      inRangeAtStart: staged.includes(npc.id), pursuedTicks: 0, distance: 0,
      windows: [0, 0, 0, 0, 0, 0], stationary: 0, longestStationaryTicks: 0, farthest: 0
    }]));
    try {
      for (let tick = 1; tick <= 900; tick += 1) {
        // Hold the idle player alive so both pursuit slots stay occupied for the whole run.
        s.context.entities.update(playerId, player => player.state.kind === "player"
          ? { ...player, state: { ...player.state, health: 100 } } : player);
        const travel = s.step(tick);
        expect(s.world.getEntity(playerId)!.position).toEqual(center);
        for (const npc of s.npcs()) {
          const row = report.get(npc.id)!;
          const amount = travel.get(npc.id)!;
          const atPlayer = Math.hypot(npc.position.x - center.x, npc.position.y - center.y) <= 22;
          if (Math.abs(amount - fullStep) < 1e-6 || (amount === 0 && atPlayer)) {
            row.pursuedTicks += 1;
            continue;
          }
          row.distance += amount;
          row.windows[Math.floor((tick - 1) / 150)]! += amount;
          row.stationary = amount > 0 ? 0 : row.stationary + 1;
          row.longestStationaryTicks = Math.max(row.longestStationaryTicks, row.stationary);
          const start = starts.get(npc.id)!;
          row.farthest = Math.max(row.farthest,
            Math.hypot(npc.position.x - start.x, npc.position.y - start.y));
          expect(s.world.geometry.isCircleWalkable(npc.position, npc.radius)).toBe(true);
        }
      }
      console.table([...report].map(([id, row]) => ({
        id, inRangeAtStart: row.inRangeAtStart, pursuedTicks: row.pursuedTicks,
        distance: Number(row.distance.toFixed(2)),
        longestStationarySeconds: Number((row.longestStationaryTicks / 30).toFixed(3)),
        farthestFromStart: Number(row.farthest.toFixed(2))
      })));
      for (const [id, row] of report) {
        if (closestTwo.includes(id)) {
          // One partial closing step reaches contact range; every other tick is pursuit.
          expect(row.pursuedTicks, `${id} holds a pursuit slot`).toBeGreaterThanOrEqual(899);
          continue;
        }
        expect(row.pursuedTicks, `${id} has no pursuit slot`).toBe(0);
        expect(row.distance).toBeGreaterThan(0.75 * 900 * fullStep * NPC_EXPLORE_SPEED_FACTOR);
        expect(row.longestStationaryTicks).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
        expect(row.farthest, `${id} explores away from its start`).toBeGreaterThan(256);
        for (const window of row.windows) {
          expect(window, `${id} moves in every five-second window`).toBeGreaterThan(100);
        }
      }
    } finally { s.module.dispose(); }
  });

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
          expect(amount).toBeCloseTo(speed * NPC_EXPLORE_SPEED_FACTOR / 30, 8);
        }
        // Explore requests a path toward each new goal, within the shared per-tick budget.
        expect(s.navigation.outstandingRequests)
          .toBeLessThanOrEqual(speed === 0 ? 0 : MAX_NPC_PATH_REQUESTS_PER_TICK);
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
