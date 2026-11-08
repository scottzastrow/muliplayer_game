import { describe, expect, it } from "vitest";
import type { ModuleContext } from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  generateMap,
  type DefaultEntity
} from "@multiplayer-game/default-theme";
import { SessionWorld, WorldGeometry, type Vector2 } from "../packages/engine/src/world.js";
import { normalizeMovement } from "../themes/default/src/module/entities.js";
import { PLAYER_RADIUS, PLAYER_SPEED, SAFE_SPAWN_MARGIN } from "../themes/default/src/module/tuning.js";

const TICK_SECONDS = 1 / 30;
// Seed 42 produces a single 64x64 obstacle at (992, 992); these tests depend on that layout.
const OBSTACLE = { x: 992, y: 992, width: 64, height: 64 };
// Walkable position whose x-axis move lands on the obstacle's top-left corner arc.
const CORNER_APPROACH = { x: 980.5, y: 983.9 };

function playerDelta(moveX: number, moveY: number): Vector2 {
  const movement = normalizeMovement(moveX, moveY);
  return { x: movement.x * PLAYER_SPEED * TICK_SECONDS, y: movement.y * PLAYER_SPEED * TICK_SECONDS };
}

describe("collision resolution against obstacle corners", () => {
  it("never resolves a walkable start into geometry the world rejects", () => {
    const geometry = new WorldGeometry({ width: 2_048, height: 2_048 }, [OBSTACLE]);
    expect(geometry.isCircleWalkable(CORNER_APPROACH, PLAYER_RADIUS)).toBe(true);
    const moved = geometry.moveCircle(CORNER_APPROACH, playerDelta(1, 1), PLAYER_RADIUS);
    expect(geometry.isCircleWalkable(moved, PLAYER_RADIUS)).toBe(true);
    expect(moved.x).toBeGreaterThan(CORNER_APPROACH.x);
    expect(moved.y).toBeCloseTo(CORNER_APPROACH.y, 6);
    const away = geometry.moveCircle(moved, playerDelta(-1, -1), PLAYER_RADIUS);
    expect(away.x).toBeLessThan(moved.x - 4);
    expect(away.y).toBeLessThan(moved.y - 4);

    const inputs = [-1, -0.5, 0, 0.5, 1].flatMap((x) => [-1, -0.5, 0, 0.5, 1].map((y) => [x, y] as const));
    const corners = [
      [OBSTACLE.x, OBSTACLE.y, -1, -1],
      [OBSTACLE.x + OBSTACLE.width, OBSTACLE.y, 1, -1],
      [OBSTACLE.x, OBSTACLE.y + OBSTACLE.height, -1, 1],
      [OBSTACLE.x + OBSTACLE.width, OBSTACLE.y + OBSTACLE.height, 1, 1]
    ] as const;
    const rejected: string[] = [];
    for (const [cornerX, cornerY, signX, signY] of corners) {
      for (let i = 0; i <= 160; i += 1) {
        for (let j = 0; j <= 160; j += 1) {
          const start = { x: cornerX + (signX * i) / 10, y: cornerY + (signY * j) / 10 };
          if (!geometry.isCircleWalkable(start, PLAYER_RADIUS)) continue;
          for (const [moveX, moveY] of inputs) {
            const end = geometry.moveCircle(start, playerDelta(moveX, moveY), PLAYER_RADIUS);
            if (!geometry.isCircleWalkable(end, PLAYER_RADIUS)) {
              rejected.push(JSON.stringify({ start, moveX, moveY, end }));
            }
          }
        }
      }
    }
    expect(rejected.slice(0, 5)).toEqual([]);
  });

  it("keeps sliding into a corner over many ticks walkable", () => {
    const geometry = new WorldGeometry({ width: 2_048, height: 2_048 }, [OBSTACLE]);
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    let position: Vector2 = { x: 940, y: 941 };
    for (let tick = 0; tick < 20_000; tick += 1) {
      const angle = next() * (Math.PI / 2);
      position = geometry.moveCircle(position, playerDelta(Math.cos(angle), Math.sin(angle)), PLAYER_RADIUS);
      expect(geometry.isCircleWalkable(position, PLAYER_RADIUS)).toBe(true);
    }
  });
});

describe("rejected entity updates", () => {
  it("leave the previous entity, its spatial index entry and the entity count intact", () => {
    const world = new SessionWorld("rejected-update", { width: 2_048, height: 2_048 }, [OBSTACLE]);
    const original = {
      id: "player:alice", typeId: "player", radius: PLAYER_RADIUS,
      position: CORNER_APPROACH, state: { health: 100 }
    };
    world.addEntity(original);
    expect(() => world.addEntity({ ...original, position: { x: 1_000, y: 1_000 }, state: { health: 1 } }))
      .toThrow(/outside walkable world geometry/);
    expect(world.getEntity("player:alice")).toEqual(original);
    expect(world.entityCount).toBe(1);
    expect(world.queryEntities(CORNER_APPROACH, 1).map((entity) => entity.id)).toEqual(["player:alice"]);
    expect(world.queryEntities({ x: 1_000, y: 1_000 }, 1)).toHaveLength(0);
  });

  it("propagate from the default simulator without removing or corrupting the player", () => {
    const { module, world } = createSimulation({
      moveCircle: () => ({ x: OBSTACLE.x + 10, y: OBSTACLE.y + 10 })
    });
    try {
      placePlayer(world, CORNER_APPROACH);
      const before = world.getEntity("player:alice")!;
      module.applyInput("alice", { type: "combat", moveX: 1, moveY: 1, aimX: 0, aimY: 0, fire: false });
      expect(() => module.step(TICK_SECONDS, 1)).toThrow(/outside walkable world geometry/);
      expect(world.getEntity("player:alice")).toMatchObject({
        ...before,
        state: { ...before.state, facing: expect.any(Object) }
      });
    } finally {
      module.dispose();
    }
  });
});

