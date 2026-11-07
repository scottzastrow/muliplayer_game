import type { JsonValue } from "@multiplayer-game/protocol";

export const SIMULATION_HZ = 30;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;
export const FIXED_STEP_MS = 1_000 / SIMULATION_HZ;
export const MAX_CATCH_UP_STEPS = 3;

export type DeepReadonly<T> = T extends string | number | boolean | null
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export interface MonotonicClock {
  nowMs(): number;
}

export class SystemMonotonicClock implements MonotonicClock {
  nowMs(): number {
    return performance.now();
  }
}

export interface RandomSource {
  next(): number;
}

export class SeededRandom implements RandomSource {
  #state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("Random seed must be a safe integer.");
    }
    this.#state = seed >>> 0;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  }

  integer(minimum: number, maximum: number): number {
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      maximum < minimum ||
      maximum - minimum + 1 > 0x1_0000_0000
    ) {
      throw new RangeError("Random integer bounds must be ordered safe integers.");
    }
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }
}

export interface SessionRunnerCallbacks<TSnapshot extends JsonValue> {
  step(dtSeconds: number, tick: number): void;
  snapshot(): TSnapshot;
  onError(error: unknown): void;
  dispose?(): void;
}

export interface SessionRunnerOptions<TSnapshot extends JsonValue> {
  clock?: MonotonicClock;
  callbacks: SessionRunnerCallbacks<TSnapshot>;
}

export interface AdvanceResult {
  readonly state: "running" | "failed" | "disposed";
  readonly stepsRun: number;
  readonly droppedSteps: number;
  readonly tick: number;
  readonly missedDeadlines: number;
  readonly droppedTimeMs: number;
}

export class SessionRunner<TSnapshot extends JsonValue> {
  readonly #clock: MonotonicClock;
  readonly #callbacks: SessionRunnerCallbacks<TSnapshot>;
  #lastTimeMs: number;
  #accumulatorMs = 0;
  #tick = 0;
  #missedDeadlines = 0;
  #droppedTimeMs = 0;
  #state: AdvanceResult["state"] = "running";
  #cleanupCalled = false;

  constructor(options: SessionRunnerOptions<TSnapshot>) {
    this.#clock = options.clock ?? new SystemMonotonicClock();
    this.#callbacks = options.callbacks;
    this.#lastTimeMs = this.#readClock();
  }

  get state(): AdvanceResult["state"] {
    return this.#state;
  }

  get tick(): number {
    return this.#tick;
  }

  get missedDeadlines(): number {
    return this.#missedDeadlines;
  }

  get droppedTimeMs(): number {
    return this.#droppedTimeMs;
  }

  advance(): AdvanceResult {
    if (this.#state !== "running") {
      return this.#result(0, 0);
    }

    const nowMs = this.#readClock();
    if (nowMs < this.#lastTimeMs) {
      throw new RangeError("Monotonic clock moved backwards.");
    }

    this.#accumulatorMs += nowMs - this.#lastTimeMs;
    this.#lastTimeMs = nowMs;

    const availableSteps = Math.floor(this.#accumulatorMs / FIXED_STEP_MS);
    const stepsToRun = Math.min(availableSteps, MAX_CATCH_UP_STEPS);
    const droppedSteps = availableSteps - stepsToRun;
    this.#accumulatorMs -= availableSteps * FIXED_STEP_MS;

    if (droppedSteps > 0) {
      this.#missedDeadlines += droppedSteps;
      this.#droppedTimeMs += droppedSteps * FIXED_STEP_MS;
    }

    let stepsRun = 0;
    for (let step = 0; step < stepsToRun; step += 1) {
      try {
        this.#callbacks.step(FIXED_STEP_SECONDS, this.#tick + 1);
        this.#tick += 1;
        stepsRun += 1;
        if (this.#state !== "running") {
          break;
        }
      } catch (error) {
        this.#fail(error);
        break;
      }
    }

    return this.#result(stepsRun, droppedSteps);
  }

  snapshot(): DeepReadonly<TSnapshot> {
    if (this.#state !== "running") {
      throw new Error(`Cannot take a snapshot from a ${this.#state} session runner.`);
    }
    try {
      return freezeJson(structuredClone(this.#callbacks.snapshot()));
    } catch (error) {
      this.#fail(error);
      throw error;
    }
  }

  dispose(): void {
    if (this.#state === "disposed") {
      return;
    }
    this.#state = "disposed";
    this.#runCleanup();
  }

  #readClock(): number {
    const now = this.#clock.nowMs();
    if (!Number.isFinite(now) || now < 0) {
      throw new RangeError("Monotonic clock must return a finite nonnegative value.");
    }
    return now;
  }

  #result(stepsRun: number, droppedSteps: number): AdvanceResult {
    return Object.freeze({
      state: this.#state,
      stepsRun,
      droppedSteps,
      tick: this.#tick,
      missedDeadlines: this.#missedDeadlines,
      droppedTimeMs: this.#droppedTimeMs
    });
  }

  #runCleanup(): void {
    if (this.#cleanupCalled) {
      return;
    }
    this.#cleanupCalled = true;
    this.#callbacks.dispose?.();
  }

  #fail(error: unknown): void {
    this.#state = "failed";
    try {
      this.#callbacks.onError(error);
    } finally {
      this.#runCleanup();
    }
  }
}

function freezeJson<T extends JsonValue>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    const seen = new WeakSet<object>();
    const freeze = (candidate: unknown): void => {
      if (
        candidate === null ||
        typeof candidate === "string" ||
        typeof candidate === "boolean"
      ) {
        return;
      }
      if (typeof candidate === "number") {
        if (!Number.isFinite(candidate)) {
          throw new TypeError("Snapshot numbers must be finite.");
        }
        return;
      }
      if (typeof candidate !== "object") {
        throw new TypeError("Snapshot values must be JSON-compatible.");
      }
      if (seen.has(candidate)) {
        throw new TypeError("Snapshot values must not contain cycles.");
      }
      seen.add(candidate);

      if (Array.isArray(candidate)) {
        for (const child of candidate) {
          freeze(child);
        }
      } else {
        const prototype = Object.getPrototypeOf(candidate);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError("Snapshot objects must be plain JSON objects.");
        }
        for (const key of Reflect.ownKeys(candidate)) {
          if (typeof key !== "string") {
            throw new TypeError("Snapshot object keys must be strings.");
          }
          freeze((candidate as Record<string, unknown>)[key]);
        }
      }
      Object.freeze(candidate);
      seen.delete(candidate);
    };

    freeze(value);
  } else if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Snapshot numbers must be finite.");
  } else if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" && value !== null) {
    throw new TypeError("Snapshot values must be JSON-compatible.");
  }
  return value as DeepReadonly<T>;
}
