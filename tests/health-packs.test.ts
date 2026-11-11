import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GAME_SETTINGS, GameSettingsSchema, MAX_HEALTH_PACKS_PER_WAVE
} from "@multiplayer-game/protocol";
import {
  AuthoritativeMapTransition, BoundedNavigation, SessionWorld
} from "@multiplayer-game/engine";
import {
  defaultModuleFactory, LEVEL_INTERMISSION_TICKS, loadMap, type DefaultEntity
} from "@multiplayer-game/default-theme";
import type { ModuleContext, NavigationPathResult, Point2 } from "@multiplayer-game/theme-sdk";
import { PLAYER_RADIUS } from "../themes/default/src/module/tuning.js";

type Mode = "fixed" | "simple-generated";

function setup(mode: Mode, players: number, extra: Record<string, number> = {}, seed = 42) {
  const settings = { mapMode: mode, maxLevels: 4, initialNpcsPerPlayer: 1,
    npcMovementSpeed: 0, npcDetectionRange: 0, ...extra };
  const definition = defaultModuleFactory.createInitialMap!(settings, seed)!;
  const world = new SessionWorld<DefaultEntity>("health-packs", definition.bounds,
    [...loadMap(definition).obstacles]);
  const maps = new AuthoritativeMapTransition(world, new BoundedNavigation(world.geometry), () => {});
  const metrics = { increment: vi.fn(), gauge: vi.fn() };
  const context: ModuleContext<DefaultEntity> & { defaultMapDefinition: typeof definition } = {
    defaultMapDefinition: definition, maps,
    clock: { nowMs: () => 0 },
    random: { next: () => 0.5 },
    entities: {
      get: id => world.getEntity(id),
      add: entity => world.addEntity(entity),
      update: (id, update) => world.addEntity(update(world.getEntity(id)!)),
      remove: id => world.removeEntity(id),
      values: () => world.entities(),
      queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {}, requestCompletion: () => {}, metrics
  };
  const roster = Array.from({ length: players }, (_, joinedOrder) => ({
    accountId: `p${joinedOrder}`, username: `P${joinedOrder}`, joinedOrder
  }));
  const module = defaultModuleFactory.create(context, settings, roster, seed);
  module.initialize();
  let tick = 0;
  const packs = () => world.entities().filter(entity =>
    entity.state.kind === "pickup" && entity.state.pickupType === "health");
  const setHealth = (accountId: string, health: number, position?: Point2) =>
    context.entities.update(`player:${accountId}`, player => ({
      ...player, ...(position ? { position } : {}), state: { ...player.state, health }
    }));
  const health = (accountId: string) => {
    const player = world.getEntity(`player:${accountId}`)!;
    return player.state.kind === "player" ? player.state.health : NaN;
  };
  const step = () => module.step(0, ++tick);
  const nextWave = () => {
    for (const npc of world.entities().filter(entity => entity.state.kind === "npc")) {
      world.removeEntity(npc.id);
    }
    step();
    expect(module.state.phase).toBe("intermission");
    tick += LEVEL_INTERMISSION_TICKS;
    module.step(0, tick);
    expect(module.state.phase).toBe("active");
  };
  return { world, module, metrics, packs, setHealth, health, step, nextWave, context };
}

function reachable(world: SessionWorld<DefaultEntity>, from: Point2, to: Point2): boolean {
  const navigation = new BoundedNavigation(world.geometry, {
    cellSize: 32, agentRadius: PLAYER_RADIUS, maxNodesPerSearch: 4_096
  });
  let path: NavigationPathResult | undefined;
  navigation.requestPath(from, to, result => { path = result; });
  for (let work = 0; work < 256 && !path; work += 1) navigation.processTick();
  return path?.status === "found";
}

describe("health packs per player per wave", () => {
  it("defaults to 3 and validates the developer setting", () => {
    const { healthPacksPerPlayerPerWave: _omitted, ...withoutSetting } = DEFAULT_GAME_SETTINGS;
    expect(DEFAULT_GAME_SETTINGS.healthPacksPerPlayerPerWave).toBe(3);
    expect(GameSettingsSchema.parse(withoutSetting).healthPacksPerPlayerPerWave).toBe(3);
    for (const value of [0, 10]) {
      expect(GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS,
        healthPacksPerPlayerPerWave: value }).success).toBe(true);
    }
    for (const value of [-1, 11, 1.5, "3", Number.NaN]) {
      expect(GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS,
        healthPacksPerPlayerPerWave: value }).success).toBe(false);
      expect(defaultModuleFactory.validateSettings({ healthPacksPerPlayerPerWave: value })).toBe(false);
    }
    expect(MAX_HEALTH_PACKS_PER_WAVE).toBe(96);
    expect(GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS, maxPlayers: 32 }).success).toBe(true);
    const overCap = GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS,
      maxPlayers: 32, healthPacksPerPlayerPerWave: 4 });
    expect(overCap.success).toBe(false);
    expect(overCap.error!.issues).toContainEqual(expect.objectContaining({
      path: ["healthPacksPerPlayerPerWave"],
      message: "Health packs per player per wave multiplied by max players must not exceed 96."
    }));
    expect(() => defaultModuleFactory.create({} as never, { healthPacksPerPlayerPerWave: 11 }, [], 1))
      .toThrow("valid playerMaxHealth (integer 1-100000) and healthPacksPerPlayerPerWave (integer 0-10)");
  });

  it.each([
    ["fixed", 1, 3], ["fixed", 2, 6], ["simple-generated", 1, 3], ["simple-generated", 2, 6]
  ] as const)("scatters reachable, terrain-clear packs on %s for %i player(s): %i", (mode, players, total) => {
    const simulation = setup(mode, players);
    const repeat = setup(mode, players);
    try {
      const packs = simulation.packs();
      expect(packs).toHaveLength(total);
      expect(packs.map(pack => pack.position)).toEqual(repeat.packs().map(pack => pack.position));
      const spawn = simulation.world.getEntity("player:p0")!.position;
      for (const pack of packs) {
        expect(pack.typeId).toBe("pickup.health");
        expect(pack.radius).toBe(12);
        expect(simulation.world.geometry.isCircleWalkable(pack.position, PLAYER_RADIUS)).toBe(true);
        expect(simulation.world.geometry.intersectsObstacle(pack.position, PLAYER_RADIUS)).toBe(false);
        expect(reachable(simulation.world, spawn, pack.position)).toBe(true);
        for (const other of packs.filter(item => item !== pack)) {
          expect(Math.hypot(other.position.x - pack.position.x, other.position.y - pack.position.y))
            .toBeGreaterThanOrEqual(32);
        }
      }
      const quadrants = new Set(packs.map(pack =>
        `${pack.position.x >= 1024 ? 1 : 0},${pack.position.y >= 1024 ? 1 : 0}`));
      expect(quadrants.size).toBeGreaterThanOrEqual(Math.min(total, 3));
      expect(simulation.metrics.increment).not.toHaveBeenCalledWith("default.health_pack.insufficient_space");
      console.info(JSON.stringify({ mode, players, packs: packs.map(pack => ({
        id: pack.id, position: pack.position })) }));
    } finally { simulation.module.dispose(); repeat.module.dispose(); }
  });

  it.each(["fixed", "simple-generated"] as const)(
    "replenishes only consumed packs at wave start without accumulating on %s", mode => {
      const simulation = setup(mode, 2);
      try {
        const initial = simulation.packs();
        expect(initial).toHaveLength(6);
        // p0 consumes two packs; the other four stay on the map through the wave.
        for (const pack of initial.slice(0, 2)) {
          simulation.setHealth("p0", 100, pack.position);
          simulation.step();
          expect(simulation.world.getEntity(pack.id)).toBeUndefined();
        }
        const retained = simulation.packs();
        expect(retained.map(pack => pack.id)).toEqual(initial.slice(2).map(pack => pack.id));
        simulation.nextWave();
        const refilled = simulation.packs();
        expect(refilled).toHaveLength(6);
        expect(new Set(refilled.map(pack => pack.id)).size).toBe(6);
        expect(refilled.map(pack => pack.id).sort()).toEqual(initial.map(pack => pack.id).sort());
        if (mode === "fixed") {
          for (const pack of retained) {
            expect(simulation.world.getEntity(pack.id)!.position).toEqual(pack.position);
          }
        }
        // Nothing consumed: the next wave keeps exactly six, not twelve.
        const before = simulation.packs().map(pack => [pack.id, pack.position]);
        simulation.nextWave();
        expect(simulation.packs()).toHaveLength(6);
        if (mode === "fixed") {
          expect(simulation.packs().map(pack => [pack.id, pack.position])).toEqual(before);
        }
      } finally { simulation.module.dispose(); }
    }
  );

  it("heals 25 up to max health and leaves packs for full-health players", () => {
    const simulation = setup("fixed", 1, { playerMaxHealth: 200 });
    try {
      const [first, second, third] = simulation.packs();
      simulation.setHealth("p0", 200, first!.position);
      simulation.step();
      expect(simulation.health("p0")).toBe(200);
      expect(simulation.world.getEntity(first!.id)).toBeDefined();
      simulation.setHealth("p0", 190, second!.position);
      simulation.step();
      expect(simulation.health("p0")).toBe(200);
      expect(simulation.world.getEntity(second!.id)).toBeUndefined();
      simulation.setHealth("p0", 100, third!.position);
      simulation.step();
      expect(simulation.health("p0")).toBe(125);
      expect(simulation.world.getEntity(third!.id)).toBeUndefined();
      expect(simulation.packs().map(pack => pack.id)).toEqual([first!.id]);
    } finally { simulation.module.dispose(); }
  });

  it("honours custom counts, including zero, without removing power-ups", () => {
    const none = setup("fixed", 2, { healthPacksPerPlayerPerWave: 0 });
    const five = setup("fixed", 1, { healthPacksPerPlayerPerWave: 5 });
    try {
      expect(none.packs()).toEqual([]);
      none.nextWave();
      expect(none.packs()).toEqual([]);
      expect(none.world.entities().filter(entity => entity.state.kind === "pickup")).toHaveLength(2);
      expect(five.packs()).toHaveLength(5);
      five.nextWave();
      expect(five.packs()).toHaveLength(5);
    } finally { none.module.dispose(); five.module.dispose(); }
  });
});
