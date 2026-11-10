import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DefaultEntitySimulator, defaultSkinFactory, generateMap, PLAYER_SPEED, type DefaultEntity
} from "@multiplayer-game/default-theme";
import { SessionWorld } from "@multiplayer-game/engine";
import type { SkinHost } from "@multiplayer-game/theme-sdk";
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
    return {
      setTransform() {},
      fillRect: (x: number, y: number, width: number, height: number) =>
        this.drawnRects.push({ x, y, width, height, color }),
      beginPath() {}, closePath() {},
      arc: (x: number, y: number, radius: number) => this.drawnArcs.push({ x, y, radius }),
      fill: () => this.drawnColors.push(color), strokeRect() {},
      save() {}, restore() {}, clip() {}, stroke() {}, moveTo() {}, lineTo() {},
      translate() {},
      rotate: (angle: number) => this.drawnRotations.push(angle),
      fillText: (text: string, x: number, y: number) => {
        this.drawnText.push(text);
        this.drawnLabels.push({ text, x, y });
      },
      get fillStyle() { return color; },
      set fillStyle(value: string) { color = value; },
      strokeStyle: "", lineWidth: 0, font: "",
      textAlign: "left", textBaseline: "top"
    };
  }
}

describe("Dots and Squares presentation", () => {
  afterEach(() => vi.unstubAllGlobals());

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
          .toBeCloseTo(-27, 8);
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
