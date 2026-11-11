import type { MonotonicClock } from "./index.js";

export class Countdown {
  readonly deadlineMs: number;

  constructor(readonly clock: MonotonicClock, durationSeconds: number) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError("Countdown duration must be positive and finite.");
    }
    this.deadlineMs = this.#nowMs() + durationSeconds * 1000;
    if (!Number.isFinite(this.deadlineMs)) {
      throw new RangeError("Countdown deadline must be finite.");
    }
  }

  get remainingSeconds(): number {
    return Math.max(0, (this.deadlineMs - this.#nowMs()) / 1000);
  }

  get expired(): boolean {
    return this.remainingSeconds === 0;
  }

  #nowMs(): number {
    const now = this.clock.nowMs();
    if (!Number.isFinite(now)) {
      throw new RangeError("Countdown clock must return finite milliseconds.");
    }
    return now;
  }
}
