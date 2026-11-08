import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSkinFactory } from "@multiplayer-game/default-theme";
import type { SkinHost } from "@multiplayer-game/theme-sdk";
import {
  DefaultViewSchema, interpolateEntities, worldToScreen, type DefaultView
} from "../themes/default/src/skin/view.js";

function view(x: number, deaths = 0): DefaultView {
  return DefaultViewSchema.parse({
    viewerAccountId: "alice", viewerRole: "player", tick: 2, level: 1, phase: "active",
    map: { width: 2048, height: 2048, obstacles: [] },
    players: [{ accountId: "alice", position: { x, y: 100 }, points: 200, health: 90,
      alive: true, deaths }],
    entities: [{ id: "player:alice", radius: 14, position: { x, y: 100 },
      state: { kind: "player", accountId: "alice", deaths } }]
  });
}

class HudElement extends EventTarget {
  readonly style: Record<string, string> = {};
  className = "";
  textContent = "";
  removed = false;
  setAttribute(): void {}
  append(): void {}
  remove(): void { this.removed = true; }
  getContext() {
    return {
      setTransform() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      fillStyle: ""
    };
  }
}

describe("Dots and Squares presentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["player", "spectator"] as const)("renders wave time in the %s HUD even during respawn", role => {
    const elements: HudElement[] = [];
    const documentTarget = new EventTarget();
    vi.stubGlobal("document", Object.assign(documentTarget, {
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
      dispatchInput: vi.fn(), navigate: () => {}
    };
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
      skin.handleSnapshot(snapshot);
      skin.render(performance.now(), snapshot);
      const timer = elements.find(element => element.className === "default-wave-time")!;
      expect(timer.textContent).toBe("Wave time remaining: 43s");
      expect(elements.find(element => element.className === "default-life")?.textContent)
        .toBe("Respawning in 3s");
      const next = { ...snapshot, tick: 4, waveRemainingSeconds: 41 };
      skin.handleSnapshot(next);
      skin.render(performance.now(), next);
      expect(timer.textContent).toBe("Wave time remaining: 41s");
      const cleared = { ...next, tick: 6, phase: "intermission" };
      skin.handleSnapshot(cleared);
      skin.render(performance.now(), cleared);
      expect(timer.textContent).toBe("");
      expect(host.dispatchInput).not.toHaveBeenCalled();
    } finally {
      skin.dispose();
    }
    expect(elements.find(element => element.className === "default-wave-time")?.removed).toBe(true);
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
    for (const seconds of [-1, 301, Infinity, NaN]) {
      expect(DefaultViewSchema.safeParse({ ...view(100), waveRemainingSeconds: seconds }).success).toBe(false);
    }
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
