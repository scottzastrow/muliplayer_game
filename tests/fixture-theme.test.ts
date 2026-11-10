import { afterEach, describe, expect, it, vi } from "vitest";
import { SpatialGrid, WorldGeometry } from "@multiplayer-game/engine";
import type { JsonValue } from "@multiplayer-game/protocol";
import { DEFAULT_GAME_SETTINGS } from "@multiplayer-game/protocol";
import type {
  AssetLoader,
  EntityStore,
  GameModuleFactory,
  ModuleContext,
  RosterMember,
  SkinHost
} from "@multiplayer-game/theme-sdk";
import {
  defaultModuleFactory,
  defaultThemeDefinition,
  type DefaultEntity,
  type DefaultModuleResults,
  type DefaultModuleSnapshot,
  type DefaultModuleState,
  type DefaultPlayerAction
} from "@multiplayer-game/default-theme";
import {
  FIXTURE_NPC_FLEE_SPEED,
  fixtureModuleFactory,
  fixtureSkinFactory,
  fixtureThemeDefinition,
  fixtureThemeRevision
} from "@multiplayer-game/fixture-theme";
import { resolveClientTheme } from "../apps/client/src/themes.js";

type TestModuleFactory = GameModuleFactory<
  Record<string, JsonValue>,
  DefaultPlayerAction,
  DefaultModuleState,
  DefaultModuleSnapshot,
  DefaultModuleResults,
  DefaultEntity
>;

const roster: readonly RosterMember[] = [
  { accountId: "fixture-player", username: "Fixture Player", joinedOrder: 0 }
];

describe("fixture theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers compatible default and fixture revisions for client and server", () => {
    expect(fixtureThemeRevision).toMatchObject({
      id: "fixture",
      module: { id: "fixture", stateSchemaVersion: 4 },
      skin: { rendererId: "fixture", acceptedModuleId: "fixture" }
    });
    expect(resolveClientTheme(
      `${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`,
      defaultThemeDefinition.assetsDigest
    ).definition.name).toBe("Dots and Squares");
    expect(resolveClientTheme(
      `${fixtureThemeDefinition.id}@${fixtureThemeDefinition.version}`,
      fixtureThemeDefinition.assetsDigest
    ).definition.name).toBe("Fleeing Squares");
    expect(FIXTURE_NPC_FLEE_SPEED).toBeGreaterThan(0);
  });

  it.each([
    { distance: 500, behavior: "approaches outside shot range", defaultDirection: -1 },
    { distance: 200, behavior: "holds ranged standoff", defaultDirection: 0 }
  ])("flees at $distance units while the default NPC $behavior", ({ distance, defaultDirection }) => {
    const defaultSimulation = createSimulation(defaultModuleFactory);
    const fixtureSimulation = createSimulation(fixtureModuleFactory);
    const npcStart = { x: 400 + distance, y: 400 };
    try {
      for (const simulation of [defaultSimulation, fixtureSimulation]) {
        moveEntity(simulation.context, "player:fixture-player", { x: 400, y: 400 });
        const npc = simulation.context.entities.values().find((entity) =>
          entity.state.kind === "npc");
        if (!npc) throw new Error("The simulation did not initialize an enemy.");
        for (const entity of simulation.context.entities.values()) {
          if (entity.state.kind === "npc" && entity.id !== npc.id) {
            simulation.context.entities.remove(entity.id);
          }
        }
        moveEntity(simulation.context, npc.id, npcStart);
      }

      const defaultNpc = defaultSimulation.context.entities.values().find((entity) =>
        entity.state.kind === "npc");
      const fixtureNpc = fixtureSimulation.context.entities.values().find((entity) =>
        entity.state.kind === "npc");
      if (!defaultNpc || !fixtureNpc) throw new Error("The target enemy is missing.");

      defaultSimulation.module.step(1 / 30, 1);
      fixtureSimulation.module.step(1 / 30, 1);

      const defaultAfter = defaultSimulation.context.entities.get(defaultNpc.id)!;
      const fixtureAfter = fixtureSimulation.context.entities.get(fixtureNpc.id)!;
      expect(defaultAfter.state).toMatchObject({ targetId: "player:fixture-player" });
      expect(defaultAfter.position.x).toBeCloseTo(
        npcStart.x + defaultDirection * DEFAULT_GAME_SETTINGS.npcMovementSpeed / 30, 6
      );
      expect(defaultAfter.position.y).toBe(npcStart.y);
      expect(fixtureAfter.position.x).toBeGreaterThan(npcStart.x);
      expect(fixtureAfter.position.y).toBe(npcStart.y);
    } finally {
      defaultSimulation.module.dispose();
      fixtureSimulation.module.dispose();
    }
  });

  it("mounts independent HUDs and removes each renderer instance on disposal", () => {
    vi.stubGlobal("document", {
      createElement: () => new FixtureElement()
    });
    const first = createSkinHost();
    const second = createSkinHost();
    const assets: AssetLoader = {
      image: async () => { throw new Error("No fixture image assets are declared."); },
      audio: async () => { throw new Error("No fixture audio assets are declared."); }
    };
    const firstSkin = fixtureSkinFactory.mount(first.host, assets);
    const secondSkin = fixtureSkinFactory.mount(second.host, assets);

    firstSkin.handleSnapshot(createSnapshot("fixture-player", 25));
    secondSkin.handleSnapshot(createSnapshot("fixture-player", 70));
    expect(first.hud.textContent).toContain("SCORE\n25");
    expect(second.hud.textContent).toContain("SCORE\n70");
    expect(first.world.textContent).toContain("evasive squares");

    const controls = second.controls.children[0]!;
    const moveEast = controls.children[3]!;
    moveEast.dispatchEvent(new Event("click"));
    expect(second.inputs).toEqual([
      { type: "combat", moveX: 1, moveY: 0, aimX: 200, aimY: 100, fire: false }
    ]);

    firstSkin.dispose();
    expect(first.hud.children).toHaveLength(0);
    expect(first.world.children).toHaveLength(0);
    expect(second.hud.children).toHaveLength(1);
    secondSkin.dispose();
    expect(second.controls.children).toHaveLength(0);
  });
});



