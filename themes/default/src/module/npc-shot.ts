import type { ModuleContext, Point2 } from "@multiplayer-game/theme-sdk";
import type { DefaultEntity } from "./types.js";
import { NPC_FRONT_SIZE } from "./tuning.js";

export const NPC_PROJECTILE_RADIUS = NPC_FRONT_SIZE / Math.SQRT2;

export function hasNpcShot(
  context: ModuleContext<DefaultEntity>, from: Point2, to: Point2
): boolean {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / NPC_PROJECTILE_RADIUS);
  for (let index = 0; index <= steps; index++) {
    const fraction = steps === 0 ? 0 : index / steps;
    const x = from.x + (to.x - from.x) * fraction;
    const y = from.y + (to.y - from.y) * fraction;
    if (!context.geometry.isWalkable(x, y, NPC_PROJECTILE_RADIUS) ||
      context.geometry.intersectsObstacle(x, y, NPC_PROJECTILE_RADIUS)) return false;
  }
  return true;
}
