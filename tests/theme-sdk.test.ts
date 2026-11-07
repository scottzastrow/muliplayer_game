import { describe, expect, it } from "vitest";
import {
  ThemeDefinitionSchema,
  isThemeCompatible,
  validateThemeRevision,
  type ThemeDefinition
} from "../packages/theme-sdk/src/index.js";

const definition: ThemeDefinition = {
  id: "default",
  name: "Default",
  version: "1.0.0",
  engineApiMajor: 1,
  module: { id: "default-game", version: "1.0.0", stateSchemaVersion: 1 },
  skin: {
    rendererId: "default-skin",
    version: "1.0.0",
    acceptedModuleId: "default-game",
    acceptedStateSchemaVersions: [1]
  },
  assetsDigest: "a".repeat(64),
  settingsSchemaVersion: 1,
  settingsSchema: { type: "object" },
  settingsDefaults: { maxPlayers: 4 }
};

describe("public theme SDK contracts", () => {
  it("validates strict theme definitions and module-state compatibility", () => {
    expect(ThemeDefinitionSchema.parse(definition)).toEqual(definition);
    expect(
      ThemeDefinitionSchema.safeParse({ ...definition, privateEnginePath: "../engine" }).success
    ).toBe(false);
    expect(
      ThemeDefinitionSchema.safeParse({
        ...definition,
        skin: { ...definition.skin, acceptedStateSchemaVersions: [2] }
      }).success
    ).toBe(false);
  });

  it("parses other positive engine API majors so runtime compatibility can reject them", () => {
    const newer = ThemeDefinitionSchema.parse({ ...definition, engineApiMajor: 2 });
    expect(isThemeCompatible(newer, 1)).toBe(false);
    expect(isThemeCompatible(definition, 1)).toBe(true);
  });

  it("requires the installed module and renderer versions to match the pinned definition", () => {
    expect(
      validateThemeRevision({
        definition,
        packageDigest: definition.assetsDigest,
        installedModule: { id: "default-game", version: "1.0.0" },
        installedRenderer: { id: "default-skin", version: "1.0.0" }
      })
    ).toEqual(definition);

    expect(() =>
      validateThemeRevision({
        definition,
        packageDigest: definition.assetsDigest,
        installedModule: { id: "default-game", version: "2.0.0" },
        installedRenderer: { id: "default-skin", version: "1.0.0" }
      })
    ).toThrow(/exact declared version/);
  });
});
