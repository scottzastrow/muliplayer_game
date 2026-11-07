import type { JsonValue } from "@multiplayer-game/protocol";
import type { Point2 } from "@multiplayer-game/theme-sdk";

export interface DefaultPlayerState extends Record<string, JsonValue> {
  readonly kind: "player";
  readonly accountId: string;
  readonly health: number;
  readonly points: number;
  readonly kills: number;
  readonly deaths: number;
  readonly effects?: Readonly<{
    rapidFireExpiresAtTick?: number;
    spreadExpiresAtTick?: number;
  }>;
}

export interface DefaultNpcState extends Record<string, JsonValue> {
  readonly kind: "npc";
  readonly health: number;
  readonly attackCapability: Readonly<{
    typeId: "default.contact-attack";
    damage: number;
    cooldownTicks: number;
  }>;
}

export interface DefaultProjectileState extends Record<string, JsonValue> {
  readonly kind: "projectile";
  readonly ownerAccountId: string;
  readonly damage: number;
  readonly velocity: Readonly<{ x: number; y: number }>;
  readonly expiresAtTick: number;
}

export interface DefaultPickupState extends Record<string, JsonValue> {
  readonly kind: "pickup";
  readonly pickupType: "health" | "rapid-fire" | "spread";
}

export interface DefaultEntity {
  readonly id: string;
  readonly typeId: "player" | "npc" | `pickup.${DefaultPickupState["pickupType"]}` | "projectile.player";
  readonly position: Point2;
  readonly radius: number;
  readonly state:
    | DefaultPlayerState
    | DefaultNpcState
    | DefaultPickupState
    | DefaultProjectileState;
}
