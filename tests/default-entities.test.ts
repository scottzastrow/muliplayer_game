import { describe, expect, it, vi } from "vitest";
import { DefaultEntitySimulator } from "../themes/default/src/module/entities.js";
import { NPC_COLOR, PLAYER_COLORS } from "../themes/default/src/colors.js";
import type { LoadedMap } from "../themes/default/src/module/maps.js";
import type { GameSettings } from "@multiplayer-game/protocol";
import {
  BoundedNavigation,
  SeededRandom,
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
  generateMap,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  MAX_PENDING_NPC_PATHS,
  NPC_CONTACT_COOLDOWN_TICKS,
  NPC_EXPLORE_MAP_DISTANCE_FACTOR,
  NPC_EXPLORE_PAUSE_TICKS,
  NPC_EXPLORE_SPEED_FACTOR,
  NPC_REPATH_INTERVAL_TICKS,
  PLAYER_SPEED,
  PLAYER_FACING_MOVEMENT_BLEND,
  PLAYER_SHOT_SPEED,
  type DefaultEntity,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";

const roster: readonly RosterMember[] = [
  { accountId: "player-a", username: "Alice", joinedOrder: 0 }
];

describe("default entity movement and pursuit", () => {
  it("exports the Dots and Squares facing-movement blend within its documented range", () => {
    expect(PLAYER_FACING_MOVEMENT_BLEND).toBe(0.30);
    expect(PLAYER_FACING_MOVEMENT_BLEND).toBeGreaterThanOrEqual(0);
    expect(PLAYER_FACING_MOVEMENT_BLEND).toBeLessThanOrEqual(1);
  });

  it("allocates distinct reserved-safe authoritative colors across the full frozen roster", () => {
    const s = createSimulation([], { npcMovementSpeed: 0, initialNpcsPerPlayer: 1 });
    s.module.dispose();
    const simulator = new DefaultEntitySimulator(s.context, 0, 0, 42);
    const members = Array.from({ length: 32 }, (_, index) => ({
      accountId: `p${index}`, username: `Player${index}`, joinedOrder: index
    }));
    try {
      simulator.initialize(generateMap(42, "fixed").map, members, 1);
      const colors = members.map(member =>
        s.context.entities.get(`player:${member.accountId}`)!.state.color);
      expect(colors).toEqual(PLAYER_COLORS);
      expect(new Set(colors).size).toBe(32);
      expect(colors).not.toContain(NPC_COLOR);
      simulator.startLevel(2, 1, 50);
      expect(members.map(member =>
        s.context.entities.get(`player:${member.accountId}`)!.state.color)).toEqual(colors);
    } finally { simulator.dispose(); }
  });

  it("routes an ordinarily spawned edge NPC into Fixed interior regions within 30 seconds", () => {
    const simulation = createSimulation([], { npcDetectionRange: 0 }, 42);
    const bounds = { width: 2_048, height: 2_048 };
    const edgeDistance = (position: Point2) => Math.min(
      position.x, position.y, bounds.width - position.x, bounds.height - position.y
    );
    const npc = simulation.context.entities.values().find(entity =>
      entity.state.kind === "npc" && edgeDistance(entity.position) < bounds.width * 0.1);
    expect(npc, "the wave includes an ordinary outer-band spawn").toBeDefined();
    const id = npc!.id;
    let enteredInterior = false;
    let travelled = 0;
    try {
      for (let tick = 1; tick <= 900; tick += 1) {
        const previous = simulation.context.entities.get(id)!.position;
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        const position = simulation.context.entities.get(id)!.position;
        expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
        travelled += Math.hypot(position.x - previous.x, position.y - previous.y);
        if (edgeDistance(position) >= bounds.width * 0.25) enteredInterior = true;
      }
      expect(enteredInterior).toBe(true);
      expect(travelled).toBeGreaterThan(500);
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(0);
      expect(simulation.navigation.outstandingRequests).toBeLessThanOrEqual(MAX_PENDING_NPC_PATHS);
    } finally { simulation.module.dispose(); }
  });

  it.each(["fixed", "small"] as const)(
    "completes successive map-scaled Explore routes into new areas (%s)", mode => {
      const bounds = mode === "fixed"
        ? { width: 2048, height: 2048 } : { width: 768, height: 512 };
      const fixed = generateMap(42, "fixed").map;
      const map: LoadedMap = mode === "fixed" ? fixed : {
        ...fixed,
        definition: { ...fixed.definition, bounds,
          spawns: [{ id: "player", kind: "player", position: { x: 80, y: 80 }, radius: 14 }] },
        obstacles: [],
        isWalkable: (point, radius) => point.x >= radius && point.y >= radius &&
          point.x <= bounds.width - radius && point.y <= bounds.height - radius
      };
      const s = createSimulation(map.obstacles, { npcDetectionRange: 0 }, 42, bounds);
      s.module.dispose();
      const simulator = new DefaultEntitySimulator(s.context, 67.5, 0, 42);
      simulator.initialize(map, roster, 1);
      const npc = s.context.entities.values().find(entity => entity.state.kind === "npc")!;
      const targetDistance = Math.min(bounds.width, bounds.height) / 2;
      const routes: { goal: Point2; direct: number; path: number; travel: number }[] = [];
      const pending = new Map<string, { goal: Point2; direct: number; path: number; travel: number }>();
      const request = s.context.navigation.requestPath;
      const get = s.context.navigation.getPath;
      let active: typeof routes[number] | undefined;
      vi.spyOn(s.context.navigation, "requestPath").mockImplementation((from, goal) => {
        const id = request(from, goal);
        if (id) {
          active = { goal, direct: Math.hypot(goal.x - from.x, goal.y - from.y), path: 0, travel: 0 };
          pending.set(id, active);
        }
        return id;
      });
      vi.spyOn(s.context.navigation, "getPath").mockImplementation(id => {
        const result = get(id);
        if (result?.status === "found") {
          const route = pending.get(id)!;
          route.path = result.path.reduce((sum, point, index) => {
            const previous = result.path[index - 1];
            return sum + (previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0);
          }, 0);
        }
        return result;
      });
      const regions = new Set<string>();
      const regionSize = Math.min(256, Math.min(bounds.width, bounds.height) / 8);
      try {
        for (let tick = 1; tick <= 6500 && routes.length < 3; tick++) {
          const previous = s.context.entities.get(npc.id)!.position;
          const requests = s.navigation.requestsSubmitted;
          s.navigation.processTick();
          simulator.step(1 / 30, tick);
          const position = s.context.entities.get(npc.id)!.position;
          const travel = Math.hypot(position.x - previous.x, position.y - previous.y);
          expect(travel).toBeLessThanOrEqual(67.5 * NPC_EXPLORE_SPEED_FACTOR / 30 + 1e-8);
          expect(s.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
          expect(s.navigation.requestsSubmitted - requests).toBeLessThanOrEqual(8);
          expect(s.navigation.outstandingRequests).toBeLessThanOrEqual(MAX_PENDING_NPC_PATHS);
          expect(s.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2048);
          regions.add(`${Math.floor(position.x / regionSize)},${Math.floor(position.y / regionSize)}`);
          if (active) {
            active.travel += travel;
            if (Math.hypot(position.x - active.goal.x, position.y - active.goal.y) < 1e-6) {
              routes.push(active);
              active = undefined;
            }
          }
        }
        console.log(JSON.stringify({ map: mode, targetDistance, routes, visitedRegions: regions.size }));
        expect(routes).toHaveLength(3);
        for (const route of routes) {
          expect(route.direct).toBeGreaterThanOrEqual(targetDistance * 0.75);
          expect(route.direct).toBeLessThanOrEqual(targetDistance * 1.15 + 32);
          expect(route.path).toBeGreaterThanOrEqual(route.direct - 32);
          expect(route.travel).toBeGreaterThanOrEqual(route.direct - 1e-6);
        }
        expect(new Set(routes.map(route =>
          `${Math.floor(route.goal.x / regionSize)},${Math.floor(route.goal.y / regionSize)}`)).size).toBe(3);
        expect(regions.size).toBeGreaterThanOrEqual(8);
      } finally { simulator.dispose(); }
    }
  );

  it("falls back to closer reachable legs in an enclosed area, then retries the full target", () => {
    const walls = [
      { x: 320, y: 0, width: 32, height: 352 },
      { x: 0, y: 320, width: 352, height: 32 }
    ];
    const s = createSimulation(walls, { npcDetectionRange: 0, initialNpcsPerPlayer: 1 });
    const id = "npc:npc-northwest";
    s.context.entities.update(id, npc => ({ ...npc, position: { x: 144, y: 144 } }));
    const request = s.context.navigation.requestPath;
    const get = s.context.navigation.getPath;
    const requests: { goal: Point2; direct: number; status?: string; path?: number }[] = [];
    const pending = new Map<string, typeof requests[number]>();
    let active: typeof requests[number] | undefined;
    const completed: { direct: number; path: number; goal: Point2 }[] = [];
    vi.spyOn(s.context.navigation, "requestPath").mockImplementation((from, goal) => {
      const requestId = request(from, goal);
      if (requestId) {
        active = { goal, direct: Math.hypot(goal.x - from.x, goal.y - from.y) };
        requests.push(active);
        pending.set(requestId, active);
      }
      return requestId;
    });
    vi.spyOn(s.context.navigation, "getPath").mockImplementation(requestId => {
      const result = get(requestId);
      if (result) {
        const row = pending.get(requestId)!;
        row.status = result.status;
        if (result.status === "found") {
          row.path = result.path.reduce((sum, point, index) => {
            const previous = result.path[index - 1];
            return sum + (previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0);
          }, 0);
        }
      }
      return result;
    });
    try {
      for (let tick = 1; tick <= 3000 && completed.length < 2; tick++) {
        const before = requests.length;
        s.navigation.processTick();
        s.module.step(1 / 30, tick);
        const position = s.context.entities.get(id)!.position;
        expect(position.x).toBeLessThan(320);
        expect(position.y).toBeLessThan(320);
        expect(s.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
        expect(requests.length - before).toBeLessThanOrEqual(8);
        expect(s.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2048);
        expect(s.navigation.outstandingRequests).toBeLessThanOrEqual(MAX_PENDING_NPC_PATHS);
        if (active?.status === "found" &&
          Math.hypot(position.x - active.goal.x, position.y - active.goal.y) < 1e-6) {
          completed.push({ direct: active.direct, path: active.path!, goal: active.goal });
          active = undefined;
        }
      }
      console.log(JSON.stringify({ map: "enclosed-320", requests, completed }));
      expect(requests[0]!.direct).toBeGreaterThanOrEqual(768);
      expect(requests.some(row => row.status === "no-path")).toBe(true);
      expect(completed).toHaveLength(2);
      expect(completed.every(row => row.direct < 512 && row.path > 32)).toBe(true);
      expect(completed[0]!.goal).not.toEqual(completed[1]!.goal);
      const firstFound = requests.findIndex(row => row.status === "found");
      expect(requests.slice(firstFound + 1).some(row => row.direct >= 768)).toBe(true);
    } finally { s.module.dispose(); }
  });

  it("shortens an Explore goal after a navigation search reaches its node limit", () => {
    const s = createSimulation([], { npcDetectionRange: 0, initialNpcsPerPlayer: 1 });
    const requests = vi.spyOn(s.context.navigation, "requestPath");
    const get = s.context.navigation.getPath;
    let limited = false;
    let recovered = false;
    vi.spyOn(s.context.navigation, "getPath").mockImplementation(id => {
      const result = get(id);
      if (result && !limited) {
        limited = true;
        return { status: "limit", path: [], expandedNodes: 2048 };
      }
      if (result?.status === "found") recovered = true;
      return result;
    });
    const metric = vi.spyOn(s.context.metrics, "increment");
    try {
      for (let tick = 1; tick <= 90; tick++) {
        s.navigation.processTick();
        s.module.step(1 / 30, tick);
      }
      expect(metric).toHaveBeenCalledWith("default.npc_explore.limit");
      expect(recovered).toBe(true);
      const distances = requests.mock.calls.map(([from, to]) =>
        Math.hypot(to.x - from.x, to.y - from.y));
      expect(distances[0]).toBeGreaterThanOrEqual(768);
      expect(distances[1]).toBeLessThanOrEqual(1024 / 2 * 1.1 + 32);
    } finally { s.module.dispose(); }
  });

  it("normalizes diagonal player movement to the configured speed", () => {
    const simulation = createSimulation();
    const player = simulation.context.entities.get("player:player-a")!;
    const action: DefaultPlayerAction = {
      type: "combat",
      moveX: 1,
      moveY: 1,
      aimX: player.position.x + 100,
      aimY: player.position.y + 100,
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

  it.each((["first-person", "keyboard-only", "keyboard-mouse"] as const).flatMap(controlMode => [
    { inputDegrees: 0, facingDegrees: -90, magnitude: 1, expectedDegrees: -27 },
    { inputDegrees: 0, facingDegrees: 90, magnitude: 0.4, expectedDegrees: 27 },
    { inputDegrees: 170, facingDegrees: -170, magnitude: 1, expectedDegrees: 176 },
    { inputDegrees: -170, facingDegrees: 170, magnitude: 1, expectedDegrees: -176 }
  ].map(scenario => ({ ...scenario, controlMode }))))(
    "blends held input $inputDegrees toward facing $facingDegrees in $controlMode without drift or speed changes",
    ({ controlMode, inputDegrees, facingDegrees, magnitude, expectedDegrees }) => {
      const { context, module } = createSimulation([], { npcMovementSpeed: 0 });
      const radians = (degrees: number) => degrees * Math.PI / 180;
      const player = context.entities.get("player:player-a")!;
      const facing = { x: Math.cos(radians(facingDegrees)), y: Math.sin(radians(facingDegrees)) };
      try {
        module.applyInput("player-a", {
          type: "combat", controlMode,
          moveX: Math.cos(radians(inputDegrees)) * magnitude,
          moveY: Math.sin(radians(inputDegrees)) * magnitude,
          aimX: player.position.x + facing.x * 100,
          aimY: player.position.y + facing.y * 100,
          fire: false
        });
        for (let tick = 1; tick <= 10; tick++) {
          const before = context.entities.get(player.id)!;
          module.step(1 / 30, tick);
          const after = context.entities.get(player.id)!;
          const dx = after.position.x - before.position.x;
          const dy = after.position.y - before.position.y;
          expect(Math.atan2(dy, dx) * 180 / Math.PI).toBeCloseTo(expectedDegrees, 8);
          expect(Math.hypot(dx, dy)).toBeCloseTo(PLAYER_SPEED * magnitude / 30, 8);
          expect(after.state.facing).toEqual(before.state.facing);
        }
      } finally { module.dispose(); }
    }
  );

  it.each(["first-person", "keyboard-only", "keyboard-mouse"] as const)(
    "steers travel 27 degrees upward in %s while firing at the upward aim, not along travel", controlMode => {
    const { context, module } = createSimulation([], { npcMovementSpeed: 0 });
    const player = context.entities.get("player:player-a")!;
    const aim = { x: player.position.x, y: player.position.y - 100 };
    try {
      module.applyInput("player-a", {
        type: "combat", controlMode,
        moveX: 1, moveY: 0, aimX: aim.x, aimY: aim.y, fire: true
      });
      module.step(1 / 30, 1);
      const moved = context.entities.get(player.id)!;
      expect(moved.state.facing).toEqual({ x: 0, y: -1 });
      expect(Math.atan2(moved.position.y - player.position.y,
        moved.position.x - player.position.x) * 180 / Math.PI).toBeCloseTo(-27, 8);
      const projectile = context.entities.values().find(entity => entity.state.kind === "projectile");
      if (projectile?.state.kind !== "projectile") throw new TypeError("Expected player projectile.");
      const aimDistance = Math.hypot(aim.x - moved.position.x, aim.y - moved.position.y);
      expect(projectile.state.velocity.x).toBeCloseTo(
        (aim.x - moved.position.x) / aimDistance * PLAYER_SHOT_SPEED, 8);
      expect(projectile.state.velocity.y).toBeCloseTo(
        (aim.y - moved.position.y) / aimDistance * PLAYER_SHOT_SPEED, 8);
      expect(projectile.state.velocity.y).toBeLessThan(0);
    } finally { module.dispose(); }
  });

  it.each(["first-person", "keyboard-only", "keyboard-mouse"] as const)(
    "keeps legacy mode-less movement unsteered after %s mode", (controlMode) => {
      const { context, module } = createSimulation([], { npcMovementSpeed: 0 });
      const player = context.entities.get("player:player-a")!;
      try {
        module.applyInput("player-a", {
          type: "combat", controlMode, moveX: 0.4, moveY: 0,
          aimX: player.position.x, aimY: player.position.y - 100, fire: false
        });
        module.applyInput("player-a", {
          type: "combat", moveX: 0.4, moveY: 0,
          aimX: player.position.x, aimY: player.position.y - 100, fire: false
        });
        for (let tick = 1; tick <= 10; tick++) {
          const before = context.entities.get(player.id)!;
          module.step(1 / 30, tick);
          const after = context.entities.get(player.id)!;
          expect(after.position.x - before.position.x).toBeCloseTo(PLAYER_SPEED * 0.4 / 30, 8);
          expect(after.position.y).toBe(before.position.y);
          expect(after.state.facing).toEqual({ x: 0, y: -1 });
        }
      } finally { module.dispose(); }
    }
  );

  it.each(["first-person", "keyboard-only", "keyboard-mouse"] as const)(
    "spins through a full turn at rest without translating in %s", controlMode => {
    const { context, module } = createSimulation([], { npcMovementSpeed: 0 });
    const player = context.entities.get("player:player-a")!;
    try {
      for (let tick = 1; tick <= 12; tick++) {
        const angle = tick * Math.PI / 6;
        module.applyInput("player-a", {
          type: "combat", controlMode, moveX: 0, moveY: 0,
          aimX: player.position.x + Math.cos(angle) * 100,
          aimY: player.position.y + Math.sin(angle) * 100, fire: false
        });
        module.step(1 / 30, tick);
        const current = context.entities.get(player.id)!;
        expect(current.position).toEqual(player.position);
        if (current.state.kind !== "player") throw new TypeError("Expected player.");
        const facing = current.state.facing;
        expect(facing.x).toBeCloseTo(Math.cos(angle), 8);
        expect(facing.y).toBeCloseTo(Math.sin(angle), 8);
      }
    } finally { module.dispose(); }
  });

  it.each([400, 700])(
    "explores outside the %i-unit range, pursues on entry and resumes exploring on exit",
    npcDetectionRange => {
      const npcMovementSpeed = 33.75;
      const simulation = createSimulation([], {
        npcMovementSpeed, npcDetectionRange, initialNpcsPerPlayer: 1
      });
      try {
        const npc = simulation.context.entities.get("npc:npc-northwest")!;
        const player = simulation.context.entities.get("player:player-a")!;
        simulation.context.entities.update(npc.id, entity => ({
          ...entity, position: { x: 700, y: 700 }
        }));
        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: 1_900, y: 1_900 }
        }));

        for (let tick = 1; tick <= 120; tick += 1) {
          simulation.navigation.processTick();
          simulation.module.step(1 / 30, tick);
        }
        const wandering = simulation.context.entities.get(npc.id)!.position;
        expect(wandering).not.toEqual({ x: 700, y: 700 });

        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: wandering.x + npcDetectionRange - 1, y: wandering.y }
        }));
        simulation.module.step(1 / 30, 121);

        expect(simulation.context.entities.get(npc.id)!.position.x).toBeCloseTo(
          wandering.x + npcMovementSpeed / 30,
          6
        );
        const pursuing = simulation.context.entities.get(npc.id)!.position;
        simulation.context.entities.update(player.id, entity => ({
          ...entity, position: { x: 1_900, y: 1_900 }
        }));
        for (let tick = 122; tick <= 242; tick += 1) {
          simulation.navigation.processTick();
          simulation.module.step(1 / 30, tick);
        }
        expect(simulation.context.entities.get(npc.id)!.position).not.toEqual(pursuing);
      } finally { simulation.module.dispose(); }
    }
  );

  it("explores without pursuit or contact targeting when NPC detection range is zero", () => {
    const simulation = createSimulation([], { npcDetectionRange: 0 });
    try {
      const npcId = "npc:npc-northwest";
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      for (let tick = 1; tick <= 120; tick += 1) {
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
      }
      expect(simulation.context.entities.get(npcId)!.position).not.toEqual({ x: 700, y: 700 });
      expect(simulation.context.entities.get("player:player-a")!.state).toMatchObject({ health: 200 });
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(0);
    } finally { simulation.module.dispose(); }
  });

  it("repeats seeded half-speed exploration with short pauses within the navigation budget", () => {
    const a = createSimulation([], { npcDetectionRange: 0 });
    const b = createSimulation([], { npcDetectionRange: 0 });
    const other = createSimulation([], { npcDetectionRange: 0 }, 43);
    const id = "npc:npc-northwest";
    const spawn = a.context.entities.get(id)!.position;
    let movingTicks = 0;
    let pausedAfterMovement = 0;
    let stationaryRun = 0;
    let longestStationary = 0;
    let farthestFromSpawn = 0;
    try {
      for (let tick = 1; tick <= 2400; tick += 1) {
        const previous = a.context.entities.get(id)!.position;
        for (const simulation of [a, b, other]) {
          const requests = simulation.navigation.requestsSubmitted;
          simulation.navigation.processTick();
          simulation.module.step(1 / 30, tick);
          expect(simulation.navigation.requestsSubmitted - requests)
            .toBeLessThanOrEqual(MAX_NPC_PATH_REQUESTS_PER_TICK);
          expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);
        }
        const position = a.context.entities.get(id)!.position;
        expect(position).toEqual(b.context.entities.get(id)!.position);
        expect(a.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
        const travel = Math.hypot(position.x - previous.x, position.y - previous.y);
        expect(travel).toBeLessThanOrEqual(67.5 * NPC_EXPLORE_SPEED_FACTOR / 30 + 1e-8);
        if (tick === 1) expect(travel, "explore starts on the first update").toBeGreaterThan(0);
        if (travel > 0) {
          movingTicks += 1;
          stationaryRun = 0;
        } else {
          stationaryRun += 1;
          longestStationary = Math.max(longestStationary, stationaryRun);
          if (movingTicks > 0) pausedAfterMovement += 1;
        }
        farthestFromSpawn = Math.max(farthestFromSpawn,
          Math.hypot(position.x - spawn.x, position.y - spawn.y));
      }
      expect(movingTicks).toBeGreaterThan(2100);
      expect(pausedAfterMovement).toBeGreaterThan(0);
      expect(longestStationary).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
      expect(farthestFromSpawn, "explores beyond its spawn neighbourhood").toBeGreaterThan(384);
      expect(a.context.entities.get(id)!.position).not.toEqual(other.context.entities.get(id)!.position);
    } finally {
      for (const simulation of [a, b, other]) simulation.module.dispose();
    }
  });

  it("keeps speed-zero NPCs stationary with no path requests", () => {
    const simulation = createSimulation([], { npcMovementSpeed: 0, npcDetectionRange: 0 });
    try {
      const before = simulation.context.entities.values().filter(entity => entity.state.kind === "npc");
      for (let tick = 1; tick <= 300; tick += 1) {
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
      }
      expect(simulation.context.entities.values().filter(entity => entity.state.kind === "npc")).toEqual(before);
      expect(simulation.navigation.requestsSubmitted).toBe(0);
    } finally { simulation.module.dispose(); }
  });

  it("explores reachable destinations away from its position next to terrain without entering it", () => {
    const wall = { x: 736, y: 600, width: 32, height: 200 };
    const simulation = createSimulation([wall], { npcDetectionRange: 0, initialNpcsPerPlayer: 1 });
    const id = "npc:npc-northwest";
    const requests = vi.spyOn(simulation.context.navigation, "requestPath");
    try {
      simulation.context.entities.update(id, entity => ({
        ...entity, position: { x: 720, y: 700 }
      }));
      let travelled = 0;
      for (let tick = 1; tick <= 2400; tick += 1) {
        const previous = simulation.context.entities.get(id)!.position;
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        const position = simulation.context.entities.get(id)!.position;
        expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
        travelled += Math.hypot(position.x - previous.x, position.y - previous.y);
      }
      expect(travelled).toBeGreaterThan(0.75 * 2400 * 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30);
      expect(requests.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const [from, to] of requests.mock.calls) {
        const separation = Math.hypot(to.x - from.x, to.y - from.y);
        expect(separation).toBeGreaterThanOrEqual(32 * 0.75);
        expect(separation).toBeLessThanOrEqual(
          2048 * NPC_EXPLORE_MAP_DISTANCE_FACTOR * 1.1 + 32 * Math.SQRT2);
        expect(simulation.context.geometry.isWalkable(to.x, to.y, 8)).toBe(true);
      }
    } finally { simulation.module.dispose(); }
  });

  it("discards pending explore paths on pursuit entry and resumes exploring immediately on exit", () => {
    const wall = { x: 736, y: 600, width: 32, height: 200 };
    const simulation = createSimulation([wall], {
      npcDetectionRange: 200, initialNpcsPerPlayer: 1
    });
    const id = "npc:npc-northwest";
    const exploreStep = 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30;
    const position = () => simulation.context.entities.get(id)!.position;
    const place = (entityId: string, point: Point2) =>
      simulation.context.entities.update(entityId, entity => ({ ...entity, position: point }));
    try {
      place(id, { x: 720, y: 700 });
      place("player:player-a", { x: 1_900, y: 1_900 });
      simulation.module.step(1 / 30, 1);
      expect(position(), "explore moves on the first update").not.toEqual({ x: 720, y: 700 });
      expect(simulation.navigation.outstandingRequests).toBe(1);
      simulation.navigation.processTick();

      // Entry: the completed explore path is drained; a clear shot stops pursuit.
      place(id, { x: 720, y: 700 });
      place("player:player-a", { x: 620, y: 700 });
      simulation.module.step(1 / 30, 2);
      expect(position()).toEqual({ x: 720, y: 700 });

      // Pursuit blocked by the wall submits a pursuit path request.
      place(id, { x: 727, y: 700 });
      place("player:player-a", { x: 840, y: 700 });
      simulation.module.step(1 / 30, 3);
      expect(simulation.navigation.outstandingRequests).toBe(1);

      // Exit: exploration resumes on the same update, at explore speed.
      place("player:player-a", { x: 1_900, y: 1_900 });
      const before = position();
      simulation.module.step(1 / 30, 4);
      const resumed = position();
      const resumedTravel = Math.hypot(resumed.x - before.x, resumed.y - before.y);
      expect(resumedTravel).toBeGreaterThan(0);
      expect(resumedTravel).toBeLessThanOrEqual(exploreStep + 1e-8);

      // Re-entry: the stale pursuit path is not followed; stop for the clear shot.
      place("player:player-a", { x: resumed.x - 100, y: resumed.y });
      simulation.navigation.processTick();
      simulation.module.step(1 / 30, 5);
      expect(position().x).toBeCloseTo(resumed.x, 6);
      expect(position().y).toBeCloseTo(resumed.y, 6);

      place("player:player-a", { x: 1_900, y: 1_900 });
      let stationary = 0;
      for (let tick = 6; tick <= 120; tick += 1) {
        const previous = position();
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        stationary = position().x === previous.x && position().y === previous.y ? stationary + 1 : 0;
        expect(stationary).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
      }
    } finally { simulation.module.dispose(); }
  });

  it("bounds explore path submissions and outstanding work for a large idle wave", () => {
    const simulation = createSimulation([], {
      npcDetectionRange: 0, initialNpcsPerPlayer: 100
    });
    try {
      for (let tick = 1; tick <= 240; tick += 1) {
        const before = simulation.navigation.requestsSubmitted;
        // Leave results pending to exercise the shared outstanding-request ceiling.
        simulation.module.step(1 / 30, tick);
        expect(simulation.navigation.requestsSubmitted - before).toBeLessThanOrEqual(8);
        expect(simulation.navigation.outstandingRequests).toBeLessThanOrEqual(MAX_PENDING_NPC_PATHS);
      }
      expect(simulation.navigation.outstandingRequests).toBe(MAX_PENDING_NPC_PATHS);
    } finally { simulation.module.dispose(); }
  });

  it("abandons unreachable explore goals without idling and retries a reachable destination", () => {
    const simulation = createSimulation(
      [{ x: 736, y: 0, width: 32, height: 2_048 }],
      { npcDetectionRange: 0, initialNpcsPerPlayer: 1 }
    );
    const id = "npc:npc-northwest";
    const metric = vi.spyOn(simulation.context.metrics, "increment");
    // Angle 0 and minimum reach: every candidate lies east of the full-height wall.
    const random = vi.spyOn(simulation.context.random, "next").mockReturnValue(0);
    let stationaryRun = 0;
    let longestStationary = 0;
    let travelled = 0;
    const observe = (tick: number) => {
      const previous = simulation.context.entities.get(id)!.position;
      simulation.navigation.processTick();
      simulation.module.step(1 / 30, tick);
      const position = simulation.context.entities.get(id)!.position;
      expect(position.x).toBeLessThan(736);
      expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
      const travel = Math.hypot(position.x - previous.x, position.y - previous.y);
      travelled += travel;
      stationaryRun = travel > 0 ? 0 : stationaryRun + 1;
      longestStationary = Math.max(longestStationary, stationaryRun);
    };
    try {
      simulation.context.entities.update(id, entity => ({
        ...entity, position: { x: 720, y: 700 }
      }));
      let tick = 0;
      while (!metric.mock.calls.some(([name]) => name === "default.npc_explore.no-path") && tick < 60) {
        observe(tick += 1);
      }
      expect(metric).toHaveBeenCalledWith("default.npc_explore.no-path");
      random.mockRestore();
      const requestsBefore = simulation.navigation.requestsSubmitted;
      for (const end = tick + 300; tick < end;) observe(tick += 1);
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(requestsBefore);
      expect(longestStationary).toBeLessThanOrEqual(2 * NPC_EXPLORE_PAUSE_TICKS);
      expect(travelled).toBeGreaterThan(0.75 * tick * 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30);
    } finally { simulation.module.dispose(); }
  });

  it("keeps exploring and retries at the request interval when path requests are rejected", () => {
    const simulation = createSimulation([], { npcDetectionRange: 0, initialNpcsPerPlayer: 1 });
    const id = "npc:npc-northwest";
    const metric = vi.spyOn(simulation.context.metrics, "increment");
    const rejected = vi.spyOn(simulation.context.navigation, "requestPath").mockReturnValue(undefined);
    try {
      const requestTicks: number[] = [];
      let travelled = 0;
      for (let tick = 1; tick <= 90; tick += 1) {
        const calls = rejected.mock.calls.length;
        const previous = simulation.context.entities.get(id)!.position;
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
        const position = simulation.context.entities.get(id)!.position;
        travelled += Math.hypot(position.x - previous.x, position.y - previous.y);
        if (rejected.mock.calls.length > calls) requestTicks.push(tick);
      }
      expect(metric).toHaveBeenCalledWith("default.npc_explore.request_rejected");
      expect(requestTicks[0]).toBe(1);
      expect(requestTicks.length).toBeGreaterThanOrEqual(4);
      for (let index = 1; index < requestTicks.length; index += 1) {
        expect(requestTicks[index]! - requestTicks[index - 1]!)
          .toBeGreaterThanOrEqual(NPC_REPATH_INTERVAL_TICKS);
      }
      expect(travelled).toBeGreaterThan(0.75 * 90 * 67.5 * NPC_EXPLORE_SPEED_FACTOR / 30);
      rejected.mockRestore();
      const before = simulation.navigation.requestsSubmitted;
      for (let tick = 91; tick <= 150; tick += 1) {
        simulation.navigation.processTick();
        simulation.module.step(1 / 30, tick);
      }
      expect(simulation.navigation.requestsSubmitted).toBeGreaterThan(before);
    } finally { simulation.module.dispose(); }
  });

  it.each([0, 33.75, 67.5, 90, 180])("travels at %s units/second during direct pursuit", npcMovementSpeed => {
    const simulation = createSimulation([], {
      npcMovementSpeed, npcDetectionRange: 700, initialNpcsPerPlayer: 1
    });
    const npcId = "npc:npc-northwest";
    try {
      simulation.context.entities.update(npcId, entity => ({
        ...entity, position: { x: 700, y: 700 }
      }));
      simulation.context.entities.update("player:player-a", entity => ({
        ...entity, position: { x: 1_400, y: 700 }
      }));
      for (let tick = 1; tick <= 30; tick += 1) simulation.module.step(1 / 30, tick);
      expect(simulation.context.entities.get(npcId)!.position.x - 700)
        .toBeCloseTo(npcMovementSpeed, 6);
      expect(simulation.context.entities.get(npcId)!.position.y).toBe(700);
    } finally { simulation.module.dispose(); }
  });

  it("keeps zero-speed NPCs stationary and removes contact damage", () => {
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
      expect(simulation.context.entities.get("player:player-a")!.state).toMatchObject({ health: 200 });
      expect(simulation.navigation.requestsSubmitted).toBe(0);
    } finally { simulation.module.dispose(); }
  });

  it.each([33.75, 67.5, 90, 180])("routes an attracted NPC around an obstacle at %s units/second", npcMovementSpeed => {
    const wall: Rect = { x: 1_000, y: 800, width: 32, height: 400 };
    const simulation = createSimulation([wall], { npcMovementSpeed, initialNpcsPerPlayer: 1 });
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
      simulation.context.entities.update(playerId, entity => entity.state.kind === "player"
        ? { ...entity, state: { ...entity.state, health: 100 } } : entity);
      simulation.navigation.processTick();
      const previous = simulation.context.entities.get(npcId)!.position;
      simulation.module.step(1 / 30, tick);
      const position = simulation.context.entities.get(npcId)!.position;
      const distance = Math.hypot(position.x - previous.x, position.y - previous.y);
      expect(distance).toBeLessThanOrEqual(npcMovementSpeed / 30 + 1e-8);
      expect(simulation.context.geometry.isWalkable(position.x, position.y, 8)).toBe(true);
      travelled += distance;
      if (tick === requestTick + 30) expect(travelled).toBeCloseTo(npcMovementSpeed, 6);
      if (simulation.context.entities.get(npcId)!.state.readyToFire) {
        break;
      }
    }

    const position = simulation.context.entities.get(npcId)!.position;
    expect(simulation.context.entities.get(npcId)!.state.readyToFire).toBe(true);
    expect(Math.abs(position.y - 1_000)).toBeGreaterThan(wall.height / 2);
    expect(simulation.navigation.stats.nodesProcessed).toBeLessThanOrEqual(2_048);
    simulation.module.dispose();
  });

  it("caps per-tick path submissions and never executes legacy contact capabilities", () => {
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
      health: 200
    });
    simulation.module.step(0, 20);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 200
    });
    simulation.module.step(0, 2 + NPC_CONTACT_COOLDOWN_TICKS);
    expect(simulation.context.entities.get(playerId)?.state).toMatchObject({
      kind: "player",
      health: 200
    });
    simulation.module.dispose();
  });
});

function createSimulation(
  obstacles: readonly Rect[] = [], settings: Partial<GameSettings> = {}, seed = 42,
  bounds = { width: 2_048, height: 2_048 }
) {
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
  const geometry = new WorldGeometry(bounds, obstacles);
  const navigation = new BoundedNavigation(geometry, {
    cellSize: 32,
    agentRadius: 8
  });
  let requestsSubmitted = 0;
  const results = new Map<string, NavigationPathResult>();
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: new SeededRandom(seed),
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
  const module = defaultModuleFactory.create(context, settings, roster, seed);
  module.initialize();
  return {
    context,
    module,
    navigation: {
      processTick: () => navigation.processTick(),
      get outstandingRequests() { return navigation.outstandingRequests; },
      get stats() { return navigation.stats; },
      get requestsSubmitted() { return requestsSubmitted; }
    }
  };
}
