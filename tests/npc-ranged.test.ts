import { describe, expect, it, vi } from "vitest";
import { SeededRandom, SessionWorld } from "@multiplayer-game/engine";
import type { ModuleContext, Point2 } from "@multiplayer-game/theme-sdk";
import type { DefaultEntity } from "@multiplayer-game/default-theme";
import { DefaultEntitySimulator } from "../themes/default/src/module/entities.js";
import { DefaultCombatSimulator } from "../themes/default/src/module/combat.js";
import { generateMap } from "../themes/default/src/module/maps.js";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import { NPC_FIRE_COOLDOWN_TICKS, NPC_SHOT_DAMAGE } from "../themes/default/src/module/tuning.js";

function fixture(speed = 67.5, detection = 512, walls: {
  x: number; y: number; width: number; height: number;
}[] = [], playerMaxHealth = DEFAULT_GAME_SETTINGS.playerMaxHealth) {
  const world = new SessionWorld<DefaultEntity>("ranged", { width: 2048, height: 2048 }, walls);
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 }, random: new SeededRandom(42),
    entities: {
      get: id => world.getEntity(id), add: entity => world.addEntity(entity),
      update: (id, update) => {
        const entity = world.getEntity(id);
        if (!entity) throw new Error(`Missing ${id}`);
        world.addEntity(update(entity));
      },
      remove: id => world.removeEntity(id), values: () => world.entities(),
      queryRadius: (point, radius, maxCells) => world.queryEntities(point, radius, maxCells)
    },
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (point, delta, radius) => world.geometry.moveCircle(point, delta, radius)
    },
    navigation: { requestPath: vi.fn(() => undefined), getPath: () => undefined },
    emit: () => {}, requestCompletion: () => {},
    metrics: { increment: vi.fn(), gauge: vi.fn() }
  };
  const simulator = new DefaultEntitySimulator(context, speed, detection, 42, playerMaxHealth);
  simulator.initialize(generateMap(42, "fixed").map,
    [{ accountId: "p", username: "Player", joinedOrder: 0 }], 1, 50);
  const npc = world.entities().find(entity => entity.state.kind === "npc")!;
  const place = (id: string, position: Point2) =>
    context.entities.update(id, entity => ({ ...entity, position }));
  place(npc.id, { x: 512, y: 512 });
  place("player:p", { x: 100, y: 100 });
  const combat = new DefaultCombatSimulator(context);
  return { world, context, simulator, combat, npc, place };
}

