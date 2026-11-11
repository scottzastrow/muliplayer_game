import { afterEach, describe, expect, it } from "vitest";
import { createLocalGame } from "@multiplayer-game/local-preview";
import { sampleGameModule } from "../examples/local-preview/src/game.js";
import { sampleMap } from "../examples/local-preview/src/map.js";
import { sampleSettings } from "../examples/local-preview/src/settings.js";

const activeGames: Array<{ dispose(): void }> = [];

afterEach(() => {
  for (const game of activeGames.splice(0)) game.dispose();
});

describe("public local preview runtime", () => {
  it("applies validated module input through the fixed-step simulation and map geometry", async () => {
    const accountId = "preview-player";
    const game = await createLocalGame({
      moduleFactory: sampleGameModule,
      settings: sampleSettings,
      map: sampleMap,
      seed: 42,
      roster: [{ accountId, username: "Preview Player", joinedOrder: 0 }],
      viewer: { accountId, role: "player" }
    });
    activeGames.push(game);

    expect(game.snapshot.players[0].position).toEqual({ x: 48, y: 80 });
    expect(game.sendInput(accountId, { type: "move", x: 1, y: 0 })).toBe(true);
    expect(game.sendInput("not-in-roster", { type: "move", x: 1, y: 0 })).toBe(false);
    expect(game.sendInput(accountId, { type: "not-a-move" })).toBe(false);
    expect(game.step().tick).toBe(1);
    expect(game.snapshot.players[0].position.x).toBe(52);

    for (let tick = 0; tick < 20; tick += 1) game.step();
    expect(game.snapshot.players[0].position.x).toBeLessThanOrEqual(104);
    expect(game.snapshot.players[0].points).toBeGreaterThan(0);
  });

  it("rejects module settings before creating a local session", async () => {
    await expect(createLocalGame({
      moduleFactory: sampleGameModule,
      settings: { moveDistance: 0 },
      map: sampleMap,
      seed: 42,
      roster: [{ accountId: "preview-player", username: "Preview Player", joinedOrder: 0 }],
      viewer: { accountId: "preview-player", role: "player" }
    })).rejects.toThrow("The game module rejected the supplied settings.");
  });
});
