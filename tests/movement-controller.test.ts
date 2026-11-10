import { describe, expect, it } from "vitest";
import { MovementController, type MovementControllerOptions } from "@multiplayer-game/theme-sdk";

describe("public movement controller", () => {
  it("defaults to unsteered movement for existing games", () => {
    const controller = new MovementController();
    expect(controller.facingMovementBlend).toBe(0);
    expect(controller.resolveMovement({ x: 0.4, y: 0 }, { x: 0, y: -1 }))
      .toEqual({ x: 0.4, y: 0 });
  });

  it.each([-0.01, 1.01, NaN, Infinity, -Infinity, null, "0.40"])(
    "rejects invalid facingMovementBlend %s", facingMovementBlend => {
      // Exercise invalid JavaScript callers as well as typed consumers.
      // @ts-expect-error Deliberately include nonnumeric runtime options.
      const options: MovementControllerOptions = { facingMovementBlend };
      expect(() => new MovementController(options)).toThrow(/facingMovementBlend/);
    }
  );

  it.each([0, 0.4, 1])("accepts blend %s and preserves partial analog magnitude", blend => {
    const controller = new MovementController({ facingMovementBlend: blend });
    const movement = Object.freeze({ x: 0.4, y: 0 });
    const facing = Object.freeze({ x: 0, y: -3 });
    for (let step = 0; step < 10; step++) {
      const resolved = controller.resolveMovement(movement, facing);
      expect(Math.atan2(resolved.y, resolved.x) * 180 / Math.PI).toBeCloseTo(-90 * blend, 10);
      expect(Math.hypot(resolved.x, resolved.y)).toBeCloseTo(0.4, 10);
    }
    expect(movement).toEqual({ x: 0.4, y: 0 });
    expect(facing).toEqual({ x: 0, y: -3 });
  });

  it.each([
    { input: 170, facing: -170, expected: 178 },
    { input: -170, facing: 170, expected: -178 }
  ])("takes the shortest signed turn from $input to $facing", scenario => {
    const vector = (angle: number) => ({
      x: Math.cos(angle * Math.PI / 180), y: Math.sin(angle * Math.PI / 180)
    });
    const result = new MovementController({ facingMovementBlend: 0.4 })
      .resolveMovement(vector(scenario.input), vector(scenario.facing));
    expect(Math.atan2(result.y, result.x) * 180 / Math.PI).toBeCloseTo(scenario.expected, 10);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(1, 10);
  });

  it("keeps stationary input stationary and zero-facing input unsteered", () => {
    const controller = new MovementController({ facingMovementBlend: 1 });
    expect(controller.resolveMovement({ x: 0, y: 0 }, { x: 0, y: -1 }))
      .toEqual({ x: 0, y: 0 });
    expect(controller.resolveMovement({ x: 0.3, y: -0.4 }, { x: 0, y: 0 }))
      .toEqual({ x: 0.3, y: -0.4 });
  });

  it("captures validated options without retaining mutable configuration", () => {
    const options = { facingMovementBlend: 0.4 };
    const controller = new MovementController(options);
    options.facingMovementBlend = 2;
    expect(controller.facingMovementBlend).toBe(0.4);
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite vector components %s", value => {
    const controller = new MovementController();
    expect(() => controller.resolveMovement({ x: value, y: 0 }, { x: 1, y: 0 }))
      .toThrow(/finite/);
    expect(() => controller.resolveMovement({ x: 0, y: value }, { x: 1, y: 0 }))
      .toThrow(/finite/);
    expect(() => controller.resolveMovement({ x: 1, y: 0 }, { x: value, y: 0 }))
      .toThrow(/finite/);
    expect(() => controller.resolveMovement({ x: 1, y: 0 }, { x: 0, y: value }))
      .toThrow(/finite/);
  });
});
