import { describe, expect, it } from "vitest";
import { MatchResultSchema } from "@multiplayer-game/protocol";
import { DefaultViewSchema } from "../themes/default/src/skin/view.js";
import {
  PREVIEW_SCENARIOS,
  createPreviewResult,
  createPreviewSnapshot,
  type SnapshotScenario
} from "../tools/theme-preview.js";

describe("deterministic theme preview fixtures", () => {
  it("provides schema-valid snapshots for life, death, combat, pickup and spectator views", () => {
    const snapshotScenarios: readonly SnapshotScenario[] = [
      "life", "death", "combat", "pickup", "spectator", "intermission"
    ];
    expect(PREVIEW_SCENARIOS).toEqual([
      "life", "death", "combat", "pickup", "spectator", "intermission", "results"
    ]);

    for (const scenario of snapshotScenarios) {
      expect(DefaultViewSchema.parse(createPreviewSnapshot(scenario)).playerMaxHealth).toBe(150);
    }

    const deathSnapshot = createPreviewSnapshot("death");
    if (typeof deathSnapshot !== "object" || deathSnapshot === null ||
        Array.isArray(deathSnapshot) || !Array.isArray(deathSnapshot.players)) {
      throw new Error("The death preview fixture is missing its player standings.");
    }
    const defeatedPlayer = deathSnapshot.players.find((player) =>
      typeof player === "object" && player !== null && !Array.isArray(player) &&
      player.accountId === "00000000-0000-4000-8000-000000000001");
    const livingPlayer = deathSnapshot.players.find((player) =>
      typeof player === "object" && player !== null && !Array.isArray(player) &&
      player.accountId === "00000000-0000-4000-8000-000000000002");
    expect(defeatedPlayer).toMatchObject({
      alive: false,
      respawnAtTick: 450,
      respawnBlocked: false
    });
    expect(livingPlayer).toMatchObject({ alive: true });
    expect(createPreviewSnapshot("combat")).toMatchObject({
      entities: expect.arrayContaining([
        expect.objectContaining({ state: { kind: "projectile" } })
      ])
    });
    expect(createPreviewSnapshot("pickup")).toMatchObject({
      entities: expect.arrayContaining([
        expect.objectContaining({ state: { kind: "pickup", pickupType: "health" } })
      ])
    });
    expect(createPreviewSnapshot("spectator")).toMatchObject({
      viewerRole: "spectator",
      spectatorView: { targetAccountId: "00000000-0000-4000-8000-000000000002" }
    });
    expect(createPreviewSnapshot("intermission")).toMatchObject({
      phase: "intermission", livingNpcCount: 0, startingNpcCount: 10,
      intermissionEndsAtTick: 450,
      levelStandings: [expect.objectContaining({ levelPoints: 250 }), expect.any(Object)]
    });
  });

  it("provides a schema-valid deterministic saved-results fixture", () => {
    const result = createPreviewResult();
    expect(MatchResultSchema.parse(result)).toEqual(result);
    expect(createPreviewResult()).toEqual(result);
  });
});
