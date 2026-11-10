import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SETTINGS, GameSettingsSchema } from "@multiplayer-game/protocol";
import { PlayerMaxHealthSchema } from "@multiplayer-game/theme-sdk";
import { defaultModuleFactory, resolveDefaultSettings } from "@multiplayer-game/default-theme";
import { readFileSync } from "node:fs";

describe("public player maximum health setting", () => {
  it("defaults omitted settings to 150 without replacing explicit values", () => {
    const { playerMaxHealth: _omitted, ...legacy } = DEFAULT_GAME_SETTINGS;
    expect(GameSettingsSchema.parse(legacy).playerMaxHealth).toBe(150);
    expect(resolveDefaultSettings({}, 1).playerMaxHealth).toBe(150);
    for (const value of [1, 37, 100, 275, 100_000]) {
      expect(PlayerMaxHealthSchema.parse(value)).toBe(value);
      expect(resolveDefaultSettings({ playerMaxHealth: value }, 1).playerMaxHealth).toBe(value);
      expect(defaultModuleFactory.validateSettings({ playerMaxHealth: value })).toBe(true);
    }
    const definition = JSON.parse(readFileSync(new URL("../themes/default/theme.json", import.meta.url), "utf8"));
    expect(definition.settingsDefaults.playerMaxHealth).toBe(150);
    expect(definition.settingsSchema.playerMaxHealth)
      .toEqual({ type: "integer", minimum: 1, maximum: 100000 });
  });

  it.each([0, -1, 1.5, 100_001, NaN, Infinity, -Infinity, null, "150", true])(
    "rejects invalid maximum %s at the SDK, settings and theme boundaries", value => {
      expect(PlayerMaxHealthSchema.safeParse(value).success).toBe(false);
      const parsed = GameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS, playerMaxHealth: value });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]!.path).toEqual(["playerMaxHealth"]);
      expect(defaultModuleFactory.validateSettings({ playerMaxHealth: value })).toBe(false);
      expect(() => resolveDefaultSettings({ playerMaxHealth: value }, 1)).toThrow();
    }
  );
});
