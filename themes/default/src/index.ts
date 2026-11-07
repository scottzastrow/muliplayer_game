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
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAX_MAP_GENERATION_ATTEMPTS,
  MapValidationError,
  generateMap,
  loadMap,
  type GeneratedMap,
  type LoadedMap
} from "./module/maps.js";
export {
  DefaultPlayerActionSchema,
  type DefaultModuleResults,
  type DefaultModuleSnapshot,
  type DefaultModuleState,
  type DefaultPlayerAction
} from "./module/index.js";
export {
  DefaultEntitySimulator,
  defaultContactAttackCapability,
  normalizeMovement
} from "./module/index.js";
export type { DefaultContactAttackCapability } from "./module/index.js";
export {
  MAX_ATTRACTION_QUERY_CELLS,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  MAX_PENDING_NPC_PATHS,
  NPC_ATTRACTION_RADIUS,
  NPC_CONTACT_COOLDOWN_TICKS,
  NPC_CONTACT_DAMAGE,
  NPC_REPATH_INTERVAL_TICKS,
  NPC_SPEED,
  PLAYER_HEALTH,
  PLAYER_RADIUS,
  PLAYER_SPEED
} from "./module/tuning.js";
export type { DefaultEntity } from "./module/types.js";
