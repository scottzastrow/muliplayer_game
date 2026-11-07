import type { JsonValue } from "@multiplayer-game/protocol";
import type { Point2 } from "@multiplayer-game/theme-sdk";

export interface DefaultPlayerState extends Record<string, JsonValue> {
  readonly kind: "player";
  readonly accountId: string;
  readonly health: number;
}

export interface DefaultNpcState extends Record<string, JsonValue> {
  readonly kind: "npc";
  readonly attackCapability: Readonly<{
    typeId: "default.contact-attack";
    damage: number;
    cooldownTicks: number;
  }>;
}

export interface DefaultEntity {
  readonly id: string;
  readonly typeId: "player" | "npc";
  readonly position: Point2;
  readonly radius: number;
  readonly state: DefaultPlayerState | DefaultNpcState;
}
