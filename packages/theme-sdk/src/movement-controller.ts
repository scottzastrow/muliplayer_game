import type { Point2 } from "./index.js";

export interface MovementControllerOptions {
  readonly facingMovementBlend?: number;
}

export class MovementController {
  readonly facingMovementBlend: number;

  constructor({ facingMovementBlend = 0 }: MovementControllerOptions = {}) {
    if (!Number.isFinite(facingMovementBlend) || facingMovementBlend < 0 || facingMovementBlend > 1) {
      throw new RangeError("facingMovementBlend must be finite and between 0 and 1.");
    }
    this.facingMovementBlend = facingMovementBlend;
  }

  resolveMovement(movement: Point2, facing: Point2): Point2 {
    const magnitude = Math.hypot(movement.x, movement.y);
    const facingMagnitude = Math.hypot(facing.x, facing.y);
    if (![movement.x, movement.y, facing.x, facing.y, magnitude, facingMagnitude]
      .every(Number.isFinite)) {
      throw new RangeError("Movement and facing vectors must have finite components and magnitudes.");
    }
    if (magnitude === 0 || facingMagnitude === 0 || this.facingMovementBlend === 0) {
      return { x: movement.x, y: movement.y };
    }
    const movementX = movement.x / magnitude;
    const movementY = movement.y / magnitude;
    const facingX = facing.x / facingMagnitude;
    const facingY = facing.y / facingMagnitude;
    const difference = Math.atan2(
      movementX * facingY - movementY * facingX,
      movementX * facingX + movementY * facingY
    );
    const angle = Math.atan2(movement.y, movement.x) + difference * this.facingMovementBlend;
    return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
  }
}
