import { describe, expect, it } from "vitest";
import {
  BoundedNavigation,
  SeededRandom,
  SessionWorld
} from "@multiplayer-game/engine";
import type { ModuleContext, NavigationPathResult, RosterMember } from "@multiplayer-game/theme-sdk";
import {
  DefaultRespawnSimulator,
  generateMap,
  type DefaultEntity
} from "@multiplayer-game/default-theme";
import { PLAYER_RADIUS, SAFE_SPAWN_MARGIN } from "../themes/default/src/module/tuning.js";

describe("Fixed arena seeded spawn fallback", () => {
  it("finds a safe, reachable fallback for slot 19 with seed 42", () => {
    console.log(JSON.stringify({
      progress: "slot-19-fallback", status: "starting", seed: 42, slot: 19
    }));
    const first = simulateSlot19Fallback();

    console.log(JSON.stringify({
      progress: "slot-19-fallback-repeat", status: "starting", seed: 42, slot: 19
    }));
    const repeated = simulateSlot19Fallback();

    expect(repeated.position).toEqual(first.position);
    expect(first.position).not.toEqual(first.authoredSpawn);
    expect(first.clearance).toBe(true);
    expect(first.path?.status).toBe("found");
    for (const point of first.path!.path) {
      expect(first.walkable(point)).toBe(true);
    }
    console.log(JSON.stringify({
      progress: "slot-19-fallback", status: "complete", seed: 42, slot: 19,
      authoredSpawn: first.authoredSpawn, fallback: first.position,
      clearance: first.clearance, reachable: first.path?.status === "found",
      pathPoints: first.path?.path.length
    }));
  });
});

function simulateSlot19Fallback() {
  const map = generateMap(42, "fixed").map;
  const playerSpawns = map.definition.spawns.filter(spawn => spawn.kind === "player");
  const roster: RosterMember[] = Array.from({ length: 20 }, (_, joinedOrder) => ({
    accountId: `slot-${joinedOrder}`,
    username: `Slot ${joinedOrder}`,
    joinedOrder
  }));
  const world = new SessionWorld<DefaultEntity>(
    "fixed-slot-19-fallback",
    map.definition.bounds,
    [...map.obstacles]
  );
  for (const [index, member] of roster.entries()) {
    world.addEntity({
      id: `player:${member.accountId}`,
      typeId: "player",
      position: playerSpawns[index]!.position,
      radius: PLAYER_RADIUS,
      state: {
        kind: "player",
        accountId: member.accountId,
        health: 100,
        points: 0,
        kills: 0,
        deaths: 0,
        color: "#5aa9e6",
        facing: { x: 1, y: 0 }
      }
    });
  }
  const authoredSpawn = playerSpawns[19]!.position;
  world.addEntity({
    id: "npc:slot-19-spawn-blocker",
    typeId: "npc",
    position: authoredSpawn,
    radius: 8,
    state: {
      kind: "npc",
      health: 100,
      attackCapability: { typeId: "default.contact-attack", damage: 10, cooldownTicks: 30 }
    }
  });
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: new SeededRandom(42),
    entities: {
      get: id => world.getEntity(id),
      add: entity => world.addEntity(entity),
      update: (id, update) => {
        const entity = world.getEntity(id);
        if (!entity) throw new RangeError(`Entity ${id} is missing.`);
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
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {},
    requestCompletion: () => {},
    metrics: { gauge: () => {}, increment: () => {} }
  };
  const simulator = new DefaultRespawnSimulator(context, map, roster, 5, () => {});
  simulator.initialize();
  const playerId = "player:slot-19";
  const player = world.getEntity(playerId);
  if (!player || player.state.kind !== "player") throw new Error("Slot 19 player was not initialized.");
  world.addEntity({ ...player, state: { ...player.state, health: 0 } });
  simulator.removeDefeated(1);
  simulator.respawnEligible(151);

  const returned = world.getEntity(playerId);
  if (!returned || returned.state.kind !== "player") throw new Error("Slot 19 did not respawn.");
  const clearance = PLAYER_RADIUS + SAFE_SPAWN_MARGIN;
  const nearby = world.queryEntities(returned.position, clearance + PLAYER_RADIUS, 64);
  const isClear = map.isWalkable(returned.position, clearance) &&
    world.geometry.isCircleWalkable(returned.position, clearance) &&
    nearby.filter(entity => entity.id !== returned.id).every(entity => Math.hypot(
      returned.position.x - entity.position.x,
      returned.position.y - entity.position.y
    ) > clearance + entity.radius);
  const navigation = new BoundedNavigation(world.geometry, {
    cellSize: map.definition.cellSize,
    agentRadius: PLAYER_RADIUS,
    maxNodesPerSearch: 4_096
  });
  let path: NavigationPathResult | undefined;
  navigation.requestPath(authoredSpawn, returned.position, result => { path = result; });
  for (let work = 0; work < 128 && !path; work += 1) navigation.processTick();

  simulator.dispose();
  return {
    authoredSpawn,
    position: returned.position,
    clearance: isClear,
    path,
    walkable: (point: Readonly<{ x: number; y: number }>) =>
      world.geometry.isCircleWalkable(point, PLAYER_RADIUS)
  };
}
