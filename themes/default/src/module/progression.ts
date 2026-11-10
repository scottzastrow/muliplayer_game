import {
  DEFAULT_GAME_SETTINGS,
  GameSettingsSchema,
  validateMatchCapacity,
  calculateLevelDifficulty,
  type GameSettings,
  type LevelDifficulty
} from "@multiplayer-game/protocol";
import { Countdown, type ModuleContext } from "@multiplayer-game/theme-sdk";
import type { DefaultEntity } from "./types.js";

export const LEVEL_INTERMISSION_TICKS = 5 * 30;
export const WAVE_BASE_DURATION_SECONDS = 120;
export const WAVE_SECONDS_PER_NPC = 6;
export const WAVE_MAX_DURATION_SECONDS = 360;

export function calculateWaveDurationSeconds(startingNpcCount: number): number {
  if (!Number.isSafeInteger(startingNpcCount) || startingNpcCount < 0) {
    throw new RangeError("Starting NPC count must be a nonnegative safe integer.");
  }
  return Math.min(
    WAVE_MAX_DURATION_SECONDS,
    WAVE_BASE_DURATION_SECONDS + WAVE_SECONDS_PER_NPC * startingNpcCount
  );
}

export type DefaultLevelPhase = "active" | "intermission" | "complete";

export interface DefaultProgressionState {
  readonly level: number;
  readonly phase: DefaultLevelPhase;
  readonly intermissionEndsAtTick?: number;
  readonly startingNpcCount: number;
}

export class DefaultProgression {
  #level = 0;
  #phase: DefaultLevelPhase = "active";
  #intermissionEndsAtTick: number | undefined;
  #lastTick = -1;
  #initialized = false;
  #waveCountdown: Countdown | undefined;
  #startingNpcCount = 0;

  constructor(
    readonly context: ModuleContext<DefaultEntity>,
    readonly settings: GameSettings,
    readonly rosterSize: number,
    readonly startLevel: (level: number, difficulty: LevelDifficulty) => void,
    readonly prepareNextLevel?: (level: number) => void
  ) {
    validateMatchCapacity(settings, rosterSize);
  }

  get state(): DefaultProgressionState {
    return Object.freeze({
      level: this.#level,
      phase: this.#phase,
      startingNpcCount: this.#startingNpcCount,
      ...(this.#intermissionEndsAtTick === undefined
        ? {}
        : { intermissionEndsAtTick: this.#intermissionEndsAtTick })
    });
  }

  initialize(): void {
    if (this.#initialized) {
      throw new Error("Default progression is already initialized.");
    }
    this.#initialized = true;
    this.#beginLevel(1);
  }

  step(tick: number, remainingNpcs: number): void {
    if (!this.#initialized) {
      throw new Error("Default progression is not initialized.");
    }
    if (
      !Number.isSafeInteger(tick) ||
      tick < 0 ||
      tick < this.#lastTick ||
      !Number.isSafeInteger(remainingNpcs) ||
      remainingNpcs < 0
    ) {
      throw new RangeError("Progression tick and remaining NPC count must be valid.");
    }
    this.#lastTick = tick;
    this.checkExpiry();
    if (this.#phase === "complete") {
      return;
    }
    if (this.#phase === "intermission") {
      if (tick >= this.#intermissionEndsAtTick!) {
        this.#beginLevel(this.#level + 1);
      }
      return;
    }
    if (remainingNpcs !== 0) {
      return;
    }

    if (this.#level >= this.settings.maxLevels) {
      this.#phase = "complete";
      this.#waveCountdown = undefined;
      this.context.requestCompletion({ kind: "match", reason: "maximum-level-cleared" });
      return;
    }

    this.#phase = "intermission";
    this.#waveCountdown = undefined;
    this.#intermissionEndsAtTick = tick + LEVEL_INTERMISSION_TICKS;
    this.prepareNextLevel?.(this.#level + 1);
    this.context.requestCompletion({
      kind: "level",
      reason: `level-${this.#level}-cleared`
    });
  }

  checkExpiry(): void {
    if (this.#phase === "active" && this.#waveCountdown?.expired) {
      this.#phase = "complete";
      this.context.requestCompletion({ kind: "match", reason: "wave-timeout" });
    }
  }

  recordEnemyKill(): void {
    if (this.#phase === "active") {
      this.#waveCountdown = new Countdown(this.context.clock, this.settings.noKillTimeoutSeconds);
    }
  }

  #beginLevel(level: number): void {
    const difficulty = calculateLevelDifficulty(this.settings, this.rosterSize, level);
    this.startLevel(level, difficulty);
    this.#startingNpcCount = difficulty.npcCount;
    this.#level = level;
    this.#phase = "active";
    this.#intermissionEndsAtTick = undefined;
    this.#waveCountdown = new Countdown(
      this.context.clock, this.settings.noKillTimeoutSeconds
    );
  }
}

export function resolveDefaultSettings(
  input: Readonly<Record<string, unknown>>,
  rosterSize: number
): GameSettings {
  const settings = { ...DEFAULT_GAME_SETTINGS, ...input };
  return validateMatchCapacity(GameSettingsSchema.parse(settings), rosterSize);
}
