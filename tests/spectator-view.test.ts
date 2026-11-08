import { describe, expect, it } from "vitest";
import { createSpectatorView } from "../apps/server/src/transport/spectator-view.js";
import type { JsonValue } from "@multiplayer-game/protocol";

describe("target-derived spectator views", () => {
  const snapshot = (alive = true): Record<string, JsonValue> => ({
    viewerAccountId: "target", viewerRole: "player", tick: 90, level: 1, phase: "active",
    players: [{ accountId: "target", position: { x: 320, y: 480 }, health: alive ? 75 : 0,
      points: 500, alive, ...(alive ? {} : { respawnAtTick: 210, respawnBlocked: false }) }],
    entities: [], map: { width: 2048, height: 2048, obstacles: [] },
    radar: { categories: ["objective"], markers: [
      { id: "target-only", category: "objective", position: { x: 10, y: 20 } }
    ] }
  });

  it("uses the selected target's position and HUD without mutating the player's snapshot", () => {
    const original = snapshot();
    const view = createSpectatorView("target", original);
    expect(view).toMatchObject({
      viewerAccountId: "target", viewerRole: "spectator",
      spectatorView: { targetAccountId: "target", cameraAnchor: { x: 320, y: 480 },
        hud: { points: 500, health: 75 }, death: { alive: true, remainingSeconds: 0 } }
    });
    expect(original.viewerRole).toBe("player");
    expect(view.radar).toEqual(original.radar);
    expect(original).not.toHaveProperty("spectatorView");
  });

  it("keeps the death anchor, score, authoritative deadline and blocked status until respawn", () => {
    expect(createSpectatorView("target", snapshot(false))).toMatchObject({
      spectatorView: { cameraAnchor: { x: 320, y: 480 }, hud: { points: 500, health: 0 },
        death: { alive: false, respawnAtTick: 210, respawnBlocked: false, remainingSeconds: 4 } }
    });
    const blocked = snapshot(false);
    blocked.tick = 240;
    (blocked.players as Array<Record<string, JsonValue>>)[0]!.respawnBlocked = true;
    expect(createSpectatorView("target", blocked)).toMatchObject({
      spectatorView: { death: { remainingSeconds: 0, respawnBlocked: true } }
    });
    expect(createSpectatorView("target", snapshot()).spectatorView).not.toHaveProperty("death.respawnAtTick");
  });

  it("fails explicitly for a missing or malformed selected target instead of substituting another player", () => {
    expect(() => createSpectatorView("other-room", snapshot())).toThrow();
    const invalid = snapshot(false);
    delete (invalid.players as Array<Record<string, JsonValue>>)[0]!.respawnAtTick;
    expect(() => createSpectatorView("target", invalid)).toThrow();
  });
});
