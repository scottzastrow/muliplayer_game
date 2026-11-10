import { describe, expect, it } from "vitest";
import { NPC_COLOR, PLAYER_COLORS, resolvePlayerColors } from "../themes/default/src/colors.js";

describe("reserved enemy and stable player colors", () => {
  const roster = Array.from({ length: 32 }, (_, index) => ({
    accountId: `player-${String(index).padStart(2, "0")}`, color: PLAYER_COLORS[index]!
  }));

  it("reserves the enemy hue outside the entire distinct 32-player palette", () => {
    expect(NPC_COLOR).toBe("#ed6b61");
    expect(PLAYER_COLORS).toHaveLength(32);
    expect(new Set(PLAYER_COLORS).size).toBe(32);
    for (const color of PLAYER_COLORS) {
      expect(color).not.toBe(NPC_COLOR);
      const hue = Number(color.match(/^hsl\((\d+)/)![1]);
      expect(hue).toBeGreaterThanOrEqual(40);
      expect(hue).toBeLessThanOrEqual(320);
    }
    expect([...resolvePlayerColors(roster).values()]).toEqual(PLAYER_COLORS);
  });

  it.each(["missing", "reserved", "duplicate", "mixed"] as const)(
    "keeps all fallback colors distinct, reserved-safe and stable on reorder/rejoin (%s)", mode => {
      const players = roster.map((player, index) => ({
        accountId: player.accountId,
        ...(mode === "reserved" ? { color: NPC_COLOR }
          : mode === "duplicate" ? { color: PLAYER_COLORS[0]! }
          : mode === "mixed" && index % 2 === 0 ? { color: player.color } : {})
      }));
      const initial = resolvePlayerColors(players);
      expect(new Set(initial.values()).size).toBe(32);
      expect([...initial.values()]).not.toContain(NPC_COLOR);
      expect(resolvePlayerColors([...players].reverse())).toEqual(initial);
      expect(resolvePlayerColors(structuredClone(players))).toEqual(initial);
    }
  );

  it("rejects rosters beyond the supported distinct-color ceiling", () => {
    expect(() => resolvePlayerColors([...roster, { accountId: "overflow" }])).toThrow(/32/);
  });
});
