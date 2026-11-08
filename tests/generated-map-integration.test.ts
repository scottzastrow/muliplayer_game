import { describe, expect, it } from "vitest";
import {
  defaultModuleFactory,
  DefaultEntitySimulator,
  generateMap,
  type DefaultEntity
} from "@multiplayer-game/default-theme";
import { BoundedNavigation, SessionWorld } from "@multiplayer-game/engine";
import type { ModuleContext, NavigationPathResult } from "@multiplayer-game/theme-sdk";
import { DefaultViewSchema } from "../themes/default/src/skin/view.js";

describe("generated Dots and Squares map integration", () => {
  it("uses the chosen map for world movement, shots, navigation, snapshots and radar across waves", () => {
    const map = generateMap(42, "simple-generated").map;
    expect(map.obstacles).not.toEqual(generateMap(42, "fixed").map.obstacles);
    const world = new SessionWorld<DefaultEntity>("generated", map.definition.bounds, map.obstacles);
    const navigation = new BoundedNavigation(world.geometry, { cellSize: 32, agentRadius: 8 });
    const results = new Map<string, NavigationPathResult>();
    let nextId = 0;
    const context: ModuleContext<DefaultEntity> & { defaultMapDefinition: typeof map.definition } = {
      defaultMapDefinition: map.definition,
      clock: { nowMs: () => 0 },
      random: { next: () => 0.5 },
      entities: {
        get: (id) => world.getEntity(id),
        add: (entity) => world.addEntity(entity),
        update: (id, update) => {
          const current = world.getEntity(id);
          if (!current) throw new Error(`Missing entity ${id}.`);
          world.addEntity(update(current));
        },
        remove: (id) => world.removeEntity(id),
        values: () => world.entities(),
        queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
      },
      geometry: {
        isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
        intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
        moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
      },
      navigation: {
        requestPath: (from, to) => {
          const id = String(++nextId);
          return navigation.requestPath(from, to, result => results.set(id, result)) === undefined
            ? undefined : id;
        },
        getPath: (id) => results.get(id)
      },
      emit: () => {},
      requestCompletion: () => {},
      metrics: { increment: () => {}, gauge: () => {} }
    };
    const module = defaultModuleFactory.create(context,
      { initialNpcsPerPlayer: 1, npcMovementSpeed: 0, maxLevels: 2 },
      [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 999);
    try {
      module.initialize();
      const snapshot = () => DefaultViewSchema.parse(
        module.snapshot({ accountId: "alice", role: "player" })
      );
      const initial = snapshot();
      expect(initial.map.obstacles).toEqual(world.geometry.obstacles);
      expect(initial.radar!.markers.filter(marker => marker.category === "terrain"))
        .toEqual(map.obstacles.map((obstacle, index) => ({
          id: `terrain:${index}`, category: "terrain",
          position: { x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 },
          footprint: { width: obstacle.width, height: obstacle.height }
        })));

      const encounter = map.obstacles.map(obstacle => ({
        obstacle,
        start: { x: obstacle.x - 30, y: obstacle.y + 16 },
        target: { x: obstacle.x + 100, y: obstacle.y + 16 }
      })).find(({ start, target }) =>
        world.geometry.isCircleWalkable(start, 14) &&
        world.geometry.isCircleWalkable(target, 8)
      );
      expect(encounter).toBeDefined();
      const { start, target, obstacle } = encounter!;
      const player = world.getEntity("player:alice")!;
      const npc = world.entities().find(entity => entity.state.kind === "npc")!;
      world.addEntity({ ...player, position: start });
      world.addEntity({ ...npc, position: target });

      const request = context.navigation.requestPath(start, target);
      expect(request).toBeDefined();
      for (let tick = 0; tick < 10 && !results.has(request!); tick += 1) navigation.processTick();
      const path = context.navigation.getPath(request!);
      expect(path?.status).toBe("found");
      if (path?.status !== "found") throw new Error("Generated map route not found.");
      expect(path.path.length).toBeGreaterThan(2);
      for (const point of path.path) expect(world.geometry.isCircleWalkable(point, 8)).toBe(true);

      module.applyInput("alice", {
        type: "combat", moveX: 1, moveY: 0, aimX: target.x, aimY: target.y, fire: false
      });
      for (let tick = 1; tick <= 15; tick += 1) module.step(1 / 30, tick);
      expect(world.getEntity(player.id)!.position.x).toBeLessThanOrEqual(obstacle.x - 14);

      world.addEntity({ ...world.getEntity(player.id)!, position: start });
      module.applyInput("alice", {
        type: "combat", moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, fire: true
      });
      for (let tick = 16; tick <= 30; tick += 1) module.step(1 / 30, tick);
      expect(world.getEntity(npc.id)?.state).toMatchObject({ health: 100 });
      expect(world.entities().filter(entity => entity.state.kind === "projectile")).toHaveLength(0);

      world.removeEntity(npc.id);
      module.step(0, 31);
      expect(snapshot().phase).toBe("intermission");
      module.step(0, 181);
      const nextWave = snapshot();
      expect(nextWave.level).toBe(2);
      expect(nextWave.map).toEqual(initial.map);
      expect(nextWave.radar!.markers.filter(marker => marker.category === "terrain"))
        .toEqual(initial.radar!.markers.filter(marker => marker.category === "terrain"));

      module.dispose();
      const pursuing = new DefaultEntitySimulator(context, 90, 700);
      try {
        pursuing.initialize(map, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 1);
        const pursuer = world.entities().find(entity => entity.state.kind === "npc")!;
        world.addEntity({ ...world.getEntity("player:alice")!, position: start });
        world.addEntity({ ...pursuer, position: target });
        const previousRequests = nextId;
        let crossed = false;
        for (let tick = 1; tick <= 240; tick += 1) {
          pursuing.step(1 / 30, tick);
          navigation.processTick();
          const current = world.getEntity(pursuer.id)!;
          expect(world.geometry.isCircleWalkable(current.position, current.radius)).toBe(true);
          if (current.position.x < obstacle.x - current.radius) {
            crossed = true;
            break;
          }
        }
        expect(nextId).toBeGreaterThan(previousRequests);
        expect(crossed).toBe(true);
      } finally {
        pursuing.dispose();
      }
    } finally {
      module.dispose();
    }
  });
});
