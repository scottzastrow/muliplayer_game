import { describe, expect, it } from "vitest";
import { SpatialGrid, WorldGeometry, type Rect } from "@multiplayer-game/engine";
import type {
  EntityStore,
  ModuleContext,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import {
  DEFAULT_GAME_SETTINGS,
  defaultModuleFactory,
  DefaultEntitySimulator,
  generateMap,
  HEALTH_PICKUP_AMOUNT,
  loadMap,
  MAX_PICKUPS_PER_SESSION,
  MAX_PROJECTILES_PER_SESSION,
  PLAYER_FIRE_RATE_PER_SECOND,
  PLAYER_RAPID_FIRE_RATE_PER_SECOND,
  POWERUP_DURATION_TICKS,
  type DefaultEntity,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";

const roster: readonly RosterMember[] = [
  { accountId: "player-a", username: "Alice", joinedOrder: 0 },
  { accountId: "player-b", username: "Bob", joinedOrder: 1 }
];

describe("default combat", () => {
  it.each([150, 37, 275])("caps healing at configured %s HP and leaves full-health pickups unclaimed", maximum => {
    const { context, module } = createSimulation(undefined, { playerMaxHealth: maximum });
    try {
      removeNpcs(context);
      addIdleNpc(context);
      const position = { x: 272, y: 272 };
      moveEntity(context, "player:player-a", position);
      moveEntity(context, "player:player-b", { x: 1700, y: 272 });
      moveEntity(context, "pickup:pickup-health", position);
      setHealth(context, "player:player-a", maximum);
      module.step(0, 1);
      expect(context.entities.get("pickup:pickup-health")).toBeDefined();
      setHealth(context, "player:player-a", maximum - 10);
      module.step(0, 2);
      expect(context.entities.get("player:player-a")!.state.health).toBe(maximum);
      expect(context.entities.get("pickup:pickup-health")).toBeUndefined();
    } finally { module.dispose(); }
  });

  it.each([
    { label: "default", settings: {}, healthTrace: [50, 25, 0] },
    { label: "host 100 HP", settings: { baseNpcHealth: 100 }, healthTrace: [100, 75, 50, 25, 0] },
    { label: "host 75 HP", settings: { baseNpcHealth: 75 }, healthTrace: [75, 50, 25, 0] }
  ])("measures unboosted projectile hits in a clear lane: $label", ({ label, settings, healthTrace }) => {
    const { context, module } = createSimulation(generateMap(42).map.obstacles, {
      ...settings, initialNpcsPerPlayer: 10, npcMovementSpeed: 0, npcDetectionRange: 0
    });
    try {
      const npcs = context.entities.values().filter(entity => entity.state.kind === "npc");
      expect(npcs).toHaveLength(20);
      const target = npcs[0]!;
      if (target.state.kind !== "npc") throw new TypeError("Expected a spawned NPC.");
      const remainingHealth = (): number => {
        const current = context.entities.get(target.id);
        if (!current) return 0;
        if (current.state.kind !== "npc") throw new TypeError("Expected an NPC target.");
        return current.state.health;
      };
      for (const entity of context.entities.values()) {
        if ((entity.state.kind === "npc" && entity.id !== target.id) ||
            entity.state.kind === "pickup") context.entities.remove(entity.id);
      }
      moveEntity(context, "player:player-a", { x: 272, y: 272 });
      moveEntity(context, target.id, { x: 472, y: 272 });
      for (let x = 272; x <= 472; x += 1) {
        expect(context.geometry.isWalkable(x, 272, 3)).toBe(true);
        expect(context.geometry.intersectsObstacle(x, 272, 3)).toBe(false);
      }

      const observedHealth = [target.state.health];
      let tick = 0;
      let hits = 0;
      while (context.entities.get(target.id) && hits < 10) {
        expect(context.entities.get("player:player-a")?.state.effects).toBeUndefined();
        module.applyInput("player-a", combatInput(472, 272));
        module.step(1 / 30, ++tick);
        const projectiles = context.entities.values().filter(entity => entity.state.kind === "projectile");
        expect(projectiles).toHaveLength(1);
        expect(projectiles[0]?.state).toMatchObject({
          damage: 25, velocity: { x: 600, y: 0 }, ownerAccountId: "player-a"
        });
        module.applyInput("player-a", { ...combatInput(472, 272), fire: false });
        const previousHealth = observedHealth.at(-1)!;
        for (let travel = 0; travel < 20; travel += 1) {
          module.step(1 / 30, ++tick);
          const health = remainingHealth();
          if (health !== previousHealth) break;
        }
        const health = remainingHealth();
        expect(health).toBe(Math.max(0, previousHealth - 25));
        expect(countProjectiles(context)).toBe(0);
        observedHealth.push(health);
        hits += 1;
      }
      console.info(`${label}: shot damage=25; observed HP=${observedHealth.join(" -> ")}; hits to kill=${hits}`);
      expect(observedHealth).toEqual(healthTrace);
      expect(context.entities.get(target.id)).toBeUndefined();
      expect(module.results().standings.find(standing => standing.accountId === "player-a"))
        .toMatchObject({ kills: 1, points: 100 });
    } finally {
      module.dispose();
    }
  });

  it("uses the configured firing cadence and never damages another player", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    moveEntity(context, "player:player-b", { x: 320, y: 272 });
    addNpc(context, "npc:target", { x: 420, y: 272 });
    module.applyInput("player-a", combatInput(420, 272));

    module.step(1 / 30, 1);
    for (let tick = 2; tick <= 7; tick += 1) {
      module.step(1 / 30, tick);
    }

    expect(countProjectiles(context)).toBe(1);
    expect(context.entities.get("projectile:1")).toBeDefined();
    expect(context.entities.get("player:player-b")?.state).toMatchObject({
      kind: "player",
      health: 150
    });
    expect(context.entities.get("npc:target")?.state).toMatchObject({
      kind: "npc",
      health: 75
    });
    expect(PLAYER_FIRE_RATE_PER_SECOND).toBe(5);
    module.dispose();
  });

  it("awards score and a kill for authoritative projectile hits", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    addNpc(context, "npc:target", { x: 400, y: 272 });
    expect(module.snapshot({ accountId: "player-a", role: "player" }).radar.markers)
      .toContainEqual({ id: "npc:target", category: "enemy", position: { x: 400, y: 272 } });
    module.applyInput("player-a", combatInput(400, 272));

    for (let tick = 1; tick <= 30; tick += 1) {
      module.step(1 / 30, tick);
    }

    expect(context.entities.get("npc:target")).toBeUndefined();
    expect(module.snapshot({ accountId: "player-a", role: "player" }).radar.markers
      .some(marker => marker.id === "npc:target")).toBe(false);
    expect(context.entities.get("player:player-a")?.state).toMatchObject({
      kind: "player",
      points: 100,
      kills: 1
    });
    module.dispose();
  });

  it("allows only one overlapping player to claim a health pickup", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    moveEntity(context, "player:player-a", { x: 272, y: 272 });
    moveEntity(context, "player:player-b", { x: 272, y: 272 });
    setHealth(context, "player:player-a", 50);
    setHealth(context, "player:player-b", 50);
    addIdleNpc(context);
    moveEntity(context, "pickup:pickup-health", { x: 272, y: 272 });
    expect(module.snapshot({ accountId: "player-a", role: "player" }).radar.markers)
      .toContainEqual({ id: "pickup:pickup-health", category: "pickup", position: { x: 272, y: 272 } });

    module.step(0, 1);

    expect(context.entities.get("player:player-a")?.state).toMatchObject({
      kind: "player",
      health: 50 + HEALTH_PICKUP_AMOUNT
    });
    expect(context.entities.get("player:player-b")?.state).toMatchObject({
      kind: "player",
      health: 50
    });
    expect(context.entities.get("pickup:pickup-health")).toBeUndefined();
    expect(module.snapshot({ accountId: "player-a", role: "player" }).radar.markers
      .some(marker => marker.id === "pickup:pickup-health")).toBe(false);
    module.dispose();
  });

  it("refreshes timed powerups and expires them at the configured tick", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    moveEntity(context, "player:player-b", { x: 1_700, y: 272 });
    addIdleNpc(context);
    moveEntity(context, "player:player-a", { x: 1_264, y: 1_008 });
    moveEntity(context, "pickup:pickup-rapid-fire", { x: 1_264, y: 1_008 });
    module.step(0, 2);

    expect(context.entities.get("player:player-a")?.state).toMatchObject({
      kind: "player",
      effects: { rapidFireExpiresAtTick: 2 + POWERUP_DURATION_TICKS }
    });

    const refreshId = "pickup:rapid-fire-refresh";
    context.entities.add({
      id: refreshId,
      typeId: "pickup.rapid-fire",
      position: { x: 1_264, y: 1_008 },
      radius: 12,
      state: { kind: "pickup", pickupType: "rapid-fire" }
    });
    module.step(0, 100);
    expect(context.entities.get("player:player-a")?.state).toMatchObject({
      kind: "player",
      effects: { rapidFireExpiresAtTick: 100 + POWERUP_DURATION_TICKS }
    });

    module.step(0, 399);
    expect(context.entities.get("player:player-a")?.state).toHaveProperty("effects");
    module.step(0, 400);
    expect(context.entities.get("player:player-a")?.state).not.toHaveProperty("effects");
    expect(PLAYER_RAPID_FIRE_RATE_PER_SECOND).toBe(10);
    module.dispose();
  });

  it("uses rapid-fire cooldowns and creates spread projectiles from pickups", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    addIdleNpc(context);
    moveEntity(context, "player:player-b", { x: 1_700, y: 272 });
    moveEntity(context, "player:player-a", { x: 1_264, y: 1_008 });
    moveEntity(context, "pickup:pickup-rapid-fire", { x: 1_264, y: 1_008 });
    module.applyInput("player-a", combatInput(1_500, 1_008));
    module.step(0, 1);
    module.step(0, 2);
    expect(countProjectiles(context)).toBe(1);
    module.step(0, 4);
    expect(countProjectiles(context)).toBe(2);

    moveEntity(context, "player:player-a", { x: 784, y: 1_264 });
    moveEntity(context, "pickup:pickup-spread", { x: 784, y: 1_264 });
    module.step(0, 5);
    module.applyInput("player-a", combatInput(1_000, 1_264));
    module.step(0, 7);
    expect(context.entities.get("player:player-a")?.state).toMatchObject({
      kind: "player",
      effects: {
        rapidFireExpiresAtTick: 301,
        spreadExpiresAtTick: 305
      }
    });
    expect(countProjectiles(context)).toBe(5);
    expect(PLAYER_RAPID_FIRE_RATE_PER_SECOND).toBe(10);
    module.dispose();
  });

  it("rejects a spread shot that would exceed the projectile cap", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    addIdleNpc(context);
    const playerId = "player:player-a";
    context.entities.update(playerId, (entity) => {
      if (entity.state.kind !== "player") return entity;
      return { ...entity, state: { ...entity.state, effects: { spreadExpiresAtTick: 300 } } };
    });
    for (let index = 0; index < MAX_PROJECTILES_PER_SESSION - 1; index += 1) {
      addProjectile(context, `projectile:prefill-${index}`);
    }
    module.applyInput("player-a", combatInput(1_500, 272));

    module.step(1 / 30, 1);

    expect(countProjectiles(context)).toBe(MAX_PROJECTILES_PER_SESSION - 1);
    expect(simulation.metrics.get("default.projectile.rejected_cap")).toBe(1);
    module.dispose();
  });

  it("rejects maps above the pickup cap and records the rejection", () => {
    const simulation = createSimulation();
    const { context, module, metrics } = simulation;
    module.dispose();
    const base = generateMap(42).map.definition;
    const spawns = [
      ...base.spawns.filter((spawn) => spawn.kind !== "pickup"),
      ...Array.from({ length: MAX_PICKUPS_PER_SESSION + 1 }, (_, index) => ({
        id: `pickup-cap-${index}`,
        kind: "pickup" as const,
        pickupType: "health" as const,
        position: { x: 784, y: 1_008 },
        radius: 12
      }))
    ];
    const map = loadMap({ ...base, spawns });
    const simulator = new DefaultEntitySimulator(context);

    expect(() => simulator.initialize(map, [roster[0]!])).toThrow(
      "Map exceeds the supported pickup limit."
    );
    expect(metrics.get("default.pickup.rejected_cap")).toBe(1);
    simulator.dispose();
  });

  it("expires projectiles after their bounded lifetime", () => {
    const simulation = createSimulation();
    const { context, module } = simulation;
    removeNpcs(context);
    addIdleNpc(context);
    module.applyInput("player-a", combatInput(1_500, 272));
    module.step(0, 1);
    expect(countProjectiles(context)).toBe(1);
    module.applyInput("player-a", { ...combatInput(1_500, 272), fire: false });
    module.step(0, 61);
    expect(countProjectiles(context)).toBe(0);
    module.dispose();
  });

  it("transitions once after simultaneous final kills and completes the last level once", () => {
    const simulation = createSimulation([], {
      ...DEFAULT_GAME_SETTINGS,
      initialNpcsPerPlayer: 1,
      npcPopulationGrowthPercent: 0,
      baseNpcHealth: 10,
      npcHealthGrowthPercent: 100,
      npcMovementSpeed: 0,
      maxLevels: 2
    });
    const { context, module, completionRequests } = simulation;
    removeNpcs(context);
    addNpc(context, "npc:final-a", { x: 1_000, y: 272 }, 10);
    addNpc(context, "npc:final-b", { x: 1_000, y: 784 }, 10);
    module.applyInput("player-a", combatInput(1_200, 272));
    module.applyInput("player-b", combatInput(1_200, 784));

    for (let tick = 1; tick <= 35; tick += 1) {
      module.step(1 / 30, tick);
    }
    expect(context.entities.values().filter((entity) => entity.state.kind === "npc"))
      .toHaveLength(2);
    module.step(1 / 30, 36);
    expect(context.entities.values().filter((entity) => entity.state.kind === "npc"))
      .toHaveLength(0);
    for (let tick = 37; tick <= 40; tick += 1) {
      module.step(1 / 30, tick);
    }

    expect(module.snapshot({ accountId: "player-a", role: "player" })).toMatchObject({
      level: 1,
      phase: "intermission"
    });
    expect(completionRequests).toEqual([
      { kind: "level", reason: "level-1-cleared" }
    ]);

    const intermissionEndsAtTick = module.snapshot({
      accountId: "player-a",
      role: "player"
    }).intermissionEndsAtTick as number;
    expect(intermissionEndsAtTick).toBe(186);
    for (let tick = 41; tick < intermissionEndsAtTick; tick += 1) {
      module.step(1 / 30, tick);
    }
    expect(module.snapshot({ accountId: "player-a", role: "player" })).toMatchObject({
      level: 1,
      phase: "intermission"
    });
    module.step(1 / 30, intermissionEndsAtTick);
    expect(module.snapshot({ accountId: "player-a", role: "player" })).toMatchObject({
      level: 2,
      phase: "active"
    });
    const levelTwoNpcs = context.entities.values().filter((entity) => entity.state.kind === "npc");
    expect(levelTwoNpcs).toHaveLength(2);
    expect(levelTwoNpcs.every((entity) => entity.state.kind === "npc" && entity.state.health === 20))
      .toBe(true);

    removeNpcs(context);
    addNpc(context, "npc:final-c", { x: 1_000, y: 272 }, 20);
    addNpc(context, "npc:final-d", { x: 1_000, y: 784 }, 20);
    module.applyInput("player-a", combatInput(1_200, 272));
    module.applyInput("player-b", combatInput(1_200, 784));
    for (
      let tick = intermissionEndsAtTick + 1;
      tick <= intermissionEndsAtTick + 40;
      tick += 1
    ) {
      module.step(1 / 30, tick);
    }
    module.step(1 / 30, intermissionEndsAtTick + 41);

    expect(module.snapshot({ accountId: "player-a", role: "player" })).toMatchObject({
      level: 2,
      phase: "complete"
    });
    expect(completionRequests).toEqual([
      { kind: "level", reason: "level-1-cleared" },
      { kind: "match", reason: "maximum-level-cleared" }
    ]);
    expect(module.results()).toMatchObject({ status: "finished", finalLevel: 2 });
    module.dispose();
  });

  it("stops projectiles at obstacles and accounts for each death once", () => {
    const wall: Rect = { x: 300, y: 240, width: 10, height: 64 };
    const simulation = createSimulation([wall]);
    const { context, module } = simulation;
    removeNpcs(context);
    addNpc(context, "npc:behind-wall", { x: 400, y: 272 });
    module.applyInput("player-a", combatInput(400, 272));
    for (let tick = 1; tick <= 10; tick += 1) {
      module.step(1 / 30, tick);
    }
    expect(context.entities.get("npc:behind-wall")?.state).toMatchObject({
      kind: "npc",
      health: 100
    });
    expect(countProjectiles(context)).toBe(0);

    setHealth(context, "player:player-a", 0);
    module.step(0, 11);
    module.step(0, 12);
    expect(context.entities.get("player:player-a")).toBeUndefined();
    expect(module.results().standings).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: "player-a", deaths: 1 })])
    );
    module.step(0, 161);
    setHealth(context, "player:player-a", 0);
    module.step(0, 162);
    expect(module.results().standings).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: "player-a", deaths: 2 })])
    );
    module.dispose();
  });

  it("blocks shots through a solid tile in the default arena", () => {
    const arena = generateMap(42).map;
    const simulation = createSimulation(arena.obstacles);
    const { context, module } = simulation;
    removeNpcs(context);
    addNpc(context, "npc:behind-cluster", { x: 528, y: 528 });
    module.applyInput("player-a", combatInput(528, 528));
    module.step(1 / 30, 1);
    module.applyInput("player-a", { ...combatInput(528, 528), fire: false });
    for (let tick = 2; tick <= 30; tick += 1) {
      module.step(1 / 30, tick);
    }

    expect(context.entities.get("npc:behind-cluster")?.state).toMatchObject({
      kind: "npc",
      health: 100
    });
    expect(countProjectiles(context)).toBe(0);
    module.dispose();
  });
});

