import { describe, expect, it } from "vitest";
import {
  FIXED_STEP_SECONDS,
  MAX_CATCH_UP_STEPS,
  SeededRandom,
  SessionRunner
} from "../packages/engine/src/runner.js";

class FakeClock {
  value = 0;

  nowMs(): number {
    return this.value;
  }
}

describe("bounded session runner", () => {
  it("uses fixed steps, caps catch-up work, and records dropped time", () => {
    const clock = new FakeClock();
    const steps: Array<{ dt: number; tick: number }> = [];
    const runner = new SessionRunner({
      clock,
      callbacks: {
        step: (dt, tick) => steps.push({ dt, tick }),
        snapshot: () => ({ tick: steps.length }),
        onError: (error) => {
          throw error;
        }
      }
    });

    clock.value = 501;
    const result = runner.advance();
    expect(result.stepsRun).toBe(MAX_CATCH_UP_STEPS);
    expect(result.droppedSteps).toBe(12);
    expect(result.missedDeadlines).toBe(12);
    expect(result.tick).toBe(3);
    expect(result.droppedTimeMs).toBeCloseTo(12 * FIXED_STEP_SECONDS * 1_000);
    expect(steps.every((step, index) => step.dt === FIXED_STEP_SECONDS && step.tick === index + 1)).toBe(
      true
    );
  });

  it("returns recursively frozen snapshot copies", () => {
    const runner = new SessionRunner({
      clock: new FakeClock(),
      callbacks: {
        step: () => {},
        snapshot: () => ({ player: { points: 10 } }),
        onError: (error) => {
          throw error;
        }
      }
    });

    const first = runner.snapshot();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.player)).toBe(true);
    expect(Reflect.set(first.player, "points", 99)).toBe(false);
    expect(runner.snapshot().player.points).toBe(10);
    runner.dispose();
  });

  it("reports step exceptions, fails the runner, and disposes once", () => {
    const failure = new Error("module failed");
    const reported: unknown[] = [];
    let disposed = 0;
    const clock = new FakeClock();
    const runner = new SessionRunner({
      clock,
      callbacks: {
        step: () => {
          throw failure;
        },
        snapshot: () => null,
        onError: (error) => reported.push(error),
        dispose: () => {
          disposed += 1;
        }
      }
    });

    clock.value = 34;
    const result = runner.advance();
    expect(result.state).toBe("failed");
    expect(result.stepsRun).toBe(0);
    expect(reported).toEqual([failure]);
    expect(disposed).toBe(1);
    expect(runner.advance().state).toBe("failed");
  });

  it("reports invalid snapshots instead of returning mutable or non-JSON state", () => {
    const failureReports: unknown[] = [];
    let disposed = 0;
    const runner = new SessionRunner({
      clock: new FakeClock(),
      callbacks: {
        step: () => {},
        snapshot: () => ({ value: Number.NaN }),
        onError: (error) => failureReports.push(error),
        dispose: () => {
          disposed += 1;
        }
      }
    });

    expect(() => runner.snapshot()).toThrow(/finite/);
    expect(runner.state).toBe("failed");
    expect(failureReports).toHaveLength(1);
    expect(disposed).toBe(1);
  });

  it("generates repeatable random streams from the same seed", () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 10 }, () => first.next())).toEqual(
      Array.from({ length: 10 }, () => second.next())
    );
  });
});