describe("default simulator movement near the map obstacle", () => {
  it("moves an ordinary live player into the corner without a world rejection", () => {
    const { module, world } = createSimulation();
    try {
      placePlayer(world, CORNER_APPROACH);
      module.applyInput("alice", { type: "combat", moveX: 1, moveY: 1, aimX: 0, aimY: 0, fire: false });
      for (let tick = 1; tick <= 30; tick += 1) {
        module.step(TICK_SECONDS, tick);
        const player = world.getEntity("player:alice")!;
        expect(world.geometry.isCircleWalkable(player.position, player.radius)).toBe(true);
      }
    } finally {
      module.dispose();
    }
  });

  it("respawns at a position the player record and world agree on, then moves from it", () => {
    // Respawn cell grid: inset 2, 60 columns; cell 28*60+26 is centred at (912, 976).
    const spawnCell = 28 * 60 + 26;
    const { module, world } = createSimulation({ random: (spawnCell + 0.5) / 3_600 });
    try {
      placePlayer(world, CORNER_APPROACH, 0);
      module.step(0, 1);
      expect(world.getEntity("player:alice")).toBeUndefined();
      module.step(0, 151);

      const spawned = world.getEntity("player:alice")!;
      expect(spawned.position).toEqual({ x: 912, y: 976 });
      expect(spawned.radius).toBe(PLAYER_RADIUS);
      expect(spawned.state).toMatchObject({ health: 100, deaths: 1 });
      expect(world.geometry.isCircleWalkable(spawned.position, PLAYER_RADIUS)).toBe(true);
      expect(world.geometry.isCircleWalkable(spawned.position, PLAYER_RADIUS + SAFE_SPAWN_MARGIN)).toBe(true);
      expect(snapshotPosition(module)).toEqual(spawned.position);

      // Respawn resets input, so the respawn tick itself does not move the player.
      module.step(TICK_SECONDS, 152);
      expect(world.getEntity("player:alice")!.position).toEqual(spawned.position);

      let previous = spawned.position;
      module.applyInput("alice", { type: "combat", moveX: 1, moveY: 0.25, aimX: 0, aimY: 0, fire: false });
      for (let tick = 153; tick < 213; tick += 1) {
        const expected = world.geometry.moveCircle(previous, playerDelta(1, 0.25), PLAYER_RADIUS);
        module.step(TICK_SECONDS, tick);
        const player = world.getEntity("player:alice")!;
        expect(player.position).toEqual(expected);
        expect(world.geometry.isCircleWalkable(player.position, player.radius)).toBe(true);
        expect(snapshotPosition(module)).toEqual(player.position);
        previous = player.position;
      }
      expect(previous.x).toBeGreaterThan(OBSTACLE.x - PLAYER_RADIUS - 1);
    } finally {
      module.dispose();
    }
  });
});

function createSimulation(options: {
  random?: number;
  moveCircle?: ModuleContext<DefaultEntity>["geometry"]["moveCircle"];
} = {}) {
  const map = generateMap(42).map;
  expect(map.obstacles).toEqual([OBSTACLE]);
  const world = new SessionWorld<DefaultEntity>("movement-test", map.definition.bounds, map.obstacles);
  // Mirrors the session-lifecycle EntityStore.update contract.
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: { next: () => options.random ?? 0.5 },
    entities: {
      get: (id) => world.getEntity(id),
      add: (entity) => world.addEntity(entity),
      update: (id, update) => {
        const current = world.getEntity(id);
        if (!current) throw new RangeError(`Entity ${id} does not exist in this session.`);
        world.addEntity(update(current));
      },
      remove: (id) => world.removeEntity(id),
      values: () => world.entities(),
      queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: options.moveCircle ??
        ((position, delta, radius) => world.geometry.moveCircle(position, delta, radius))
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {},
    requestCompletion: () => {},
    metrics: { increment: () => {}, gauge: () => {} }
  };
  const module = defaultModuleFactory.create(
    context, {}, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 42
  );
  module.initialize();
  for (const entity of world.entities()) {
    if (entity.state.kind === "npc") world.removeEntity(entity.id);
  }
  return { module, world };
}

function placePlayer(world: SessionWorld<DefaultEntity>, position: Vector2, health = 100): void {
  const player = world.getEntity("player:alice");
  if (!player || player.state.kind !== "player") throw new Error("Player is missing.");
  world.addEntity({ ...player, position, state: { ...player.state, health } });
}

function snapshotPosition(module: ReturnType<typeof createSimulation>["module"]): unknown {
  const snapshot = module.snapshot({ accountId: "alice", role: "player" }) as {
    players: Array<{ position: Vector2 }>;
  };
  return snapshot.players[0]!.position;
}
