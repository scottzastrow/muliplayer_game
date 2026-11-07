import { z } from "zod";
import type { JsonValue } from "@multiplayer-game/protocol";

const counter = z.number().int().nonnegative().safe();
const playerSchema = z.object({
  accountId: z.string().min(1),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  health: z.number().finite().nonnegative(),
  points: counter,
  alive: z.boolean(),
  respawnAtTick: counter.optional(),
  respawnBlocked: z.boolean().optional()
});
const snapshotSchema = z.object({
  tick: counter,
  viewerAccountId: z.string().min(1),
  players: z.array(playerSchema).max(32)
});

export function createSpectatorView(
  targetAccountId: string,
  snapshot: Readonly<Record<string, JsonValue>>
): Readonly<Record<string, JsonValue>> {
  const parsed = snapshotSchema.parse(snapshot);
  const player = parsed.players.find(player => player.accountId === targetAccountId);
  if (parsed.viewerAccountId !== targetAccountId || !player ||
    (!player.alive && player.respawnAtTick === undefined)) {
    throw new TypeError("The module snapshot does not contain the selected player's view.");
  }
  return {
    ...snapshot,
    viewerAccountId: targetAccountId,
    viewerRole: "spectator",
    spectatorView: {
      targetAccountId,
      cameraAnchor: player.position,
      hud: { points: player.points, health: player.health },
      death: {
        alive: player.alive,
        remainingSeconds: player.alive ? 0 : Math.max(0, (player.respawnAtTick! - parsed.tick) / 30),
        ...(!player.alive ? {
          respawnAtTick: player.respawnAtTick!,
          respawnBlocked: player.respawnBlocked ?? false
        } : {})
      }
    }
  };
}
