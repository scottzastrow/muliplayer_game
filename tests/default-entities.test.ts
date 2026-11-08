import { describe, expect, it } from "vitest";
import type { GameSettings } from "@multiplayer-game/protocol";
import {
  BoundedNavigation,
  SpatialGrid,
  WorldGeometry,
  type Rect
} from "@multiplayer-game/engine";
import type {
  EntityStore,
  ModuleContext,
  NavigationPathResult,
  Point2,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  NPC_CONTACT_COOLDOWN_TICKS,
  PLAYER_SPEED,
  type DefaultEntity,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";

const roster: readonly RosterMember[] = [
  { accountId: "player-a", username: "Alice", joinedOrder: 0 }
];

describe("default entity movement and pursuit", () => {
  it("normalizes diagonal player movement to the configured speed", () => {
    const simulation = createSimulation();
    const player = simulation.context.entities.get("player:player-a")!;
    const action: DefaultPlayerAction = {
      type: "combat",
      moveX: 1,
      moveY: 1,
      aimX: 0,
      aimY: 0,
      fire: false
    };

    simulation.module.applyInput("player-a", action);
    simulation.module.step(1 / 30, 1);

    const moved = simulation.context.entities.get(player.id)!;
    expect(Math.hypot(
      moved.position.x - player.position.x,
      moved.position.y - player.position.y
    )).toBeCloseTo(PLAYER_SPEED / 30, 8);
    expect(moved.position.x - player.position.x).toBeCloseTo(
      (PLAYER_SPEED / 30) / Math.sqrt(2),
      8
    );
    expect(
      simulation.module.snapshot({ accountId: "player-a", role: "player" }).entities
    ).toContainEqual(expect.objectContaining({
      id: player.id,
      position: moved.position
    }));
    simulation.module.dispose();
  });

  it.each([400, 700])(
    "stays idle outside the %i-unit range and pursues at its configured speed inside it",
    npcDetectionRange => {
      const npcMovementSpeed = 33.75;
      const simulation = createSimulation([], { npcMovementSpeed, npcDetectionRange });
      try {
        const npc = simulation.context.entities.get("npc:npc-northwest")!;
        const player = simulation.context.entities.get("player:player-a")!;
        simulation.context.entities.update(npc.id, entity => ({
          ...entity, position: { x: 700, y: 700 }
        }));
        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: 700 + npcDetectionRange + 1, y: 700 }
        }));

        simulation.module.step(1 / 30, 1);
        expect(simulation.context.entities.get(npc.id)?.position).toEqual({ x: 700, y: 700 });

        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: 700 + npcDetectionRange, y: 700 }
        }));
        simulation.module.step(1 / 30, 2);

        expect(simulation.context.entities.get(npc.id)!.position.x).toBeCloseTo(
          700 + npcMovementSpeed / 30,
          6
        );
      } finally { simulation.module.dispose(); }
    }
  );

  it("disables automatic pursuit when NPC detection range is zero", () => {
    const simulation = createSimulation([], { npcDetectionRange: 0 });
    try {
      const npcId = "npc:npc-northwest";
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 710, y: 700 }
      }));
      simulation.module.step(1 / 30, 1);
      expect(simulation.context.entities.get(npcId)!.position).toEqual({ x: 700, y: 700 });
      expect(simulation.navigation.requestsSubmitted).toBe(0);
    } finally { simulation.module.dispose(); }
  });

  it.each([0, 33.75, 67.5, 90, 180])("travels at %s units/second during direct pursuit", npcMovementSpeed => {
    const simulation = createSimulation([], { npcMovementSpeed });
    const npcId = "npc:npc-northwest";
    try {
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 1_100, y: 700 }
      }));
      for (let tick = 1; tick <= 30; tick += 1) simulation.module.step(1 / 30, tick);
      expect(simulation.context.entities.get(npcId)!.position.x - 700)
        .toBeCloseTo(npcMovementSpeed, 6);
      expect(simulation.context.entities.get(npcId)!.position.y).toBe(700);
    } finally { simulation.module.dispose(); }
  });

  it("keeps zero-speed NPCs stationary without disabling contact damage", () => {
    const simulation = createSimulation([], { npcMovementSpeed: 0 });
    try {
      const npcId = "npc:npc-northwest";
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 710, y: 700 }
      }));
      simulation.module.step(1 / 30, 1);
      expect(simulation.context.entities.get(npcId)!.position).toEqual({ x: 700, y: 700 });
      expect(simulation.context.entities.get("player:player-a")!.state).toMatchObject({ health: 90 });
      expect(simulation.navigation.requestsSubmitted).toBe(0);
    } finally { simulation.module.dispose(); }
  });

  it.each([33.75, 67.5, 90, 180])("routes an attracted NPC around an obstacle at %s units/second", npcMovementSpeed => {
    const wall: Rect = { x: 1_000, y: 800, width: 32, height: 400 };
    const simulation = createSimulation([wall], { npcMovementSpeed });
    const npcId = "npc:npc-northwest";
    const playerId = "player:player-a";
    simulation.context.entities.update(npcId, (entity) => ({
      ...entity,
      position: { x: 990, y: 1_000 }
    }));
    simulation.context.entities.update(playerId, (entity) => ({
      ...entity,
      position: { x: 1_100, y: 1_000 }
    }));

    let requestTick = 0;
    do {
      requestTick += 1;
      simulation.module.step(1 / 30, requestTick);
    } while (simulation.navigation.outstandingRequests === 0 && requestTick < 10);
    expect(simulation.navigation.outstandingRequests).toBeGreaterThan(0);
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);

    let travelled = 0;
    for (let tick = requestTick + 1; tick <= Math.ceil(600 / npcMovementSpeed * 30); tick += 1) {
      simulation.navigation.processTick();
      const previous = simulation.context.entities.get(npcId)!.position;
      simulation.module.step(1 / 30, tick);
      const position = simulation.context.entities.get(npcId)!.position;
      const distance = Math.hypot(position.x - previous.x, position.y - previous.y);
      expect(distance).toBeLessThanOrEqual(npcMovementSpeed / 30 + 1e-8);
      expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
      travelled += distance;
      if (tick === requestTick + 30) expect(travelled).toBeCloseTo(npcMovementSpeed, 6);
      if (position.x > wall.x + wall.width && Math.abs(position.y - 1_000) > wall.height / 2) {
        break;
      }
    }

    const position = simulation.context.entities.get(npcId)!.position;
    expect(position.x).toBeGreaterThan(wall.x + wall.width);
    expect(Math.abs(position.y - 1_000)).toBeGreaterThan(wall.height / 2);
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);
    simulation.module.dispose();
  });

  it("caps per-tick path submissions and keeps contact attacks capability-scoped", () => {
    const wall: Rect = { x: 1_000, y: 700, width: 32, height: 700 };
    const simulation = createSimulation([wall]);
    const playerId = "player:player-a";
    simulation.context.entities.update(playerId, (entity) => ({
      ...entity,
      position: { x: 1_100, y: 1_000 }
    }));
    for (let index = 0; index < 20; index += 1) {
      simulation.context.entities.add({
        id: `npc:extra-${index}`,
        typeId: "npc",
        position: { x: 990, y: 720 + index * 30 },
        radius: 8,
        state: {
          kind: "npc",
          attackCapability: {
            typeId: "default.contact-attack",
            damage: 10,
            cooldownTicks: NPC_CONTACT_COOLDOWN_TICKS
          }
        }
      });
    }
    const originalNpc = simulation.context.entities.get("npc:npc-northwest")!;
    simulation.context.entities.update(originalNpc.id, (entity) => ({
      ...entity,
      position: { x: 990, y: 1_000 }
    }));

    simulation.module.step(1 / 30, 1);
    expect(simulation.navigation.requestsSubmitted).toBeLessThanOrEqual(
      MAX_NPC_PATH_REQUESTS_PER_TICK
    );
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);

    simulation.context.entities.update(playerId, (entity) => ({
      ...entity,
      position: { x: 978, y: 1_000 }
    }));
    simulation.module.step(1 / 30, 2);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 90
    });
    simulation.module.step(0, 20);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 90
    });
    simulation.module.step(0, 2 + NPC_CONTACT_COOLDOWN_TICKS);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 80
    });
    simulation.module.dispose();
  });
});

