import { z } from "zod";

export const GameSettingsSchema = z
  .object({
    maxPlayers: z.number().int().min(1).max(32),
    maxSpectators: z.number().int().min(0).max(64),
    initialNpcsPerPlayer: z.number().int().min(1).max(100),
    npcPopulationGrowthPercent: z.number().finite().min(0).max(100),
    baseNpcHealth: z.number().int().min(1).max(100_000),
    npcHealthGrowthPercent: z.number().finite().min(0).max(100),
    respawnDelaySeconds: z.number().finite().min(0).max(60),
    maxLevels: z.number().int().min(1).max(100),
    themeRevision: z.string().regex(/^[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+$/)
  })
  .strict();

export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({
  maxPlayers: 4,
  maxSpectators: 8,
  initialNpcsPerPlayer: 10,
  npcPopulationGrowthPercent: 20,
  baseNpcHealth: 100,
  npcHealthGrowthPercent: 10,
  respawnDelaySeconds: 5,
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

  if (!Number.isSafeInteger(rosterSize) || rosterSize < 1 || rosterSize > settings.maxPlayers) {
    throw new RangeError(`Roster size must be an integer from 1 to ${settings.maxPlayers}.`);
  }

  const populationGrowth = 1 + settings.npcPopulationGrowthPercent / 100;
  const healthGrowth = 1 + settings.npcHealthGrowthPercent / 100;

  for (let level = 1; level <= settings.maxLevels; level += 1) {
    const npcs = Math.ceil(
      rosterSize * settings.initialNpcsPerPlayer * populationGrowth ** (level - 1)
    );
    if (!Number.isSafeInteger(npcs) || npcs > checkedLimits.maxNpcsPerSession) {
      throw new CapacityValidationError(level, "npcs", npcs, checkedLimits.maxNpcsPerSession);
    }

    const health = Math.ceil(settings.baseNpcHealth * healthGrowth ** (level - 1));
    if (!Number.isSafeInteger(health) || health > checkedLimits.maxNpcHealth) {
      throw new CapacityValidationError(level, "npcHealth", health, checkedLimits.maxNpcHealth);
    }
  }

  return settings;
}
