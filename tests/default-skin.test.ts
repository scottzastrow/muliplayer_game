import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DefaultEntitySimulator, defaultModuleFactory, defaultSkinFactory, generateMap, loadMap,
  LEVEL_INTERMISSION_TICKS, PLAYER_SPEED, type DefaultEntity
} from "@multiplayer-game/default-theme";
import { AuthoritativeMapTransition, BoundedNavigation, SessionWorld } from "@multiplayer-game/engine";
import type { ModuleContext, SkinHost } from "@multiplayer-game/theme-sdk";
import { DefaultCombatActionSchema } from "../themes/default/src/module/actions.js";
import {
  DefaultViewSchema, interpolateEntities, worldToScreen, type DefaultView
} from "../themes/default/src/skin/view.js";
import { NPC_COLOR, PLAYER_COLORS } from "../themes/default/src/colors.js";

function view(x: number, deaths = 0): DefaultView {
  return DefaultViewSchema.parse({
    viewerAccountId: "alice", viewerRole: "player", tick: 2, level: 1, phase: "active",
    map: { width: 2048, height: 2048, obstacles: [] },
    radar: { categories: ["enemy"], markers: [
      { id: "npc-1", category: "enemy", position: { x: x + 100, y: 100 } }
    ] },
    players: [{ accountId: "alice", position: { x, y: 100 }, points: 200, health: 90,
      alive: true, deaths, color: PLAYER_COLORS[0]!, facing: { x: 0, y: -1 } }],
    entities: [{ id: "player:alice", radius: 14, position: { x, y: 100 },
      state: { kind: "player", accountId: "alice", deaths,
        color: PLAYER_COLORS[0]!, facing: { x: 0, y: -1 } } }]
  });
}

// Players' arenas are focused on entry, so a focused idle player sends neutral input.
function expectOnlyIdleInput(dispatchInput: ReturnType<typeof vi.fn>): void {
  for (const [action] of dispatchInput.mock.calls) {
    expect(action).toMatchObject({ type: "combat", moveX: 0, moveY: 0, fire: false });
  }
}

class HudElement extends EventTarget {
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly drawnText: string[] = [];
  readonly drawnLabels: { text: string; x: number; y: number }[] = [];
  readonly drawnArcs: { x: number; y: number; radius: number }[] = [];
  readonly children: HudElement[] = [];
  readonly drawnColors: string[] = [];
  readonly drawnRotations: number[] = [];
  readonly drawnRects: { x: number; y: number; width: number; height: number; color: string }[] = [];
  readonly drawnPaths: { points: number[][]; color: string }[] = [];
  readonly drawnCircles: { mode: "fill" | "stroke"; x: number; y: number; radius: number;
    color: string; alpha: number }[] = [];
  readonly clipArcs: { x: number; y: number; radius: number }[] = [];
  name = "";
  type = "";
  checked = false;
  className = "";
  textContent = "";
  removed = false;
  hidden = false;
  isConnected = true;
  setAttribute(): void {}
  append(...children: HudElement[]): void { this.children.push(...children); }
  replaceChildren(...children: HudElement[]): void { this.children.splice(0, this.children.length, ...children); }
  remove(): void { this.removed = true; }
  focus(): void { this.dispatchEvent(new Event("focus")); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  getContext() {
    let color = "";
    let stroke = "";
    let alpha = 1;
    let path: number[][] = [];
    let arc: { x: number; y: number; radius: number } | undefined;
    const circle = (mode: "fill" | "stroke") => {
      if (arc) this.drawnCircles.push({ mode, ...arc, color: mode === "fill" ? color : stroke, alpha });
    };
    return {
      setTransform() {},
      fillRect: (x: number, y: number, width: number, height: number) =>
        this.drawnRects.push({ x, y, width, height, color }),
      beginPath() { path = []; arc = undefined; }, closePath() {},
      arc: (x: number, y: number, radius: number) => {
        this.drawnArcs.push({ x, y, radius });
        arc = { x, y, radius };
      },
      fill: () => {
        this.drawnColors.push(color);
        this.drawnPaths.push({ points: [...path], color });
        circle("fill");
      }, strokeRect() {},
      save() {}, restore() {},
      clip: () => { if (arc) this.clipArcs.push(arc); },
      stroke: () => circle("stroke"),
      moveTo(x: number, y: number) { path.push([x, y]); },
      lineTo(x: number, y: number) { path.push([x, y]); },
      translate() {},
      rotate: (angle: number) => this.drawnRotations.push(angle),
      fillText: (text: string, x: number, y: number) => {
        this.drawnText.push(text);
        this.drawnLabels.push({ text, x, y });
      },
      get fillStyle() { return color; },
      set fillStyle(value: string) { color = value; },
      get strokeStyle() { return stroke; },
      set strokeStyle(value: string) { stroke = value; },
      get globalAlpha() { return alpha; },
      set globalAlpha(value: number) { alpha = value; },
      lineWidth: 0, font: "",
      textAlign: "left", textBaseline: "top"
    };
  }
}

const HEALTH_RADAR_BLUE = "#4db8ff";

function stubDocument(reducedMotion?: boolean): void {
  vi.stubGlobal("document", Object.assign(new EventTarget(), {
    createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
    createElement: () => new HudElement(),
    ...(reducedMotion === undefined ? {} : {
      defaultView: { matchMedia: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion
      }) }
    })
  }));
  vi.stubGlobal("window", new EventTarget());
}