function createSimulation(obstacles: readonly Rect[] = [], settings: Partial<GameSettings> = {}) {
  const entities = new Map<string, DefaultEntity>();
  const spatialGrid = new SpatialGrid(32);
  const store: EntityStore<DefaultEntity> = {
    get: (id) => entities.get(id),
    add: (entity) => {
      if (entities.has(entity.id)) {
        throw new TypeError(`Duplicate entity ID ${entity.id}.`);
      }
      entities.set(entity.id, entity);
      spatialGrid.set(entity);
    },
    update: (id, update) => {
      const entity = entities.get(id);
      if (!entity) {
        throw new RangeError(`Entity ${id} does not exist.`);
      }
      const updated = update(entity);
      entities.set(id, updated);
      spatialGrid.set(updated);
    },
    remove: (id) => {
      spatialGrid.remove(id);
      return entities.delete(id);
    },
    values: () => [...entities.values()],
    queryRadius: (center, radius, maxCells) =>
      spatialGrid.queryRadius(center, radius, maxCells).map(({ id }) => entities.get(id)!)
  };
  const geometry = new WorldGeometry({ width: 2_048, height: 2_048 }, obstacles);
  const navigation = new BoundedNavigation(geometry, {
    cellSize: 32,
    agentRadius: 8
  });
  let requestsSubmitted = 0;
  const results = new Map<string, NavigationPathResult>();
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: { next: () => 0.5 },
    entities: store,
    geometry: {
      isWalkable: (x, y, radius = 0) => geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => geometry.moveCircle(position, delta, radius)
    },
    navigation: {
      requestPath: (from, to) => {
        requestsSubmitted += 1;
        let resultId: string | undefined;
        const requestId = navigation.requestPath(from, to, (result) => {
          if (resultId) {
            results.set(resultId, result);
          }
        });
        if (requestId === undefined) {
          return undefined;
        }
        resultId = String(requestId);
        return resultId;
      },
      getPath: (requestId) => results.get(requestId)
    },
    emit: () => {},
    requestCompletion: () => {},
    metrics: {
      increment: () => {},
      gauge: () => {}
    }
  };
  const module = defaultModuleFactory.create(context, settings, roster, 42);
  module.initialize();
  return {
    context,
    module,
    navigation: Object.assign(navigation, {
      get requestsSubmitted() {
        return requestsSubmitted;
      }
    })
  };
}