function createSimulation(factory: TestModuleFactory) {
  const entities = new Map<string, DefaultEntity>();
  const spatialGrid = new SpatialGrid<DefaultEntity>(32);
  const store: EntityStore<DefaultEntity> = {
    get: (id) => entities.get(id),
    add: (entity) => {
      entities.set(entity.id, entity);
      spatialGrid.set(entity);
    },
    update: (id, update) => {
      const entity = entities.get(id);
      if (!entity) throw new RangeError(`Entity ${id} does not exist.`);
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
  const geometry = new WorldGeometry({ width: 2_048, height: 2_048 });
  const context: ModuleContext<DefaultEntity> = {
    clock: { nowMs: () => 0 },
    random: { next: () => 0.5 },
    entities: store,
    geometry: {
      isWalkable: (x, y, radius = 0) => geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => geometry.moveCircle(position, delta, radius)
    },
    navigation: { requestPath: () => undefined, getPath: () => undefined },
    emit: () => {},
    requestCompletion: () => {},
    metrics: { increment: () => {}, gauge: () => {} }
  };
  const module = factory.create(context, {
    ...DEFAULT_GAME_SETTINGS,
    initialNpcsPerPlayer: 2,
    maxPlayers: 1
  }, roster, 42);
  module.initialize();
  return { context, module };
}

function moveEntity(
  context: ModuleContext<DefaultEntity>,
  id: string,
  position: Readonly<{ x: number; y: number }>
): void {
  context.entities.update(id, (entity) => ({ ...entity, position }));
}

function createSnapshot(viewerAccountId: string, points: number): JsonValue {
  return {
    viewerAccountId,
    viewerRole: "player",
    tick: 1,
    level: 2,
    phase: "active",
    map: { width: 2_048, height: 2_048, obstacles: [] },
    entities: [{ id: "npc:one", position: { x: 300, y: 400 }, state: { kind: "npc" } }],
    players: [{
      accountId: viewerAccountId,
      position: { x: 100, y: 100 },
      health: 80,
      points,
      deaths: 0,
      alive: true
    }]
  };
}

function createSkinHost() {
  const world = document.createElement("div");
  const hud = document.createElement("div");
  const controls = document.createElement("div");
  const inputs: JsonValue[] = [];
  const slots = new Map<string, HTMLElement>([
    ["world", world],
    ["hud", hud],
    ["controls", controls]
  ]);
  const host: SkinHost = {
    slots,
    dispatchInput: (input) => inputs.push(input),
    cameraAnchor: undefined,
    setCameraAnchor: () => {},
    selectedTarget: { accountId: "fixture-player", username: "Fixture Player" },
    navigate: () => {}
  };
  return { host, world, hud, controls, inputs };
}

class FixtureElement extends EventTarget {
  readonly children: HTMLElement[] = [];
  readonly style: Record<string, string> = {};
  className = "";
  type = "";
  #content = "";

  get textContent(): string {
    return this.#content + this.children.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value: string) {
    this.#content = value;
    this.replaceChildren();
  }

  append(...nodes: HTMLElement[]): void {
    for (const node of nodes) {
      fakeParents.get(node)?.detach(node);
      this.children.push(node);
      fakeParents.set(node, this);
    }
  }

  replaceChildren(...nodes: HTMLElement[]): void {
    for (const child of this.children) fakeParents.delete(child);
    this.children.splice(0, this.children.length, ...nodes);
    for (const node of nodes) fakeParents.set(node, this);
  }

  remove(): void {
    fakeParents.get(this)?.detach(this);
    fakeParents.delete(this);
    this.replaceChildren();
  }

  detach(child: object): void {
    const index = this.children.findIndex((node) => node === child);
    if (index >= 0) this.children.splice(index, 1);
  }
}

const fakeParents = new WeakMap<object, FixtureElement>();