function createSimulation(
  obstacles: readonly Rect[] = [],
  settings: Record<string, number | string> = {}
) {
  const entities = new Map<string, DefaultEntity>();
  const metrics = new Map<string, number>();
  const completionRequests: Array<{ kind: "level" | "match"; reason: string }> = [];
  const spatialGrid = new SpatialGrid(32);
  const store: EntityStore<DefaultEntity> = {
    get: (id) => entities.get(id),
    add: (entity) => {
      if (entities.has(entity.id)) throw new TypeError(`Duplicate entity ID ${entity.id}.`);
      entities.set(entity.id, entity);
      spatialGrid.set(entity);
    },
    update: (id, update) => {
      const current = entities.get(id);
      if (!current) throw new RangeError(`Entity ${id} does not exist.`);
      const updated = update(current);
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
      requestPath: () => undefined,
      getPath: () => undefined
    },
    emit: () => {},
    requestCompletion: (request) => completionRequests.push(request),
    metrics: {
      increment: (name, amount = 1) => metrics.set(name, (metrics.get(name) ?? 0) + amount),
      gauge: () => {}
    }
  };
  const module = defaultModuleFactory.create(context, settings, roster, 42);
  module.initialize();
  return { context, module, metrics, completionRequests };
}

function combatInput(aimX: number, aimY: number): DefaultPlayerAction {
  return { type: "combat", moveX: 0, moveY: 0, aimX, aimY, fire: true };
}