describe("Dots and Squares presentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["fixed", true], ["simple-generated", true],
    ["fixed", false], ["simple-generated", false]
  ] as const)("traces three health-pickup waves on %s (collect=%s)", (mapMode, collect) => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => new HudElement()
    }));
    vi.stubGlobal("window", new EventTarget());
    const settings = { mapMode, maxLevels: 4, initialNpcsPerPlayer: 1,
      npcMovementSpeed: 0, npcDetectionRange: 0 };
    const definition = defaultModuleFactory.createInitialMap!(settings, 42);
    if (!definition) throw new Error("The selected map mode must provide an initial map.");
    const world = new SessionWorld<DefaultEntity>("pickup-waves", definition.bounds,
      [...loadMap(definition).obstacles]);
    const navigation = new BoundedNavigation(world.geometry);
    const maps = new AuthoritativeMapTransition(world, navigation, () => {});
    let spawned = 0;
    const context: ModuleContext<DefaultEntity> & { defaultMapDefinition: typeof definition } = {
      defaultMapDefinition: definition, maps,
      clock: { nowMs: () => 0 }, random: { next: () => 0.5 },
      entities: {
        get: id => world.getEntity(id),
        add: entity => {
          if (entity.state.kind === "pickup" && entity.state.pickupType === "health") spawned++;
          world.addEntity(entity);
        },
        update: (id, update) => world.addEntity(update(world.getEntity(id)!)),
        remove: id => world.removeEntity(id), values: () => world.entities(),
        queryRadius: (point, radius, maxCells) => world.queryEntities(point, radius, maxCells)
      },
      geometry: {
        isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
        intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
        moveCircle: (point, delta, radius) => world.geometry.moveCircle(point, delta, radius)
      },
      navigation: { requestPath: () => undefined, getPath: () => undefined },
      emit: () => {}, requestCompletion: () => {},
      metrics: { gauge: () => {}, increment: () => {} }
    };
    const module = defaultModuleFactory.create(context, settings,
      [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 42);
    const healthPacks = () => world.entities().filter(entity =>
      entity.state.kind === "pickup" && entity.state.pickupType === "health");
    const skins = (["player", "spectator"] as const).map(role => {
      const host: SkinHost = {
        slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
        selectedTarget: { accountId: "alice", username: "Alice" },
        cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
        dispatchInput: vi.fn(), navigate: () => {}
      };
      return { role, host, skin: defaultSkinFactory.mount(host, {
        image: async () => { throw new Error("No images used."); },
        audio: async () => { throw new Error("No audio used."); }
      }) };
    });
    const observe = () => {
      const packs = healthPacks();
      const ids = packs.map(pack => pack.id).sort();
      for (const pack of packs) {
        expect(world.geometry.isCircleWalkable(pack.position, pack.radius)).toBe(true);
      }
      // Center the camera on the authored health site, not on a distant player spawn.
      const camera = packs[0]?.position ??
        definition.spawns.find(spawn => spawn.pickupType === "health")!.position;
      context.entities.update("player:alice", player => ({ ...player, position: camera }));
      for (const { role, host, skin } of skins) {
        const snapshot = DefaultViewSchema.parse(module.snapshot({ accountId: "alice", role }));
        if (role === "spectator") {
          const player = snapshot.players[0]!;
          snapshot.spectatorView = {
            targetAccountId: player.accountId, cameraAnchor: player.position,
            hud: { health: player.health, points: player.points },
            death: { alive: player.alive, remainingSeconds: 0 }
          };
        }
        const markers = snapshot.radar!.markers.filter(marker => ids.includes(marker.id));
        expect(snapshot.radar!.markers.filter(marker => marker.category === "pickup")
          .map(marker => marker.id).sort()).toEqual(world.entities()
          .filter(entity => entity.state.kind === "pickup").map(entity => entity.id).sort());
        expect(markers.map(marker => marker.id).sort()).toEqual(ids);
        for (const marker of markers) {
          expect(marker.category).toBe("pickup");
          expect(marker.position).toEqual(packs.find(pack => pack.id === marker.id)!.position);
        }
        skin.handleViewport(800, 600, 1);
        skin.handleSnapshot(snapshot);
        const canvas = (host.slots.get("world") as unknown as HudElement).children[0]!;
        canvas.drawnPaths.length = 0;
        canvas.drawnCircles.length = 0;
        skin.render(snapshot.tick * 1000 / 30, snapshot);
        // The arena keeps its green health-pack styling for every pack inside the rendered view.
        const view = host.cameraAnchor!;
        const visible = packs.filter(pack => Math.abs(pack.position.x - view.x) <= 400 + pack.radius &&
          Math.abs(pack.position.y - view.y) <= 300 + pack.radius);
        expect(canvas.drawnPaths.filter(path => path.color === "#66df8a")).toHaveLength(visible.length);
        // Each radar health pack gets one bright-blue center dot and one pulse ring.
        expect(canvas.drawnCircles.filter(circle => circle.mode === "fill" &&
          circle.color === HEALTH_RADAR_BLUE && circle.radius === 4)).toHaveLength(packs.length);
        expect(canvas.drawnCircles.filter(circle => circle.mode === "stroke" &&
          circle.color === HEALTH_RADAR_BLUE)).toHaveLength(packs.length);
        expect(canvas.drawnPaths.filter(path => path.color === "#0088ff")).toHaveLength(0);
      }
      return { arena: packs.length, radar: ids.length,
        positions: Object.fromEntries(packs.map(pack => [pack.id, pack.position])) };
    };
    const rows = [];
    let tick = 0;
    let previousSpawned = 0;
    let retainedIds: string[] = [];
    try {
      module.initialize();
      for (let level = 1; level <= 3; level++) {
        expect(module.state).toMatchObject({ level, phase: "active" });
        const start = observe();
        // New slot fills; generated maps also re-place retained scattered packs (same ids).
        const waveSpawned = Object.keys(start.positions).filter(id => !retainedIds.includes(id)).length;
        if (mapMode === "fixed") expect(spawned - previousSpawned).toBe(waveSpawned);
        previousSpawned = spawned;
        const before = healthPacks().length;
        context.entities.update("player:alice", player => ({
          ...player, state: { ...player.state, health: collect ? 175 : 200 }
        }));
        module.step(0, ++tick);
        const collected = before - healthPacks().length;
        expect(world.getEntity("player:alice")!.state.health).toBe(collect ? 175 + collected * 25 : 200);
        const remaining = observe();
        if (level === 1 && collect) {
          const powerup = world.entities().find(entity =>
            entity.state.kind === "pickup" && entity.state.pickupType === "rapid-fire")!;
          context.entities.update("player:alice", player => ({ ...player, position: powerup.position }));
          module.step(0, ++tick);
          expect(world.getEntity(powerup.id)).toBeUndefined();
        }
        const otherPickups = world.entities().filter(entity =>
          entity.state.kind === "pickup" && entity.state.pickupType !== "health");
        for (const npc of world.entities().filter(entity => entity.state.kind === "npc")) {
          world.removeEntity(npc.id);
        }
        module.step(0, ++tick);
        expect(module.state.phase).toBe("intermission");
        expect(observe()).toEqual(remaining);
        module.step(0, tick + LEVEL_INTERMISSION_TICKS - 1);
        expect(observe()).toEqual(remaining);
        tick += LEVEL_INTERMISSION_TICKS;
        module.step(0, tick);
        expect(module.state).toMatchObject({ level: level + 1, phase: "active" });
        const next = observe();
        expect(world.entities().filter(entity => entity.state.kind === "pickup" &&
          entity.state.pickupType !== "health").map(entity => entity.id).sort())
          .toEqual(otherPickups.map(entity => entity.id).sort());
        if (mapMode === "fixed") {
          // Unclaimed packs stay where they were; only consumed slots are refilled.
          for (const [id, position] of Object.entries(remaining.positions)) {
            expect(next.positions[id]).toEqual(position);
          }
        }
        const summarize = ({ arena, radar }: { arena: number; radar: number }) => ({ arena, radar });
        retainedIds = Object.keys(remaining.positions);
        rows.push({ level, spawned: waveSpawned, collected,
          start: summarize(start), remaining: summarize(remaining), next: summarize(next) });
      }
      console.info(JSON.stringify({ mapMode, seed: 42, collect, healthPickupTrace: rows }));
      expect(rows).toEqual([1, 2, 3].map(level => ({
        level, spawned: level === 1 ? 3 : collect ? 1 : 0, collected: collect ? 1 : 0,
        start: { arena: 3, radar: 3 },
        remaining: { arena: collect ? 2 : 3, radar: collect ? 2 : 3 },
        next: { arena: 3, radar: 3 }
      })));
    } finally {
      for (const { skin } of skins) skin.dispose();
      module.dispose();
      expect(healthPacks()).toEqual([]);
    }
  });

  it.each([
    ["player", false], ["spectator", false], ["player", true], ["spectator", true]
  ] as const)(
    "renders health radar pickups as a bright-blue dot with a clipped pulse (%s, reduced motion=%s)",
    (role, reducedMotion) => {
      stubDocument(reducedMotion);
      const base = view(100);
      const pickups = [
        ...(["health", "rapid-fire", "spread"] as const).map((pickupType, index) => ({
          id: `pickup:${pickupType}`, radius: 12, position: { x: 200 + index * 100, y: 100 },
          state: { kind: "pickup" as const, pickupType }
        })),
        // Beyond radar range: clamped to the rim so its pulse must be clipped.
        { id: "pickup:health-pack-2", radius: 12, position: { x: 100, y: 1_500 },
          state: { kind: "pickup" as const, pickupType: "health" as const } }
      ];
      const snapshot: DefaultView = {
        ...base, viewerRole: role,
        ...(role === "spectator" ? { spectatorView: {
          targetAccountId: "alice", cameraAnchor: { x: 100, y: 100 },
          hud: { points: 200, health: 90 }, death: { alive: true, remainingSeconds: 0 }
        } } : {}),
        entities: [...base.entities, ...pickups],
        radar: { categories: ["player", "enemy", "pickup"], markers: [
          { id: "player:bob", category: "player", position: { x: 100, y: 200 } },
          ...base.radar!.markers,
          ...pickups.map(pickup => ({ id: pickup.id, category: "pickup", position: pickup.position }))
        ] }
      };
      const host: SkinHost = {
        slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
        selectedTarget: { accountId: "alice", username: "Alice" },
        cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
        dispatchInput: vi.fn(), navigate: () => {}
      };
      const skin = defaultSkinFactory.mount(host, {
        image: async () => { throw new Error("No images used."); },
        audio: async () => { throw new Error("No audio used."); }
      });
      try {
        skin.handleViewport(800, 600, 1);
        skin.handleSnapshot(snapshot);
        const canvas = (host.slots.get("world") as unknown as HudElement).children[0]!;
        const centers = [{ x: 716 + 100 * 67 / 512, y: 84 }, { x: 716, y: 84 + 67 }];
        const rings: number[] = [];
        for (const time of [0, 300, 600, 900, 1_150, 1_200]) {
          canvas.drawnCircles.length = 0;
          canvas.drawnPaths.length = 0;
          canvas.clipArcs.length = 0;
          skin.render(time, snapshot);
          expect(canvas.clipArcs).toContainEqual({ x: 716, y: 84, radius: 72 });
          const border = canvas.drawnCircles.findIndex(circle => circle.mode === "stroke" &&
            circle.color === "#dbe7f2" && circle.radius === 72);
          expect(border).toBeGreaterThan(-1);
          for (const center of centers) {
            const blue = canvas.drawnCircles.map((circle, index) => ({ ...circle, index }))
              .filter(circle => circle.color === HEALTH_RADAR_BLUE &&
                circle.x === center.x && circle.y === center.y);
            // The center dot stays fully opaque at every animation phase.
            expect(blue.filter(circle => circle.mode === "fill" && circle.radius === 4 &&
              circle.alpha === 1)).toHaveLength(1);
            const strokes = blue.filter(circle => circle.mode === "stroke");
            expect(strokes).toHaveLength(1);
            // Drawn inside the clipped radar (before the unclipped border stroke).
            expect(strokes[0]!.index).toBeLessThan(border);
            if (reducedMotion) {
              expect(strokes[0]).toMatchObject({ radius: 10, alpha: 0.8 });
              expect(blue.filter(circle => circle.mode === "fill" && circle.radius === 10 &&
                circle.alpha === 0.3)).toHaveLength(1);
            } else {
              const phase = (time % 1_200) / 1_200;
              expect(strokes[0]!.radius).toBeCloseTo(4 + 10 * phase);
              expect(strokes[0]!.alpha).toBeCloseTo(1 - phase);
              rings.push(strokes[0]!.radius);
            }
          }
          // Health no longer uses a diamond; power-ups keep orange diamonds.
          for (const [index, color] of ["#ffa64d", "#ffa64d"].entries()) {
            const x = 716 + (200 + index * 100) * 67 / 512;
            expect(canvas.drawnPaths).toContainEqual({
              color, points: [[x, 81], [x + 3, 84], [x, 87], [x - 3, 84]]
            });
          }
          expect(canvas.drawnPaths.filter(path => path.points.length === 4 &&
            path.points.every(([x, y]) => Math.hypot(x! - 716, y! - 84) <= 72) &&
            path.color !== "#ffa64d")).toEqual([]);
        }
        if (!reducedMotion) expect(new Set(rings).size).toBeGreaterThan(3);
        // Player and enemy radar markers remain circular and retain their colors.
        expect(canvas.drawnArcs).toContainEqual({ x: 716, y: 84 + 100 * 67 / 512, radius: 3 });
        expect(canvas.drawnArcs).toContainEqual({ x: 716 + 100 * 67 / 512, y: 84, radius: 3 });
        expect(canvas.drawnColors).toContain(PLAYER_COLORS[0]);
        expect(canvas.drawnColors).toContain(NPC_COLOR);
        // The arena health pickup keeps its existing styling.
        expect(canvas.drawnRects.some(rect => rect.color === HEALTH_RADAR_BLUE)).toBe(false);
      } finally { skin.dispose(); }
    }
  );

  it.each(["player", "spectator"] as const)(
    "renders 32 distinct fallback colors consistently in arena and radar after rejoin (%s)", role => {
      vi.stubGlobal("document", Object.assign(new EventTarget(), {
        createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
        createElement: () => new HudElement()
      }));
      vi.stubGlobal("window", new EventTarget());
      const base = view(100);
      const players = Array.from({ length: 32 }, (_, index) => {
        const { color: _color, ...player } = base.players[0]!;
        return { ...player, accountId: index === 0 ? "alice" : `p${index}`,
          position: { x: 100 + (index % 8) * 24, y: 100 + Math.floor(index / 8) * 24 } };
      });
      const snapshot: DefaultView = {
        ...base, viewerRole: role, players,
        ...(role === "spectator" ? { spectatorView: {
          targetAccountId: "alice", cameraAnchor: { x: 100, y: 100 },
          hud: { points: 200, health: 90 }, death: { alive: true, remainingSeconds: 0 }
        } } : {}),
        entities: players.map(player => ({
          id: `player:${player.accountId}`, radius: 14, position: player.position,
          state: { kind: "player", accountId: player.accountId, deaths: 0 }
        })),
        radar: { categories: ["player"], markers: players.slice(1).map(player => ({
          id: `player:${player.accountId}`, category: "player", position: player.position
        })) }
      };
      const render = (value: DefaultView) => {
        const host: SkinHost = {
          slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
          selectedTarget: { accountId: "alice", username: "Alice" },
          cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
          dispatchInput: vi.fn(), navigate: () => {}
        };
        const skin = defaultSkinFactory.mount(host, {
          image: async () => { throw new Error("No images used."); },
          audio: async () => { throw new Error("No audio used."); }
        });
        try {
          skin.handleViewport(800, 600, 1);
          skin.handleSnapshot(value);
          skin.render(0, value);
          const canvas = (host.slots.get("world") as unknown as HudElement).children[0]!;
          for (const color of PLAYER_COLORS) {
            // Body and facing dot in the arena, plus own/fellow-player radar marker.
            expect(canvas.drawnColors.filter(item => item === color).length).toBeGreaterThanOrEqual(3);
          }
          expect(canvas.drawnColors).not.toContain(NPC_COLOR);
          return canvas.drawnColors;
        } finally { skin.dispose(); }
      };
      expect(render(structuredClone(snapshot))).toEqual(render(snapshot));
    }
  );

  it.each(["player", "spectator"] as const)(
    "uses the reserved enemy color on rotating bodies, facing squares and radar for %s", role => {
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => new HudElement()
    }));
    vi.stubGlobal("window", new EventTarget());
    const host: SkinHost = {
      slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
      selectedTarget: { accountId: "alice", username: "Alice" },
      cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
      dispatchInput: vi.fn(), navigate: () => {}
    };
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    const snapshot = { ...view(100), viewerRole: role,
      ...(role === "spectator" ? { spectatorView: {
        targetAccountId: "alice", cameraAnchor: { x: 100, y: 100 },
        hud: { points: 200, health: 90 }, death: { alive: true, remainingSeconds: 0 }
      } } : {}), entities: [
      ...view(100).entities,
      { id: "npc", radius: 8, position: { x: 200, y: 100 },
        state: { kind: "npc", health: 50, facing: { x: 0, y: 1 } } },
      { id: "shot", radius: 6 / Math.SQRT2, position: { x: 200, y: 150 },
        state: { kind: "projectile", ownerNpcId: "npc" } }
    ] };
    try {
      skin.handleViewport(800, 600, 1);
      skin.handleSnapshot(snapshot);
      skin.render(0, snapshot);
      const canvas = (host.slots.get("world") as unknown as HudElement).children[0]!;
      expect(canvas.drawnRotations).toContain(Math.PI / 2);
      expect(canvas.drawnRects).toContainEqual({
        x: -8, y: -8, width: 16, height: 16, color: "#ed6b61"
      });
      expect(canvas.drawnRects).toContainEqual({
        x: 8, y: -3, width: 6, height: 6, color: "#ed6b61"
      });
      expect(canvas.drawnColors).toContain("#ed6b61");
      expect(canvas.drawnRects).toContainEqual({
        x: 497, y: 347, width: 6, height: 6, color: "#ffb5ad"
      });
      const turned = { ...snapshot, tick: 4, entities: snapshot.entities.map(entity =>
        entity.id === "npc" ? { ...entity, state: { ...entity.state, facing: { x: 1, y: 0 } } } : entity) };
      skin.handleSnapshot(turned);
      skin.render(100, turned);
      expect(canvas.drawnRotations.at(-1)).toBe(0);
    } finally { skin.dispose(); }
  });

  it.each(["player", "spectator"] as const)("shows compact stats, arena wave counts and intermission standings for %s", role => {
    const elements: HudElement[] = [];
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => {
        const element = new HudElement();
        elements.push(element);
        return element;
      }
    }));
    vi.stubGlobal("window", new EventTarget());
    const host: SkinHost = {
      slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
      selectedTarget: { accountId: "alice", username: "Alice" },
      cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
      dispatchInput: vi.fn(), navigate: () => {}
    };
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    const snapshot = {
      ...view(100), viewerRole: role, playerMaxHealth: 275, startingNpcCount: 10, livingNpcCount: 7,
      waveRemainingSeconds: 42.2,
      map: { ...view(100).map, terrain: { level: 1, density: 10, targetCoveragePercent: 80,
        actualCoveragePercent: 60, budgetExhausted: true } },
      levelStandings: [
        { accountId: "bob", username: "Bob", rank: 1, points: 500, levelPoints: 300, kills: 5, deaths: 0 },
        { accountId: "alice", username: "Alice", rank: 2, points: 200, levelPoints: 100, kills: 2, deaths: 0 }
      ],
      ...(role === "spectator" ? { spectatorView: {
        targetAccountId: "alice", cameraAnchor: { x: 100, y: 100 },
        hud: { points: 200, health: 90 }, death: { alive: true, remainingSeconds: 0 }
      } } : {})
    };
    try {
      skin.handleViewport(800, 600, 1);
      skin.handleSnapshot(snapshot);
      skin.render(0, snapshot);
      const canvas = (host.slots.get("world") as unknown as HudElement).children[0]!;
      const life = elements.find(element => element.className === "default-life")!;
      const summary = elements.find(element => element.className === "default-level-summary")!;
      expect(elements.some(element => element.className === "default-enemy-count")).toBe(false);
      expect(canvas.drawnText).toContain("Enemies remaining: 7");
      expect(elements.find(element => element.className === "default-points")!.textContent).toBe("Score: 200");
      expect(elements.find(element => element.className === "default-health")!.textContent).toBe("Health: 90 / 275");
      expect(elements.some(element => element.className === "default-wave-time")).toBe(false);
      expect(life.hidden).toBe(true);
      expect(elements.find(element => element.className === "default-terrain-coverage")!.textContent)
        .toBe("Terrain density 10: 60.00% coverage (target 80%) - limited by safe routes/spawns");
      expect(summary.hidden).toBe(true);
      const filter = elements.find(element => element.name === "radar-enemy")!;
      filter.checked = false;
      filter.dispatchEvent(new Event("change"));
      skin.render(40, snapshot);
      expect(canvas.drawnText).toContain("Enemies remaining: 7");
      const cleared = { ...snapshot, tick: 3, livingNpcCount: 0,
        phase: "intermission", intermissionEndsAtTick: 153 };
      skin.handleSnapshot(cleared);
      skin.render(80, cleared);
      expect(summary.hidden).toBe(false);
      expect(life.hidden).toBe(true);
      expect(summary.children[0]!.textContent).toBe("Level 1 Complete");
      expect(summary.children[1]!.textContent).toBe("Points earned this level: 100");
      expect(summary.children[2]!.textContent).toBe("Level 2 starts in 5\u2026");
      const rows = summary.children[3]!.children[2]!.children;
      expect(rows.map(row => row.children.map(cell => cell.textContent))).toEqual([
        ["1", "Bob", "300", "500", "5", "0"], ["2", "Alice", "100", "200", "2", "0"]
      ]);
      skin.handleSnapshot({ ...cleared, tick: 123 });
      skin.render(120, cleared);
      expect(summary.children[2]!.textContent).toBe("Level 2 starts in 1\u2026");
      const next = { ...snapshot, tick: 153, level: 2, startingNpcCount: 12, livingNpcCount: 12,
        map: { ...snapshot.map, terrain: { ...snapshot.map.terrain, level: 2 },
          obstacles: [{ x: 96, y: 96, width: 32, height: 32 }] } };
      skin.handleSnapshot(next);
      skin.render(160, next);
      expect(canvas.drawnRects).toEqual(expect.arrayContaining([
        expect.objectContaining({ x: 396, y: 296, width: 32, height: 32 })
      ]));
      expect(summary.hidden).toBe(true);
      expect(canvas.drawnText).toContain("Enemies remaining: 12");
      skin.handleSnapshot({ ...next, tick: 154, phase: "complete" });
      skin.render(200, next);
      expect(summary.hidden).toBe(true);
      expectOnlyIdleInput(host.dispatchInput as ReturnType<typeof vi.fn>);
      const legacy = { ...snapshot, tick: 200, playerMaxHealth: undefined };
      skin.handleSnapshot(legacy);
      skin.render(240, legacy);
      expect(elements.find(element => element.className === "default-health")!.textContent).toBe("Health: 90 / 100");
    } finally {
      skin.dispose();
    }
  });

  it.each(["player", "spectator", "other-control"] as const)(
    "focuses the arena once on entry so movement keys work without a click (%s)", scenario => {
      class TestKeyboardEvent extends Event {
        constructor(type: string, readonly code: string, readonly repeat = false) { super(type); }
      }
      vi.stubGlobal("KeyboardEvent", TestKeyboardEvent);
      const otherControl = new HudElement();
      vi.stubGlobal("document", Object.assign(new EventTarget(), {
        activeElement: scenario === "other-control" ? otherControl : undefined,
        createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
        createElement: () => new HudElement()
      }));
      vi.stubGlobal("window", new EventTarget());
      const slots = new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")]));
      const dispatchInput = vi.fn();
      const host: SkinHost = {
        slots, selectedTarget: { accountId: "alice", username: "Alice" },
        cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
        dispatchInput, navigate: () => {}
      };
      const skin = defaultSkinFactory.mount(host, {
        image: async () => { throw new Error("No images used."); },
        audio: async () => { throw new Error("No audio used."); }
      });
      const canvas = slots.get("world")!.children[0] as unknown as HudElement;
      const focus = vi.spyOn(canvas, "focus");
      const snapshot = view(500);
      if (scenario === "spectator") {
        snapshot.viewerRole = "spectator";
        snapshot.spectatorView = {
          targetAccountId: "alice", cameraAnchor: { x: 500, y: 100 },
          hud: { points: 200, health: 90 }, death: { alive: true, remainingSeconds: 0 }
        };
      }
      try {
        skin.handleViewport(800, 600, 1);
        expect(focus).not.toHaveBeenCalled();
        skin.handleSnapshot(snapshot);
        // No pointerdown or test-initiated focus: the first snapshot alone enables keys.
        canvas.dispatchEvent(new TestKeyboardEvent("keydown", "ArrowRight"));
        skin.render(40, snapshot);
        if (scenario !== "player") {
          expect(focus).not.toHaveBeenCalled();
          expect(dispatchInput).not.toHaveBeenCalled();
          return;
        }
        expect(focus).toHaveBeenCalledTimes(1);
        expect(dispatchInput.mock.lastCall![0]).toMatchObject({ moveX: 1, moveY: 0 });
        // Tabbing away is allowed and later snapshots must not pull focus back.
        canvas.dispatchEvent(new Event("blur"));
        skin.handleSnapshot({ ...snapshot, tick: 3 });
        skin.handleSnapshot({ ...snapshot, tick: 4 });
        expect(focus).toHaveBeenCalledTimes(1);
        const calls = dispatchInput.mock.calls.length;
        skin.render(200, snapshot);
        expect(dispatchInput.mock.calls.length).toBe(calls);
      } finally {
        skin.dispose();
      }
    }
  );

  it.each([
    { mode: "keyboard-mouse", right: "ArrowRight", up: "ArrowUp" },
    { mode: "keyboard-only", right: "KeyD", up: "KeyW" },
    { mode: "first-person", right: "KeyD", up: "KeyW" }
  ] as const)("moves and faces in screen directions in $mode mode", ({ mode, right, up }) => {
    class TestKeyboardEvent extends Event {
      constructor(type: string, readonly code: string, readonly repeat = false) { super(type); }
    }
    class TestPointerEvent extends Event {
      constructor(type: string, readonly clientX: number, readonly clientY: number,
        readonly button = 0) { super(type); }
    }
    vi.stubGlobal("KeyboardEvent", TestKeyboardEvent);
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => new HudElement()
    }));
    vi.stubGlobal("window", new EventTarget());
    const slots = new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")]));
    slots.get("controls")!.dataset.controlMode = mode;
    const dispatchInput = vi.fn();
    const host: SkinHost = {
      slots, selectedTarget: { accountId: "alice", username: "Alice" },
      cameraAnchor: undefined,
      setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
      dispatchInput, navigate: () => {}
    };
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    const canvas = slots.get("world")!.children[0] as unknown as HudElement;
    const snapshot = view(500);
    snapshot.players[0]!.facing = { x: -1, y: 0 };
    snapshot.entities[0]!.state = {
      kind: "player", accountId: "alice", deaths: 0, facing: { x: -1, y: 0 }
    };
    let time = 0;
    const render = (elapsed = 40) => {
      canvas.drawnArcs.length = 0;
      skin.render(time += elapsed, snapshot);
      return DefaultCombatActionSchema.parse(dispatchInput.mock.lastCall![0]);
    };
    const key = (type: string, code: string, repeat = false) =>
      canvas.dispatchEvent(new TestKeyboardEvent(type, code, repeat));
    const expectAim = (input: ReturnType<typeof render>, x: number, y: number) => {
      const dx = input.aimX - 500;
      const dy = input.aimY - 100;
      const length = Math.hypot(dx, dy);
      expect(dx / length).toBeCloseTo(x);
      expect(dy / length).toBeCloseTo(y);
      const dot = canvas.drawnArcs.find(arc => arc.radius === 3)!;
      expect((dot.x - 400) / 16).toBeCloseTo(x);
      expect((dot.y - 300) / 16).toBeCloseTo(y);
    };
    try {
      skin.handleViewport(800, 600, 1);
      skin.handleSnapshot(snapshot);
      canvas.focus();
      if (mode === "keyboard-mouse") {
        canvas.dispatchEvent(new TestPointerEvent("pointermove", 300, 300));
        expectAim(render(), -1, 0);
      }
      key("keydown", right);
      const moved = render();
      expect(moved.moveX).toBeCloseTo(1);
      expect(moved.moveY).toBeCloseTo(0);
      expect(moved.controlMode).toBe(mode);
      expectAim(moved, 1, 0);
      skin.handleSnapshot({ ...snapshot, tick: 3 });
      expectAim(render(), 1, 0);
      key("keydown", up);
      const diagonal = render();
      expect(diagonal.moveX).toBeCloseTo(Math.SQRT1_2);
      expect(diagonal.moveY).toBeCloseTo(-Math.SQRT1_2);
      expect(Math.hypot(diagonal.moveX, diagonal.moveY)).toBeCloseTo(1);
      expectAim(diagonal, Math.SQRT1_2, -Math.SQRT1_2);
      key("keyup", up);
      expectAim(render(), 1, 0);
      key("keyup", right);
      const stopped = render();
      expect(stopped.moveX).toBe(0);
      expect(stopped.moveY).toBe(0);
      expectAim(stopped, 1, 0);
      skin.handleSnapshot({ ...snapshot, tick: 4 });
      expectAim(render(), 1, 0);
      if (mode !== "keyboard-mouse") key("keydown", "Space");
      else {
        canvas.dispatchEvent(new TestPointerEvent("pointermove", 300, 300));
        expectAim(render(), 1, 0);
        canvas.dispatchEvent(new TestPointerEvent("pointerdown", 300, 300));
      }
      const firing = render();
      expect(firing.fire).toBe(true);
      expectAim(firing, 1, 0);
      if (mode === "keyboard-mouse") {
        canvas.dispatchEvent(new TestPointerEvent("pointermove", 300, 200));
        const aimed = render();
        expect(aimed.fire).toBe(true);
        expectAim(aimed, -Math.SQRT1_2, -Math.SQRT1_2);
        key("keydown", right);
        expectAim(render(), 1, 0);
        canvas.dispatchEvent(new TestPointerEvent("pointermove", 300, 400));
        const aimedWhileMoving = render();
        expect(aimedWhileMoving.moveX).toBeCloseTo(1);
        expectAim(aimedWhileMoving, -Math.SQRT1_2, Math.SQRT1_2);
        key("keyup", right);
        expectAim(render(), -Math.SQRT1_2, Math.SQRT1_2);
        window.dispatchEvent(new Event("pointerup"));
        expect(render().fire).toBe(false);
      } else {
        key("keyup", "Space");
        key("keydown", "ArrowRight");
        render();
        const turned = render();
        expect(turned.moveX).toBe(0);
        expect(turned.moveY).toBe(0);
        expect(turned.aimY).toBeGreaterThan(100);
        key("keyup", "ArrowRight");
        key("keydown", "ArrowLeft");
        const leftTurned = render();
        expect(leftTurned.aimY).toBeLessThan(turned.aimY);
        key("keyup", "ArrowLeft");
      }

      const down = mode !== "keyboard-mouse" ? "KeyS" : "ArrowDown";
      let snapshotTick = 4;
      for (const turn of mode !== "keyboard-mouse" ? ["ArrowLeft", "ArrowRight"] : ["mouse"]) {
        key("keydown", down);
        const movingDown = render();
        expect(movingDown).toMatchObject({ moveX: 0, moveY: 1, fire: false });
        expectAim(movingDown, 0, 1);
        let angle: number;
        if (turn === "mouse") {
          canvas.dispatchEvent(new TestPointerEvent("pointermove", 200, 300));
          angle = Math.PI;
        } else {
          key("keydown", turn);
          for (let frame = 0; frame < 5; frame++) render();
          key("keyup", turn);
          angle = Math.PI / 2 + (turn === "ArrowLeft" ? -1 : 1) * Math.PI * 0.2;
        }
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        expectAim(render(), x, y);
        if (mode !== "keyboard-mouse") key("keydown", "Space");
        else canvas.dispatchEvent(new TestPointerEvent("pointerdown", 200, 300));
        for (let frame = 0; frame < 6; frame++) {
          // Duplicate keydowns must not reassert facing, even without a repeat flag.
          key("keydown", down, frame % 2 === 0);
          skin.handleSnapshot({ ...snapshot, tick: ++snapshotTick });
          const held = render();
          expect(held).toMatchObject({ moveX: 0, moveY: 1, fire: true });
          expect(held.controlMode).toBe(mode);
          expectAim(held, x, y);
        }
        if (mode !== "keyboard-mouse") key("keyup", "Space");
        else window.dispatchEvent(new Event("pointerup"));
        key("keyup", down);
        const released = render();
        expect(released).toMatchObject({ moveX: 0, moveY: 0, fire: false });
        expectAim(released, x, y);
        key("keydown", down);
        expectAim(render(), 0, 1);
        key("keyup", down);
      }

      const map = generateMap(42, "fixed").map;
      const world = new SessionWorld<DefaultEntity>("skin-steering", map.definition.bounds, map.obstacles);
      const simulator = new DefaultEntitySimulator({
        clock: { nowMs: () => 0 },
        random: { next: () => 0.5 },
        entities: {
          get: id => world.getEntity(id),
          add: entity => world.addEntity(entity),
          update: (id, update) => {
            const entity = world.getEntity(id);
            if (!entity) throw new Error(`Missing entity ${id}.`);
            world.addEntity(update(entity));
          },
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
        emit: () => {},
        requestCompletion: () => {},
        metrics: { increment: () => {}, gauge: () => {} }
      }, 0);
      try {
        simulator.initialize(map, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 1);
        const player = world.getEntity("player:alice")!;
        world.addEntity({ ...player, position: { x: 500, y: 100 } });
        key("keydown", right);
        expectAim(render(), 1, 0);
        if (mode === "keyboard-mouse") {
          canvas.dispatchEvent(new TestPointerEvent("pointermove", 400, 200));
        } else {
          key("keydown", "ArrowLeft");
          for (let frame = 0; frame < 5; frame++) render(100);
          key("keyup", "ArrowLeft");
        }
        const aimed = render();
        expect(aimed).toMatchObject({ moveX: 1, moveY: 0, controlMode: mode });
        expectAim(aimed, 0, -1);
        simulator.applyInput("alice", aimed);
        const before = world.getEntity(player.id)!.position;
        simulator.step(1 / 30, 1);
        const after = world.getEntity(player.id)!.position;
        expect(Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI)
          .toBeCloseTo(-36, 8);
        expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(PLAYER_SPEED / 30, 8);
        key("keyup", right);
        if (mode === "keyboard-mouse") {
          canvas.dispatchEvent(new TestPointerEvent("pointermove", 500, 300));
        } else key("keydown", "ArrowRight");
        const turningAtRest = render(100);
        expect(turningAtRest).toMatchObject({ moveX: 0, moveY: 0 });
        expect(turningAtRest.aimX).toBeGreaterThan(aimed.aimX);
        simulator.applyInput("alice", turningAtRest);
        simulator.step(1 / 30, 2);
        expect(world.getEntity(player.id)!.position).toEqual(after);
      } finally { simulator.dispose(); }
    } finally {
      skin.dispose();
    }
  });

  it("uses a standard gamepad for analog movement, aim and fire, then stops on disconnect", () => {
    const buttons = Array.from({ length: 8 }, () => ({ pressed: false, value: 0 }));
    buttons[7] = { pressed: false, value: 0.75 };
    const gamepad = {
      id: "Simulated standard controller", connected: true, mapping: "standard",
      axes: [0.5, 0, 0, -1], buttons
    } as Gamepad;
    let gamepads: (Gamepad | null)[] = [gamepad];
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      defaultView: { navigator: { getGamepads: () => gamepads } },
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => new HudElement()
    }));
    const browserWindow = new EventTarget();
    vi.stubGlobal("window", browserWindow);
    const slots = new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")]));
    slots.get("controls")!.dataset.controlMode = "game-controller";
    const dispatchInput = vi.fn();
    const host: SkinHost = {
      slots, selectedTarget: { accountId: "alice", username: "Alice" },
      cameraAnchor: undefined, setCameraAnchor(anchor) { this.cameraAnchor = anchor; },
      dispatchInput, navigate: () => {}
    };
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    const canvas = slots.get("world")!.children[0] as unknown as HudElement;
    const controllerStatus = slots.get("controls")!.children[1]!;
    const snapshot = view(500);
    let time = 0;
    const render = () => {
      skin.render(time += 40, snapshot);
      return DefaultCombatActionSchema.parse(dispatchInput.mock.lastCall![0]);
    };
    try {
      skin.handleViewport(800, 600, 1);
      skin.handleSnapshot(snapshot);
      canvas.focus();
      const input = render();
      const analogSpeed = (0.5 - 0.15) / (1 - 0.15);
      expect(input).toMatchObject({
        controlMode: "game-controller", moveX: analogSpeed, moveY: 0, fire: true
      });
      expect(input.aimX).toBeCloseTo(500);
      expect(input.aimY).toBeCloseTo(0);
      expect(controllerStatus.textContent).toContain("Controller connected");
      expect(controllerStatus.hidden).toBe(false);

      const map = generateMap(42, "fixed").map;
      const world = new SessionWorld<DefaultEntity>("gamepad-steering", map.definition.bounds, map.obstacles);
      const simulator = new DefaultEntitySimulator({
        clock: { nowMs: () => 0 },
        random: { next: () => 0.5 },
        entities: {
          get: id => world.getEntity(id),
          add: entity => world.addEntity(entity),
          update: (id, update) => {
            const entity = world.getEntity(id);
            if (!entity) throw new Error(`Missing entity ${id}.`);
            world.addEntity(update(entity));
          },
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
        emit: () => {},
        requestCompletion: () => {},
        metrics: { increment: () => {}, gauge: () => {} }
      }, 0);
      try {
        simulator.initialize(map, [{ accountId: "alice", username: "Alice", joinedOrder: 0 }], 1);
        const player = world.getEntity("player:alice")!;
        world.addEntity({ ...player, position: { x: 500, y: 100 } });
        simulator.applyInput("alice", input);
        simulator.step(1 / 30, 1);
        const moved = world.getEntity(player.id)!.position;
        const distance = Math.hypot(moved.x - 500, moved.y - 100);
        expect(Math.atan2(moved.y - 100, moved.x - 500) * 180 / Math.PI).toBeCloseTo(-36, 8);
        expect(distance).toBeCloseTo(PLAYER_SPEED * analogSpeed / 30, 8);
      } finally { simulator.dispose(); }

      const sentBeforeDisconnect = dispatchInput.mock.calls.length;
      gamepads = [];
      browserWindow.dispatchEvent(new Event("gamepaddisconnected"));
      expect(controllerStatus.textContent).toContain("Controller disconnected");
      expect(dispatchInput.mock.lastCall![0]).toMatchObject({
        type: "combat", moveX: 0, moveY: 0, fire: false
      });
      const sentAfterDisconnect = dispatchInput.mock.calls.length;
      expect(sentAfterDisconnect).toBe(sentBeforeDisconnect + 1);
      skin.render(time += 40, snapshot);
      expect(dispatchInput.mock.calls.length).toBe(sentAfterDisconnect);
      gamepads = [{ ...gamepad, mapping: "" } as Gamepad];
      browserWindow.dispatchEvent(new Event("gamepadconnected"));
      expect(controllerStatus.textContent).toContain("mapping is unsupported");
      skin.render(time += 40, snapshot);
      expect(dispatchInput.mock.calls.length).toBe(sentAfterDisconnect);
    } finally {
      skin.dispose();
    }
  });

  it("draws the generated snapshot's collision rectangles at their world positions", () => {
    const elements: HudElement[] = [];
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => {
        const element = new HudElement();
        elements.push(element);
        return element;
      }
    }));
    vi.stubGlobal("window", new EventTarget());
    const host: SkinHost = {
      slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
      selectedTarget: { accountId: "alice", username: "Alice" },
      cameraAnchor: undefined, setCameraAnchor: () => {},
      dispatchInput: () => {}, navigate: () => {}
    };
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    const snapshot = view(100);
    snapshot.map.obstacles = generateMap(42, "simple-generated").map.obstacles.map(rect => ({ ...rect }));
    try {
      skin.handleViewport(800, 600, 1);
      skin.handleSnapshot(snapshot);
      skin.render(performance.now(), snapshot);
      const rectangles = elements.flatMap(element => element.drawnRects);
      for (const obstacle of snapshot.map.obstacles) {
        const screen = worldToScreen(obstacle, { x: 100, y: 100 }, 800, 600);
        expect(rectangles).toContainEqual(expect.objectContaining({
          x: screen.x, y: screen.y, width: obstacle.width, height: obstacle.height
        }));
      }
    } finally {
      skin.dispose();
    }
  });

  it.each(["player", "spectator"] as const)("omits wave time in the %s HUD even with legacy time fields during respawn", role => {
    const elements: HudElement[] = [];
    const documentTarget = new EventTarget();
    vi.stubGlobal("document", Object.assign(documentTarget, {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => {
        const element = new HudElement();
        elements.push(element);
        return element;
      }
    }));
    vi.stubGlobal("window", new EventTarget());
    const host: SkinHost = {
      slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
      selectedTarget: { accountId: "alice", username: "Alice" },
      controlMode: "keyboard-only",
      cameraAnchor: undefined, setCameraAnchor: () => {},
      dispatchInput: vi.fn(), navigate: () => {}
    };
    host.slots.get("controls")!.dataset.controlMode = "keyboard-only";
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    try {
      const snapshot = {
        ...view(100), viewerRole: role, waveRemainingSeconds: 42.1,
        spectatorView: {
          targetAccountId: "alice", cameraAnchor: { x: 100, y: 100 },
          hud: { points: 200, health: 0 }, death: { alive: false, remainingSeconds: 3 }
        }
      };
      snapshot.players[0] = { ...snapshot.players[0]!, alive: false, health: 0, respawnAtTick: 92 };
      skin.handleViewport(800, 600, 2);
      skin.handleSnapshot(snapshot);
      skin.render(performance.now(), snapshot);
      expect(elements.some(element => element.className === "default-wave-time")).toBe(false);
      expect(elements.find(element => element.className === "default-life")?.textContent)
        .toBe("Respawning in 3s");
      expect(elements.flatMap(element => element.drawnText))
        .toContain("Enemies remaining: 1");
      expect(elements.flatMap(element => element.drawnArcs))
        .toContainEqual({ x: 716, y: 84, radius: 72 });
      expect(elements.flatMap(element => element.drawnLabels))
        .toContainEqual({ text: "Enemies remaining: 1", x: 716, y: 164 });
      const next = { ...snapshot, tick: 4, waveRemainingSeconds: 41 };
      skin.handleViewport(1000, 700, 1);
      skin.handleSnapshot(next);
      skin.render(performance.now(), next);
      expect(elements.flatMap(element => element.drawnArcs))
        .toContainEqual({ x: 916, y: 84, radius: 72 });
      expect(elements.flatMap(element => element.drawnLabels))
        .toContainEqual({ text: "Enemies remaining: 1", x: 916, y: 164 });
      const maximumBudget = { ...next, tick: 5, waveRemainingSeconds: 360 };
      skin.handleSnapshot(maximumBudget);
      skin.render(performance.now(), maximumBudget);
      const cleared = { ...maximumBudget, tick: 6, phase: "intermission" };
      skin.handleSnapshot(cleared);
      skin.render(performance.now(), cleared);
      expect(elements.some(element => element.className === "default-wave-time")).toBe(false);
      expect(host.dispatchInput).not.toHaveBeenCalled();
    } finally {
      skin.dispose();
    }
    expect(elements.some(element => element.className === "default-wave-time")).toBe(false);
  });

  it.each(["player", "spectator"] as const)("keeps all four %s filters local and independent", role => {
    const elements: HudElement[] = [];
    vi.stubGlobal("document", Object.assign(new EventTarget(), {
      createTextNode: (text: string) => Object.assign(new HudElement(), { textContent: text }),
      createElement: () => {
        const element = new HudElement();
        elements.push(element);
        return element;
      }
    }));
    vi.stubGlobal("window", new EventTarget());
    const dispatchInput = vi.fn();
    const host: SkinHost = {
      slots: new Map(["world", "hud", "controls"].map(name => [name, document.createElement("div")])),
      selectedTarget: { accountId: "alice", username: "Alice" },
      cameraAnchor: undefined, setCameraAnchor: () => {},
      dispatchInput, navigate: () => {}
    };
    const skin = defaultSkinFactory.mount(host, {
      image: async () => { throw new Error("No images used."); },
      audio: async () => { throw new Error("No audio used."); }
    });
    const snapshot = view(100);
    snapshot.viewerRole = role;
    if (role === "spectator") snapshot.spectatorView = {
      targetAccountId: "alice", cameraAnchor: { x: 100, y: 100 },
      hud: { points: 200, health: 90 }, death: { alive: true, remainingSeconds: 0 }
    };
    snapshot.players.push({
      ...snapshot.players[0]!, accountId: "bob", color: PLAYER_COLORS[1]!, position: { x: 200, y: 100 }
    });
    snapshot.radar = { categories: ["player", "enemy", "pickup", "terrain"], markers: [
      { id: "player:bob", category: "player", position: { x: 200, y: 100 } },
      { id: "npc", category: "enemy", position: { x: 2000, y: 100 } },
      { id: "pack", category: "pickup", position: { x: 100, y: 2000 } },
      { id: "wall", category: "terrain", position: { x: 200, y: 200 },
        footprint: { width: 32, height: 64 } }
    ] };
    const original = structuredClone(snapshot);
    const drawing = elements[3]!;
    const inputs = elements.filter(element => element.type === "checkbox");
    const colors = [PLAYER_COLORS[1]!, "#ed6b61", "#ffa64d", "#344a60"];
    expect(inputs.map(input => input.name)).toEqual([
      "radar-player", "radar-enemy", "radar-pickup", "radar-terrain"
    ]);
    expect(inputs.every(input => input.checked)).toBe(true);
    skin.handleViewport(800, 600, 1);
    skin.handleSnapshot(snapshot);
    const render = () => {
      drawing.drawnColors.length = 0;
      drawing.drawnRects.length = 0;
      drawing.drawnArcs.length = 0;
      skin.render(performance.now(), snapshot);
      return [...drawing.drawnColors, ...drawing.drawnRects.map(rect => rect.color)];
    };
    try {
      for (const color of colors) expect(render()).toContain(color);
      for (const [index, input] of inputs.entries()) {
        input.checked = false;
        input.dispatchEvent(new Event("change"));
        const visible = render();
        expect(visible).not.toContain(colors[index]);
        colors.forEach((color, other) => {
          if (other !== index) expect(visible).toContain(color);
        });
        expect(drawing.drawnArcs).toContainEqual({ x: 716, y: 84, radius: 4 });
        expect(drawing.drawnArcs).toContainEqual({ x: 716, y: 79.5, radius: 2 });
        expect(drawing.drawnText).toContain("Enemies remaining: 1");
        input.checked = true;
        input.dispatchEvent(new Event("change"));
      }
      expect(snapshot).toEqual(original);
      expectOnlyIdleInput(dispatchInput);
    } finally {
      skin.dispose();
    }
    expect(elements.find(element => element.className === "default-radar-filters")?.removed).toBe(true);
  });

  it("preserves the server's spectator camera, HUD and respawn projection", () => {
    const snapshot = { ...view(100), viewerRole: "spectator", spectatorView: {
      targetAccountId: "alice", cameraAnchor: { x: 300, y: 400 },
      hud: { points: 500, health: 0 },
      death: { alive: false, remainingSeconds: 3, respawnAtTick: 92, respawnBlocked: false }
    } };
    expect(DefaultViewSchema.parse(snapshot).spectatorView).toEqual(snapshot.spectatorView);
    expect(DefaultViewSchema.safeParse({ ...snapshot, spectatorView: {
      ...snapshot.spectatorView, cameraAnchor: { x: Infinity, y: 0 }
    } }).success).toBe(false);
  });

  it("interpolates shared entity positions without extrapolating authority", () => {
    expect(interpolateEntities(view(100), view(160), 0.5)[0]?.position.x).toBe(130);
    expect(interpolateEntities(view(100), view(160), 2)[0]?.position.x).toBe(160);
    expect(interpolateEntities(view(100), view(160), -1)[0]?.position.x).toBe(100);
  });

  it("never interpolates absent avatars, respawns, or level transitions", () => {
    const current = view(160);
    current.entities = [];
    expect(interpolateEntities(view(100), current, 0.5)).toEqual([]);
    expect(interpolateEntities(view(100), view(900, 1), 0)[0]?.position.x).toBe(900);
    const nextLevel = view(800);
    nextLevel.level = 2;
    expect(interpolateEntities(view(100), nextLevel, 0)[0]?.position.x).toBe(800);
  });

  it("centers only the selected character and preserves nearby relative positions on resize", () => {
    const alice = { x: 300, y: 400 };
    const bob = { x: 500, y: 400 };
    expect(worldToScreen(alice, alice, 800, 600)).toEqual({ x: 400, y: 300 });
    expect(worldToScreen(bob, alice, 800, 600)).toEqual({ x: 600, y: 300 });
    expect(worldToScreen(bob, bob, 1000, 700)).toEqual({ x: 500, y: 350 });
  });

  it("rejects malformed/nonfinite snapshots and preserves dead HUD state", () => {
    expect(DefaultViewSchema.safeParse({ ...view(100), startingNpcCount: 10 }).success).toBe(false);
    expect(DefaultViewSchema.safeParse({
      ...view(100), startingNpcCount: 10, livingNpcCount: 11
    }).success).toBe(false);
    for (const seconds of [-1, 361, Infinity, NaN]) {
      expect(DefaultViewSchema.safeParse({ ...view(100), waveRemainingSeconds: seconds }).success).toBe(false);
    }
    expect(DefaultViewSchema.safeParse({ ...view(100), waveRemainingSeconds: 360 }).success).toBe(true);
    expect(DefaultViewSchema.safeParse({ ...view(100), map: undefined }).success).toBe(false);
    const invalid = view(100);
    invalid.entities[0]!.position.x = Infinity;
    expect(DefaultViewSchema.safeParse(invalid).success).toBe(false);
    const dead = view(100);
    dead.players[0] = { ...dead.players[0]!, alive: false, health: 0,
      respawnAtTick: 152, respawnBlocked: true };
    expect(DefaultViewSchema.parse(dead).players[0]).toMatchObject({
      points: 200, health: 0, alive: false, respawnAtTick: 152, respawnBlocked: true
    });

  });
});
