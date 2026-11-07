export {
  defaultModuleFactory,
  defaultModuleMetadata,
  DefaultPlayerActionSchema,
  type DefaultModuleResults,
  type DefaultModuleSnapshot,
  type DefaultModuleState,
  type DefaultPlayerAction
} from "../src/module/index.js";
export { DefaultCombatSimulator } from "../src/module/combat.js";
export { DefaultPickupSimulator } from "../src/module/pickups.js";
export {
  DefaultEntitySimulator,
  defaultContactAttackCapability,
  normalizeMovement
} from "../src/module/entities.js";
export type { DefaultContactAttackCapability } from "../src/module/entities.js";
