import { z } from "zod";

export const PlayerMaxHealthSchema = z.number().int().min(1).max(100_000);

export const TerrainDensitySchema = z.number().int().min(0).max(10);
export const TerrainDensityScheduleSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("incremental"),
    startingDensity: TerrainDensitySchema,
    increasePerLevel: TerrainDensitySchema
  }).strict(),
  z.object({
    mode: z.literal("per-level"),
    densities: z.array(TerrainDensitySchema).min(1).max(100)
  }).strict()
]);
export type TerrainDensitySchedule = z.infer<typeof TerrainDensityScheduleSchema>;
export const DEFAULT_TERRAIN_DENSITY: TerrainDensitySchedule = Object.freeze({
  mode: "incremental", startingDensity: 3, increasePerLevel: 0
});

export function resolveTerrainDensity(input: unknown, level: number, maxLevels: number): number {
  if (!Number.isSafeInteger(maxLevels) || maxLevels < 1 || maxLevels > 100 ||
    !Number.isSafeInteger(level) || level < 1 || level > maxLevels) {
    throw new RangeError("Terrain level must be an integer within the configured levels (1-100).");
  }
  const schedule = TerrainDensityScheduleSchema.parse(input === undefined ? DEFAULT_TERRAIN_DENSITY : input);
  if (schedule.mode === "per-level") {
    if (schedule.densities.length !== maxLevels) {
      throw new RangeError("Per Level terrain density requires one density per configured level.");
    }
    return schedule.densities[level - 1]!;
  }
  return Math.min(10, schedule.startingDensity + schedule.increasePerLevel * (level - 1));
}

export const GameSettingsSchema = z
  .object({
    maxPlayers: z.number().int().min(1).max(32),
    maxSpectators: z.number().int().min(0).max(64),
    initialNpcsPerPlayer: z.number().int().min(1).max(100),
    npcPopulationGrowthPercent: z.number().finite().min(0).max(100),
    baseNpcHealth: z.number().int().min(1).max(100_000),
    npcHealthGrowthPercent: z.number().finite().min(0).max(100),
    playerMaxHealth: PlayerMaxHealthSchema.default(150),
    npcMovementSpeed: z.number().finite().min(0).max(180).default(67.5),
    npcDetectionRange: z.number().finite().min(0).max(700).default(512),
    respawnDelaySeconds: z.number().finite().min(0).max(60),
    noKillTimeoutSeconds: z.number().finite().positive().max(3600).default(360),
    maxLevels: z.number().int().min(1).max(100),
    mapMode: z.enum(["fixed", "simple-generated"]).optional(),
    terrainDensity: TerrainDensityScheduleSchema.optional(),
    themeRevision: z.string().regex(/^[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+$/)
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.terrainDensity?.mode === "per-level" &&
      settings.terrainDensity.densities.length !== settings.maxLevels) {
      context.addIssue({ code: "custom", path: ["terrainDensity", "densities"],
        message: "Per Level terrain density requires one density per configured level." });
    }
  });

export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({
  maxPlayers: 4,
  maxSpectators: 8,
  initialNpcsPerPlayer: 5,
  npcPopulationGrowthPercent: 20,
  baseNpcHealth: 50,
  npcHealthGrowthPercent: 10,
  playerMaxHealth: 150,
  npcMovementSpeed: 67.5,
  npcDetectionRange: 512,
  respawnDelaySeconds: 5,
  noKillTimeoutSeconds: 360,
  maxLevels: 5,
  themeRevision: "default@1.0.0"
});

export const RuntimeLimitsSchema = z
  .object({
    maxNpcsPerSession: z.number().int().positive(),
    maxNpcHealth: z.number().int().positive()
  })
  .strict();

export type RuntimeLimits = z.infer<typeof RuntimeLimitsSchema>;

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = Object.freeze({
  maxNpcsPerSession: 2_000,
  maxNpcHealth: 1_000_000
});

export class CapacityValidationError extends Error {
  constructor(
    readonly level: number,
    readonly resource: "npcs" | "npcHealth",
    readonly desired: number,
    readonly limit: number
  ) {
    super(`Level ${level} requires ${desired} ${resource}, exceeding the limit of ${limit}.`);
    this.name = "CapacityValidationError";
  }
}

export function validateMatchCapacity(
  input: unknown,
  rosterSize: number,
  limits: RuntimeLimits = DEFAULT_RUNTIME_LIMITS
): GameSettings {
  const settings = GameSettingsSchema.parse(input);
  const checkedLimits = RuntimeLimitsSchema.parse(limits);
  for (let level = 1; level <= settings.maxLevels; level += 1) {
    calculateLevelDifficulty(settings, rosterSize, level, checkedLimits);
  }

  return settings;
}

export interface LevelDifficulty {
  readonly npcCount: number;
  readonly npcHealth: number;
}

export function calculateLevelDifficulty(
  settingsInput: unknown,
  rosterSize: number,
  level: number,
  limits: RuntimeLimits = DEFAULT_RUNTIME_LIMITS
): LevelDifficulty {
  const settings = GameSettingsSchema.parse(settingsInput);
  const checkedLimits = RuntimeLimitsSchema.parse(limits);
  if (!Number.isSafeInteger(rosterSize) || rosterSize < 1 || rosterSize > settings.maxPlayers) {
    throw new RangeError(`Roster size must be an integer from 1 to ${settings.maxPlayers}.`);
  }
  if (!Number.isSafeInteger(level) || level < 1 || level > settings.maxLevels) {
    throw new RangeError(`Level must be an integer from 1 to ${settings.maxLevels}.`);
  }

  const exponent = level - 1;
  const npcBase = rosterSize * settings.initialNpcsPerPlayer;
  const npcCount = boundedGrowth(
    npcBase,
    1 + settings.npcPopulationGrowthPercent / 100,
    exponent,
    level,
    "npcs",
    checkedLimits.maxNpcsPerSession
  );
  const npcHealth = boundedGrowth(
    settings.baseNpcHealth,
    1 + settings.npcHealthGrowthPercent / 100,
    exponent,
    level,
    "npcHealth",
    checkedLimits.maxNpcHealth
  );
  return Object.freeze({ npcCount, npcHealth });
}

function boundedGrowth(
  base: number,
  multiplier: number,
  exponent: number,
  level: number,
  resource: CapacityValidationError["resource"],
  limit: number
): number {
  let value = base;
  for (let step = 0; step < exponent; step += 1) {
    value *= multiplier;
    const rounded = ceilWithFloatingPointTolerance(value);
    if (!Number.isSafeInteger(rounded) || rounded > limit) {
      throw new CapacityValidationError(level, resource, rounded, limit);
    }
  }
  const desired = ceilWithFloatingPointTolerance(value);
  if (!Number.isSafeInteger(desired) || desired > limit) {
    throw new CapacityValidationError(level, resource, desired, limit);
  }

  function ceilWithFloatingPointTolerance(value: number): number {
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
    return Math.ceil(value - tolerance);
  }
  return desired;
}
