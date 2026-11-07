import {
  type GameModuleFactory,
  type GameModuleInstance,
  type ModuleContext,
  type RosterMember
} from "@multiplayer-game/theme-sdk";
import { JsonValueSchema, type JsonValue } from "@multiplayer-game/protocol";
import { z } from "zod";
import { DefaultPlayerActionSchema, type DefaultPlayerAction } from "./actions.js";
import type { DefaultEntity } from "./types.js";
import { DefaultEntitySimulator } from "./entities.js";
import { generateMap } from "./maps.js";

const DefaultSettingsSchema = z.record(z.string(), JsonValueSchema);

export interface DefaultModuleState extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
  readonly entities: JsonValue[];
}

export interface DefaultModuleSnapshot extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
  readonly entities: JsonValue[];
  readonly viewerAccountId: string;
  readonly viewerRole: "player" | "spectator";
}

export interface DefaultModuleResults extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
}

export const defaultModuleMetadata = Object.freeze({
  id: "default",
  version: "1.0.0",
  stateSchemaVersion: 1
});

export const defaultModuleFactory: GameModuleFactory<
  Record<string, JsonValue>,
  DefaultPlayerAction,
  DefaultModuleState,
  DefaultModuleSnapshot,
  DefaultModuleResults,
  DefaultEntity
> = Object.freeze({
  metadata: defaultModuleMetadata,
  validateSettings(settings: unknown): settings is Record<string, JsonValue> {
    return DefaultSettingsSchema.safeParse(settings).success;
  },
  create(
    _context: ModuleContext<DefaultEntity>,
    settings: Readonly<Record<string, JsonValue>>,
    roster: readonly RosterMember[],
    seed: number
  ): GameModuleInstance<
    DefaultPlayerAction,
    DefaultModuleState,
    DefaultModuleSnapshot,
    DefaultModuleResults
  > {
    if (!this.validateSettings(settings)) {
      throw new TypeError("Default theme settings must be a JSON object.");
    }
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("Default theme seed must be a safe integer.");
    }
    const rosterIds = new Set(roster.map((member) => member.accountId));
    if (rosterIds.size !== roster.length) {
      throw new TypeError("Default theme roster must contain unique accounts.");
    }

    let acceptedInputs = 0;
    let disposed = false;
    const simulator = new DefaultEntitySimulator(_context);
    return {
      stateSchemaVersion: defaultModuleMetadata.stateSchemaVersion,
      get state() {
        return Object.freeze({
          acceptedInputs,
          entities: serializeEntities(_context.entities.values())
        });
      },
      validateInput(input: unknown): input is DefaultPlayerAction {
        return DefaultPlayerActionSchema.safeParse(input).success;
      },
      applyInput(accountId: string, input: Readonly<DefaultPlayerAction>): void {
        assertActive();
        if (!rosterIds.has(accountId)) {
          throw new RangeError("Input account is not part of this session roster.");
        }
        if (!DefaultPlayerActionSchema.safeParse(input).success) {
          throw new TypeError("Input does not match the default theme action schema.");
        }
        simulator.applyInput(accountId, input);
        acceptedInputs += 1;
      },
      step(dtSeconds: number, tick: number): void {
        assertActive();
        simulator.step(dtSeconds, tick);
      },
      initialize(): void {
        assertActive();
        simulator.initialize(generateMap(seed).map, roster);
      },
      snapshot(viewer): DefaultModuleSnapshot {
        assertActive();
        return {
          acceptedInputs,
          entities: serializeEntities(_context.entities.values()),
          viewerAccountId: viewer.accountId,
          viewerRole: viewer.role
        };
      },
      results(): DefaultModuleResults {
        assertActive();
        return { acceptedInputs };
      },
      dispose(): void {
        simulator.dispose();
        disposed = true;
      }
    };

    function assertActive(): void {
      if (disposed) {
        throw new Error("Default theme module instance has been disposed.");
      }
    }
  }
});

export { DefaultPlayerActionSchema, type DefaultPlayerAction };
export {
  DefaultEntitySimulator,
  defaultContactAttackCapability,
  normalizeMovement
} from "./entities.js";
export type { DefaultContactAttackCapability } from "./entities.js";

function serializeEntities(entities: readonly Readonly<DefaultEntity>[]): JsonValue[] {
  return entities.map((entity) => ({
    id: entity.id,
    typeId: entity.typeId,
    position: { x: entity.position.x, y: entity.position.y },
    radius: entity.radius,
    state: structuredClone(entity.state)
  }));
}
