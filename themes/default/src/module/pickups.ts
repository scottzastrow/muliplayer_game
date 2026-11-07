import type { ModuleContext, Point2 } from "@multiplayer-game/theme-sdk";
import {
  HEALTH_PICKUP_AMOUNT,
  MAX_PICKUPS_PER_SESSION,
  MAX_PLAYER_HEALTH,
  POWERUP_DURATION_TICKS
} from "./tuning.js";
import type { DefaultEntity, DefaultPickupState, DefaultPlayerState } from "./types.js";

export class DefaultPickupSimulator {
  constructor(readonly context: ModuleContext<DefaultEntity>) {}

  expireEffects(tick: number): void {
    for (const player of this.context.entities.values()) {
      if (player.state.kind !== "player" || !player.state.effects) {
        continue;
      }
      const effects = { ...player.state.effects };
      if ((effects.rapidFireExpiresAtTick ?? -1) <= tick) {
        delete effects.rapidFireExpiresAtTick;
      }
      if ((effects.spreadExpiresAtTick ?? -1) <= tick) {
        delete effects.spreadExpiresAtTick;
      }
      if (Object.keys(effects).length === Object.keys(player.state.effects).length) {
        continue;
      }
      this.context.entities.update(player.id, (current) => {
        if (current.state.kind !== "player") {
          return current;
        }
        const { effects: _expired, ...state } = current.state;
        return {
          ...current,
          state: Object.keys(effects).length > 0 ? { ...state, effects } : state
        };
      });
    }
  }

  claimAvailable(tick: number): void {
    let pickupsClaimed = 0;
    const pickups = this.context.entities.values().filter(
      (entity): entity is DefaultEntity & { state: DefaultPickupState } =>
        entity.state.kind === "pickup"
    );
    const players = this.context.entities.values().filter(
      (entity): entity is DefaultEntity & { state: DefaultPlayerState } =>
        entity.state.kind === "player" && entity.state.health > 0
    );
    for (const pickup of pickups) {
      if (pickupsClaimed >= MAX_PICKUPS_PER_SESSION) {
        break;
      }
      for (const player of players) {
        const currentPickup = this.context.entities.get(pickup.id);
        const currentPlayer = this.context.entities.get(player.id);
        if (
          !currentPickup ||
          currentPickup.state.kind !== "pickup" ||
          !currentPlayer ||
          currentPlayer.state.kind !== "player" ||
          currentPlayer.state.health <= 0 ||
          distance(currentPickup.position, currentPlayer.position) >
            currentPickup.radius + currentPlayer.radius
        ) {
          continue;
        }
        const updatedState = applyPickup(currentPlayer.state, currentPickup.state, tick);
        if (!updatedState) {
          continue;
        }
        this.context.entities.update(player.id, (current) => ({
          ...current,
          state: updatedState
        }));
        this.context.entities.remove(pickup.id);
        pickupsClaimed += 1;
        break;
      }
    }
  }
}

function applyPickup(
  state: DefaultPlayerState,
  pickup: DefaultPickupState,
  tick: number
): DefaultPlayerState | undefined {
  if (pickup.pickupType === "health") {
    const health = Math.min(MAX_PLAYER_HEALTH, state.health + HEALTH_PICKUP_AMOUNT);
    return health === state.health ? undefined : { ...state, health };
  }
  const effects = {
    ...state.effects,
    ...(pickup.pickupType === "rapid-fire"
      ? { rapidFireExpiresAtTick: tick + POWERUP_DURATION_TICKS }
      : { spreadExpiresAtTick: tick + POWERUP_DURATION_TICKS })
  };
  return { ...state, effects };
}

function distance(from: Point2, to: Point2): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}
