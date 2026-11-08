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
export { createDefaultResultsSkin } from "./skin/results.js";
export {
  DEFAULT_ARENA_ID,
  DEFAULT_ARENA_NAME,
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
  DefaultProgression,
  LEVEL_INTERMISSION_TICKS,
  calculateWaveDurationSeconds,
  WAVE_BASE_DURATION_SECONDS,
  WAVE_SECONDS_PER_NPC,
  WAVE_MAX_DURATION_SECONDS,
  resolveDefaultSettings,
  type DefaultLevelPhase,
  type DefaultProgressionState
} from "./module/index.js";
export {
  DefaultEntitySimulator,
  DefaultCombatSimulator,
  defaultContactAttackCapability,
  normalizeMovement
} from "./module/index.js";
export { DefaultPickupSimulator } from "./module/index.js";
export { DefaultRespawnSimulator } from "./module/index.js";
export type { DefaultContactAttackCapability } from "./module/index.js";
export {
  MAX_ATTRACTION_QUERY_CELLS,
  HEALTH_PICKUP_AMOUNT,
  MAX_PICKUPS_PER_SESSION,
  MAX_PLAYER_HEALTH,
  MAX_NPC_PATH_REQUESTS_PER_TICK,
  MAX_PENDING_NPC_PATHS,
  MAX_PROJECTILES_PER_SESSION,
  NPC_ATTRACTION_RADIUS,
  NPC_CONTACT_COOLDOWN_TICKS,
  NPC_CONTACT_DAMAGE,
  NPC_REPATH_INTERVAL_TICKS,
  NPC_SPEED,
  PLAYER_BULLET_DAMAGE,
  PLAYER_FIRE_RATE_PER_SECOND,
  PLAYER_HEALTH,
  PLAYER_RAPID_FIRE_RATE_PER_SECOND,
  PLAYER_RADIUS,
  PLAYER_SHOT_SPEED,
  PLAYER_SPEED,
  PICKUP_RADIUS,
  POWERUP_DURATION_TICKS,
  PROJECTILE_LIFETIME_TICKS,
  PROJECTILE_RADIUS,
  SAFE_SPAWN_MARGIN,
  MAX_RESPAWN_ATTEMPTS_PER_PLAYER,
  SPREAD_ANGLE_RADIANS
} from "./module/tuning.js";
export type { DefaultEntity } from "./module/types.js";
