import { ThemeDefinitionSchema, validateThemeRevision } from "@multiplayer-game/theme-sdk";
import manifest from "../theme.json" with { type: "json" };
import { defaultModuleFactory } from "./module/index.js";
import { defaultSkinFactory } from "./skin/index.js";

export const defaultThemeDefinition = ThemeDefinitionSchema.parse(manifest);

export const defaultThemeRevision = validateThemeRevision({
  definition: defaultThemeDefinition,
  packageDigest: defaultThemeDefinition.assetsDigest,
  installedModule: defaultModuleFactory.metadata,
  installedRenderer: defaultSkinFactory.metadata
});

export { defaultModuleFactory, defaultSkinFactory };
export {
  DefaultPlayerActionSchema,
  type DefaultModuleResults,
  type DefaultModuleSnapshot,
  type DefaultModuleState,
  type DefaultPlayerAction
} from "./module/index.js";
export type { DefaultEntity } from "./module/types.js";