function removeNpcs(context: ModuleContext<DefaultEntity>): void {
  for (const entity of context.entities.values()) {
    if (entity.state.kind === "npc") context.entities.remove(entity.id);
  }
}

function addIdleNpc(context: ModuleContext<DefaultEntity>): void {
  addNpc(context, "npc:idle", { x: 1_800, y: 1_800 }, 1_000_000);
}

function moveEntity(
  context: ModuleContext<DefaultEntity>,
  id: string,
  position: Readonly<{ x: number; y: number }>
): void {
  context.entities.update(id, (entity) => ({ ...entity, position }));
}

function setHealth(
  context: ModuleContext<DefaultEntity>,
  id: string,
  health: number
): void {
  context.entities.update(id, (entity) => {
    if (entity.state.kind !== "player") return entity;
    return { ...entity, state: { ...entity.state, health } };
  });
}

function addNpc(
  context: ModuleContext<DefaultEntity>,
  id: string,
  position: Readonly<{ x: number; y: number }>,
  health = 100
): void {
  context.entities.add({
    id,
    typeId: "npc",
    position,
    radius: 8,
    state: {
      kind: "npc",
      health,
      attackCapability: { typeId: "default.contact-attack", damage: 10, cooldownTicks: 30 }
    }
  });
}

function addProjectile(context: ModuleContext<DefaultEntity>, id: string): void {
  context.entities.add({
    id,
    typeId: "projectile.player",
    position: { x: 272, y: 272 },
    radius: 3,
    state: {
      kind: "projectile",
      ownerAccountId: "player-b",
      damage: 25,
      velocity: { x: 0, y: 0 },
      expiresAtTick: 1_000
    }
  });
}

function countProjectiles(context: ModuleContext<DefaultEntity>): number {
  return context.entities.values().filter((entity) => entity.state.kind === "projectile").length;
}
