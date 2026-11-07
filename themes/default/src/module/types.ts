import type { JsonValue } from "@multiplayer-game/protocol";

export interface DefaultEntity {
  readonly id: string;
  readonly typeId?: string;
  readonly state?: JsonValue;
}
