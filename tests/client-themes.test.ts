import { describe, expect, it } from "vitest";
import { defaultThemeDefinition } from "@multiplayer-game/default-theme";
import { resolveClientTheme } from "../apps/client/src/themes.js";

describe("client theme pins", () => {
  it("resolves only the installed compatible revision and exact package digest", () => {
    expect(resolveClientTheme(
      `${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`,
      defaultThemeDefinition.assetsDigest
    ).definition).toEqual(defaultThemeDefinition);
    expect(() => resolveClientTheme("default@2.0.0", defaultThemeDefinition.assetsDigest))
      .toThrow(/not installed/);
    expect(() => resolveClientTheme(
      `${defaultThemeDefinition.id}@${defaultThemeDefinition.version}`,
      "0".repeat(64)
    )).toThrow(/digest/);
  });
});