describe("NPC ranged playtest", () => {
  it.each([
    { maximum: 100, survived: 9, lethal: 10 },
    { maximum: 150, survived: 14, lethal: 15 },
    { maximum: 37, survived: 3, lethal: 4 }
  ])("measures ordinary enemy hits at $maximum HP", ({ maximum, survived, lethal }) => {
    const s = fixture(0, 512, [], maximum);
    s.place("player:p", { x: 762, y: 512 });
    expect(s.world.getEntity("player:p")!.state.health).toBe(maximum);
    expect(NPC_SHOT_DAMAGE).toBe(10);
    expect(NPC_FIRE_COOLDOWN_TICKS).toBe(30);
    expect(DEFAULT_GAME_SETTINGS.playerMaxHealth).toBe(Math.ceil(100 * 1.5));
    expect(DEFAULT_GAME_SETTINGS.initialNpcsPerPlayer).toBe(5);
    const trace = [maximum];
    const shotTicks: number[] = [];
    for (let tick = 1; tick <= lethal * 30; tick++) {
      s.simulator.step(1 / 30, tick);
      s.combat.step(tick);
      const newShots = s.world.entities().filter(e => e.typeId === "projectile.npc" &&
        e.state.expiresAtTick === tick + 60);
      if (newShots.length) {
        expect(newShots).toHaveLength(1);
        expect(newShots[0]!.state.damage).toBe(10);
        shotTicks.push(tick);
      }
      const health = s.world.getEntity("player:p")!.state.health;
      if (typeof health !== "number") throw new Error("Missing player health.");
      if (health !== trace.at(-1)) trace.push(health);
      if (health === 0) break;
    }
    expect(trace).toEqual(Array.from({ length: lethal + 1 },
      (_, hit) => Math.max(0, maximum - hit * 10)));
    expect(trace.slice(1).filter(health => health > 0)).toHaveLength(survived);
    expect(shotTicks).toHaveLength(lethal);
    expect(shotTicks.slice(1).every((tick, index) => tick - shotTicks[index]! === 30)).toBe(true);
    console.info(JSON.stringify({ maximum, trace, survived, lethal, shotTicks }));
  });

  it("measures the restored default Explore pace over one clear-route second", () => {
    const s = fixture(67.5, 0);
    let travel = 0;
    for (let tick = 1; tick <= 30; tick++) {
      const before = s.world.getEntity(s.npc.id)!.position;
      s.simulator.step(1 / 30, tick);
      const after = s.world.getEntity(s.npc.id)!.position;
      travel += Math.hypot(after.x - before.x, after.y - before.y);
    }
    console.log(JSON.stringify({ clearRouteSeconds: 1, exploreTravel: travel }));
    expect(travel).toBeCloseTo(33.75, 6);
  });

  it("measures approach separately, then stops outside overlap and fires without passing the player", () => {
    const s = fixture();
    s.place("player:p", { x: 1012, y: 512 });
    let travel = 0;
    for (let tick = 1; tick <= 30; tick++) {
      const before = s.world.getEntity(s.npc.id)!.position;
      s.simulator.step(1 / 30, tick);
      const after = s.world.getEntity(s.npc.id)!.position;
      travel += Math.hypot(after.x - before.x, after.y - before.y);
    }
    console.log(JSON.stringify({ clearRouteSeconds: 1, approachTravel: travel }));
    expect(travel).toBeCloseTo(67.5, 6);
    let stoppedAt: Point2 | undefined;
    let shots = 0;
    for (let tick = 31; tick <= 120; tick++) {
      const before = s.world.getEntity(s.npc.id)!.position;
      s.simulator.step(1 / 30, tick);
      const npc = s.world.getEntity(s.npc.id)!;
      const range = Math.hypot(npc.position.x - 1012, npc.position.y - 512);
      expect(range).toBeGreaterThan(npc.radius + 14);
      expect(npc.position.x).toBeLessThan(1012);
      if (npc.state.readyToFire) {
        stoppedAt ??= npc.position;
        expect(npc.position).toEqual(stoppedAt);
        expect(npc.position).toEqual(before);
      }
      s.combat.step(tick);
      shots += s.world.entities().filter(e => e.typeId === "projectile.npc" &&
        e.state.expiresAtTick === tick + 60).length;
    }
    expect(stoppedAt).toEqual({ x: 629, y: 512 });
    expect(shots).toBe(3);
  });

  it.each([0, 67.5])("stops, rotates, tracks and fires on cooldown at speed %s", speed => {
    const s = fixture(speed);
    s.place("player:p", { x: 512, y: 762 });
    const start = s.world.getEntity(s.npc.id)!.position;
    for (let tick = 1; tick <= 5; tick++) {
      s.simulator.step(1 / 30, tick);
      s.combat.step(tick);
      expect(s.world.getEntity(s.npc.id)!.position).toEqual(start);
      if (tick < 5) expect(s.world.entities().some(e => e.typeId === "projectile.npc")).toBe(false);
    }
    const shot = s.world.entities().find(e => e.typeId === "projectile.npc")!;
    expect(shot.state).toMatchObject({ velocity: { x: expect.closeTo(0, 6), y: 300 } });
    const npc = s.world.getEntity(s.npc.id)!;
    expect(npc.state).toMatchObject({ facing: { x: expect.closeTo(0, 6), y: 1 } });
    for (let tick = 6; tick < 35; tick++) {
      s.simulator.step(1 / 30, tick);
      s.combat.step(tick);
    }
    expect(s.world.entities().filter(e => e.typeId === "projectile.npc")).toHaveLength(0);
    expect(s.world.getEntity("player:p")!.state.health).toBe(140);
    s.simulator.step(1 / 30, 35);
    s.combat.step(35);
    expect(s.world.entities().filter(e => e.typeId === "projectile.npc")).toHaveLength(1);
    s.place("player:p", { x: 762, y: 512 });
    s.simulator.step(1 / 30, 36);
    expect(s.world.getEntity(s.npc.id)!.position).toEqual(start);
    expect(s.world.getEntity(s.npc.id)!.state.facing).not.toEqual(npc.state.facing);
  });

  it.each([0, 67.5])("contact never damages at speed %s; crowded mobile NPCs retreat", speed => {
    const s = fixture(speed);
    s.place("player:p", { x: 520, y: 512 });
    for (let tick = 1; tick <= 15; tick++) {
      s.simulator.step(1 / 30, tick);
      s.combat.step(tick);
    }
    expect(s.world.getEntity("player:p")!.state.health).toBe(150);
    const position = s.world.getEntity(s.npc.id)!.position;
    expect(position.x).toBe(speed === 0 ? 512 : 478.25);
    expect(position.y).toBe(512);
    expect(s.world.entities().some(e => e.typeId === "projectile.npc")).toBe(false);
  });

  it("repositions rather than shooting through terrain, including thin walls", () => {
    const s = fixture(67.5, 512, [{ x: 600, y: 400, width: 1, height: 224 }]);
    s.place("player:p", { x: 712, y: 512 });
    s.simulator.step(1 / 30, 1);
    s.combat.step(1);
    expect(s.context.navigation.requestPath).toHaveBeenCalled();
    expect(s.world.getEntity(s.npc.id)!.position).not.toEqual({ x: 512, y: 512 });
    expect(s.world.entities().some(e => e.typeId === "projectile.npc")).toBe(false);
  });

  it("backs out of exact player overlap and separates coincident NPCs", () => {
    const s = fixture();
    s.place("player:p", { x: 512, y: 512 });
    s.simulator.step(1 / 30, 1);
    expect(s.world.getEntity(s.npc.id)!.position).toEqual({ x: 509.75, y: 512 });
    s.place("player:p", { x: 712, y: 512 });
    s.place(s.npc.id, { x: 512, y: 512 });
    s.world.addEntity({ ...s.npc, id: "coincident", position: { x: 512, y: 512 } });
    s.simulator.step(1 / 30, 2);
    expect(s.world.getEntity(s.npc.id)!.position).not.toEqual(
      s.world.getEntity("coincident")!.position
    );
    expect(s.world.getEntity("player:p")!.state.health).toBe(150);
  });

  it("repositions around a close target behind terrain instead of retreating forever", () => {
    const s = fixture(67.5, 512, [{ x: 550, y: 450, width: 1, height: 124 }]);
    s.place("player:p", { x: 600, y: 512 });
    s.simulator.step(1 / 30, 1);
    expect(s.world.getEntity(s.npc.id)!.position.x).toBe(514.25);
    expect(s.world.getEntity(s.npc.id)!.state.readyToFire).toBe(false);
    expect(s.context.navigation.requestPath).toHaveBeenCalled();
  });

  it("walls intercept NPC projectiles already in flight; no NPC friendly fire or kill credit", () => {
    const s = fixture(0, 512, [{ x: 600, y: 400, width: 1, height: 224 }]);
    s.world.addEntity({
      id: "test-shot", typeId: "projectile.npc", radius: 6 / Math.SQRT2,
      position: { x: 580, y: 512 },
      state: { kind: "projectile", ownerAccountId: "", ownerNpcId: s.npc.id,
        damage: 10, velocity: { x: 300, y: 0 }, expiresAtTick: 60 }
    });

    s.place("player:p", { x: 620, y: 512 });
    for (let tick = 1; tick <= 10; tick++) s.combat.step(tick);
    expect(s.world.getEntity("test-shot")).toBeUndefined();
    expect(s.world.getEntity("player:p")!.state).toMatchObject({ health: 150, points: 0, kills: 0 });
    expect(s.world.getEntity(s.npc.id)!.state.health).toBe(50);
  });

  it("NPC shots pass other NPCs, damage players and never award a player kill", () => {
    const s = fixture(0, 0);
    s.world.addEntity({ ...s.npc, id: "bystander", position: { x: 560, y: 512 } });
    s.place("player:p", { x: 620, y: 512 });
    s.world.addEntity({
      id: "npc-shot", typeId: "projectile.npc", radius: 6 / Math.SQRT2,
      position: { x: 540, y: 512 },
      state: { kind: "projectile", ownerAccountId: "", ownerNpcId: s.npc.id,
        damage: 10, velocity: { x: 300, y: 0 }, expiresAtTick: 60 }
    });
    for (let tick = 1; tick <= 10; tick++) s.combat.step(tick);
    expect(s.world.getEntity("bystander")!.state.health).toBe(50);
    expect(s.world.getEntity("player:p")!.state).toMatchObject({ health: 140, points: 0, kills: 0 });
  });

  it("shares the session projectile ceiling and reports a rejected NPC shot", () => {
    const s = fixture(0);
    s.place("player:p", { x: 712, y: 512 });
    for (let i = 0; i < 1000; i++) s.world.addEntity({
      id: `filler:${i}`, typeId: "projectile.player", radius: 3, position: { x: 50, y: 50 },
      state: { kind: "projectile", ownerAccountId: "p", damage: 25,
        velocity: { x: 0, y: 0 }, expiresAtTick: 60 }
    });
    s.simulator.step(1 / 30, 1);
    s.combat.step(1);
    expect(s.world.entities().filter(e => e.state.kind === "projectile")).toHaveLength(1000);
    expect(s.context.metrics.increment).toHaveBeenCalledWith("default.projectile.rejected_cap");
  });

  it("limits four eligible NPCs to two sticky slots while denied NPCs explore", () => {
    const s = fixture();
    s.place("player:p", { x: 700, y: 700 });
    s.place(s.npc.id, { x: 500, y: 700 });
    for (const [index, y] of [600, 800, 900].entries()) {
      s.world.addEntity({ ...s.npc, id: `extra:${index}`, position: { x: 500, y } });
    }
    s.simulator.step(1 / 30, 1);
    const npcs = () => s.world.entities().filter(e => e.state.kind === "npc");
    const engaged = () => npcs().filter(e => e.state.targetId === "player:p");
    expect(engaged()).toHaveLength(2);
    const slots = engaged().map(e => e.id);
    const denied = npcs().filter(e => !slots.includes(e.id));
    for (const npc of denied) {
      expect(npc.position).not.toEqual({ x: 500, y: npc.id === "extra:1" ? 800 : 900 });
      expect(npc.state.readyToFire).toBe(false);
    }
    for (let tick = 2; tick < 31; tick++) {
      s.simulator.step(1 / 30, tick);
      s.combat.step(tick);
      expect(engaged().map(e => e.id)).toEqual(slots);
      expect(s.world.entities().filter(e => e.typeId === "projectile.npc")
        .every(e => slots.includes(String(e.state.ownerNpcId)))).toBe(true);
    }
    s.world.removeEntity(slots[0]!);
    s.simulator.step(1 / 30, 31);
    expect(engaged()).toHaveLength(2);
    s.place("player:p", { x: 1900, y: 1900 });
    s.simulator.step(1 / 30, 32);
    expect(engaged()).toHaveLength(0);
  });

  it("biases wider awareness goals near interior action with distributed destinations", () => {
    const s = fixture();
    s.place("player:p", { x: 800, y: 800 });
    s.place(s.npc.id, { x: 1500, y: 800 });
    for (let i = 0; i < 5; i++) {
      s.world.addEntity({ ...s.npc, id: `aware:${i}`, position: { x: 1500, y: 500 + i * 120 } });
    }
    s.simulator.step(1 / 30, 1);
    const calls = vi.mocked(s.context.navigation.requestPath).mock.calls;
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map(([, goal]) => `${goal.x},${goal.y}`)).size).toBeGreaterThanOrEqual(4);
    for (const [, goal] of calls) {
      expect(Math.hypot(goal.x - 800, goal.y - 800)).toBeLessThan(550);
      expect(Math.min(goal.x, goal.y, 2048 - goal.x, 2048 - goal.y)).toBeGreaterThanOrEqual(512);
    }
    expect(s.world.entities().filter(e => e.state.kind === "npc")
      .every(e => !e.state.targetId)).toBe(true);
  });

  it("preserves wall collision at the restored Explore speed", () => {
    const s = fixture(67.5, 0, [{ x: 550, y: 0, width: 1, height: 2048 }]);
    for (let tick = 1; tick <= 120; tick++) {
      s.simulator.step(1 / 30, tick);
      const npc = s.world.getEntity(s.npc.id)!;
      expect(npc.position.x).toBeLessThanOrEqual(542);
      expect(s.world.geometry.isCircleWalkable(npc.position, npc.radius)).toBe(true);
    }
  });
});
