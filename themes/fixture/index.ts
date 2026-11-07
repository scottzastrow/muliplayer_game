import { ThemeDefinitionSchema, validateThemeRevision } from "@multiplayer-game/theme-sdk";
import manifest from "./theme.json" with { type: "json" };
import { fixtureModuleFactory } from "./module/index.js";
import { fixtureSkinFactory } from "./skin/index.js";

export const fixtureThemeDefinition = ThemeDefinitionSchema.parse(manifest);

export const fixtureThemeRevision = validateThemeRevision({
  definition: fixtureThemeDefinition,
  packageDigest: fixtureThemeDefinition.assetsDigest,
  installedModule: fixtureModuleFactory.metadata,
  installedRenderer: fixtureSkinFactory.metadata
});

export { fixtureModuleFactory, FIXTURE_NPC_FLEE_SPEED } from "./module/index.js";
export { fixtureSkinFactory } from "./skin/index.js";
