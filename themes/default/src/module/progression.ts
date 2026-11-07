import {
  DEFAULT_GAME_SETTINGS,
  GameSettingsSchema,
  validateMatchCapacity,
  calculateLevelDifficulty,
  type GameSettings,
  type LevelDifficulty
} from "@multiplayer-game/protocol";
import type { ModuleContext } from "@multiplayer-game/theme-sdk";
import type { DefaultEntity } from "./types.js";

export const LEVEL_INTERMISSION_TICKS = 5 * 30;

export type DefaultLevelPhase = "active" | "intermission" | "complete";

export interface DefaultProgressionState {
  readonly level: number;
  readonly phase: DefaultLevelPhase;
  readonly intermissionEndsAtTick?: number;
}

export class DefaultProgression {
  #level = 0;
  #phase: DefaultLevelPhase = "active";
  #intermissionEndsAtTick: number | undefined;
  #lastTick = -1;
  #initialized = false;

  constructor(
    readonly context: ModuleContext<DefaultEntity>,
    readonly settings: GameSettings,
    readonly rosterSize: number,
    readonly startLevel: (level: number, difficulty: LevelDifficulty) => void
  ) {
    validateMatchCapacity(settings, rosterSize);
  }

  get state(): DefaultProgressionState {
    return Object.freeze({
      level: this.#level,
      phase: this.#phase,
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
      this.context.requestCompletion({ kind: "match", reason: "maximum-level-cleared" });
      return;
    }

    this.#phase = "intermission";
    this.#intermissionEndsAtTick = tick + LEVEL_INTERMISSION_TICKS;
    this.context.requestCompletion({
      kind: "level",
      reason: `level-${this.#level}-cleared`
    });
  }

  #beginLevel(level: number): void {
    const difficulty = calculateLevelDifficulty(this.settings, this.rosterSize, level);
    this.startLevel(level, difficulty);
    this.#level = level;
    this.#phase = "active";
    this.#intermissionEndsAtTick = undefined;
  }
}

export function resolveDefaultSettings(
  input: Readonly<Record<string, unknown>>,
  rosterSize: number
): GameSettings {
  const settings = { ...DEFAULT_GAME_SETTINGS, ...input };
  return validateMatchCapacity(GameSettingsSchema.parse(settings), rosterSize);
}
