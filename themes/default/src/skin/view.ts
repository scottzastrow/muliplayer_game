import { z } from "zod";
import { MAX_MAP_COLLISIONS, RadarViewSchema } from "@multiplayer-game/theme-sdk";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const counter = z.number().int().nonnegative().safe();
const entity = z.object({
  id: z.string().min(1),
  position: point,
  radius: z.number().finite().positive().max(64),
  state: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("player"), accountId: z.string(), deaths: counter,
      color: z.string().min(1).optional(), facing: point.optional()
    }),
    z.object({ kind: z.literal("npc"), health: z.number().finite().nonnegative() }),
    z.object({ kind: z.literal("projectile") }),
    z.object({ kind: z.literal("pickup"), pickupType: z.enum(["health", "rapid-fire", "spread"]) })
  ])
});

export const DefaultViewSchema = z.object({
  viewerAccountId: z.string().min(1),
  viewerRole: z.enum(["player", "spectator"]),
  spectatorView: z.object({
    targetAccountId: z.string().min(1), cameraAnchor: point,
    hud: z.object({ points: counter, health: z.number().finite().nonnegative() }),
    death: z.object({ alive: z.boolean(), remainingSeconds: z.number().finite().nonnegative(),
      respawnAtTick: counter.optional(), respawnBlocked: z.boolean().optional() })
  }).optional(),
  tick: counter,
  level: z.number().int().positive(),
  phase: z.enum(["active", "intermission", "complete"]),
  intermissionEndsAtTick: counter.optional(),
  waveRemainingSeconds: z.number().finite().nonnegative().max(300).optional(),
  radar: RadarViewSchema.optional(),
  map: z.object({
    width: z.number().finite().positive().max(2048),
    height: z.number().finite().positive().max(2048),
    obstacles: z.array(z.object({
      x: z.number().finite(), y: z.number().finite(),
      width: z.number().finite().positive(), height: z.number().finite().positive()
    })).max(MAX_MAP_COLLISIONS)
  }),
  entities: z.array(entity).max(3200),
  players: z.array(z.object({
    accountId: z.string().min(1),
    position: point,
    color: z.string().min(1).optional(),
    facing: point.optional(),
    health: z.number().finite().nonnegative(),
    points: counter,
    deaths: counter,
    alive: z.boolean(),
    respawnAtTick: counter.optional(),
    respawnBlocked: z.boolean().optional()
  })).max(32)
});

export type DefaultView = z.infer<typeof DefaultViewSchema>;
export type ViewEntity = DefaultView["entities"][number];

export function interpolateEntities(
  previous: DefaultView | undefined,
  current: DefaultView,
  alpha: number
): ViewEntity[] {
  const amount = Math.max(0, Math.min(1, alpha));
  const oldEntities = new Map(previous?.entities.map((item) => [item.id, item]));
  return current.entities.map((item) => {
    const old = oldEntities.get(item.id);
    if (
      !old || previous?.level !== current.level || old.state.kind !== item.state.kind ||
      (old.state.kind === "player" && item.state.kind === "player" &&
        old.state.deaths !== item.state.deaths)
    ) return item;
    return {
      ...item,
      position: {
        x: old.position.x + (item.position.x - old.position.x) * amount,
        y: old.position.y + (item.position.y - old.position.y) * amount
      }
    };
  });
}

export function worldToScreen(
  position: Readonly<{ x: number; y: number }>,
  camera: Readonly<{ x: number; y: number }>,
  width: number,
  height: number
): { x: number; y: number } {
  return { x: position.x - camera.x + width / 2, y: position.y - camera.y + height / 2 };
}
