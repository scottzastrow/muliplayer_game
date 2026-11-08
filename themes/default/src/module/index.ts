import {
  type GameModuleFactory,
  type GameModuleInstance,
  type ModuleContext,
  type RosterMember
} from "@multiplayer-game/theme-sdk";
import { JsonValueSchema, type JsonValue } from "@multiplayer-game/protocol";
import { z } from "zod";
import { DefaultPlayerActionSchema, type DefaultPlayerAction } from "./actions.js";
import type { DefaultEntity, DefaultPlayerState } from "./types.js";
import { DefaultEntitySimulator } from "./entities.js";
import { DefaultCombatSimulator } from "./combat.js";
import { generateMap } from "./maps.js";
import { DefaultRespawnSimulator } from "./respawn.js";
import {
  DefaultProgression,
  resolveDefaultSettings,
  type DefaultLevelPhase
} from "./progression.js";

const DefaultSettingsSchema = z.record(z.string(), JsonValueSchema);

export interface DefaultModuleState extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
  readonly entities: JsonValue[];
  readonly players: JsonValue[];
  readonly map: JsonValue;
  readonly tick: number;
  readonly level: number;
  readonly phase: DefaultLevelPhase;
  readonly intermissionEndsAtTick?: number;
  readonly waveRemainingSeconds?: number;
}

export interface DefaultModuleSnapshot extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
  readonly entities: JsonValue[];
  readonly players: JsonValue[];
  readonly map: JsonValue;
  readonly tick: number;
  readonly viewerAccountId: string;
  readonly viewerRole: "player" | "spectator";
  readonly level: number;
  readonly phase: DefaultLevelPhase;
  readonly intermissionEndsAtTick?: number;
  readonly waveRemainingSeconds?: number;
}

export interface DefaultModuleResults extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
  readonly finalLevel: number;
  readonly status: "running" | "finished";
  readonly standings: JsonValue[];
}

export const defaultModuleMetadata = Object.freeze({
  id: "default",
  version: "1.0.0",
  stateSchemaVersion: 4
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
    let currentTick = 0;
    let disposed = false;
    const gameSettings = resolveDefaultSettings(settings, roster.length);
    const simulator = new DefaultEntitySimulator(_context);
    const map = generateMap(seed).map;
    const presentationMap = {
      width: map.definition.bounds.width,
      height: map.definition.bounds.height,
      obstacles: map.obstacles.map((obstacle) => ({ ...obstacle }))
    };
    const respawn = new DefaultRespawnSimulator(
      _context, map, roster, gameSettings.respawnDelaySeconds,
      (accountId) => {
        simulator.resetPlayerInput(accountId);
        combat.resetPlayerInput(accountId);
      }
    );
    const combat = new DefaultCombatSimulator(_context, (accountId) => respawn.awardKill(accountId));
    const progression = new DefaultProgression(
      _context,
      gameSettings,
      roster.length,
      (level, difficulty) => {
        if (level === 1) {
          simulator.initialize(map, roster, difficulty.npcCount, difficulty.npcHealth);
        } else {
          simulator.startLevel(level, difficulty.npcCount, difficulty.npcHealth);
        }
      }
    );
    return {
      stateSchemaVersion: defaultModuleMetadata.stateSchemaVersion,
      get state() {
        const progressionState = progression.state;
        return Object.freeze({
          acceptedInputs,
          entities: serializeEntities(_context.entities.values()),
          players: respawn.snapshot(),
          map: structuredClone(presentationMap),
          tick: currentTick,
          level: progressionState.level,
          phase: progressionState.phase,
          ...(progressionState.waveRemainingSeconds === undefined
            ? {}
            : { waveRemainingSeconds: progressionState.waveRemainingSeconds }),
          ...(progressionState.intermissionEndsAtTick === undefined
            ? {}
            : { intermissionEndsAtTick: progressionState.intermissionEndsAtTick })
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
        if (respawn.isDefeated(accountId)) return;
        simulator.applyInput(accountId, input);
        if (input.type === "combat") {
          combat.applyInput(accountId, { x: input.aimX, y: input.aimY }, input.fire);
        }
        acceptedInputs += 1;
      },
      setPlayerPresence(accountId, presence): void {
        assertActive();
        respawn.setPresence(accountId, presence, currentTick);
      },
      step(dtSeconds: number, tick: number): void {
        assertActive();
        currentTick = tick;
        progression.checkExpiry();
        if (progression.state.phase !== "complete") {
          respawn.removeDefeated(tick);
          respawn.respawnEligible(tick);
        }
        if (progression.state.phase === "active") {
          simulator.step(dtSeconds, tick);
          combat.step(tick);
          respawn.removeDefeated(tick);
        }
        progression.step(
          tick,
          _context.entities.values().filter((entity) => entity.state.kind === "npc").length
        );
        if (progression.state.phase !== "active") {
          combat.clearProjectiles();
        }
      },
      initialize(): void {
        assertActive();
        progression.initialize();
        respawn.initialize();
      },
      snapshot(viewer): DefaultModuleSnapshot {
        assertActive();
        const progressionState = progression.state;
        return {
          acceptedInputs,
          entities: serializeEntities(_context.entities.values()),
          players: respawn.snapshot(),
          map: structuredClone(presentationMap),
          tick: currentTick,
          viewerAccountId: viewer.accountId,
          viewerRole: viewer.role,
          level: progressionState.level,
          phase: progressionState.phase,
          ...(progressionState.waveRemainingSeconds === undefined
            ? {}
            : { waveRemainingSeconds: progressionState.waveRemainingSeconds }),
          ...(progressionState.intermissionEndsAtTick === undefined
            ? {}
            : { intermissionEndsAtTick: progressionState.intermissionEndsAtTick })
        };
      },
      results(): DefaultModuleResults {
        assertActive();
        return {
          acceptedInputs,
          finalLevel: progression.state.level,
          status: progression.state.phase === "complete" ? "finished" : "running",
          standings: collectStandings(roster, respawn.playerStates())
        };
      },
      dispose(): void {
        combat.dispose();
        simulator.dispose();
        respawn.dispose();
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
export { DefaultCombatSimulator } from "./combat.js";
export { DefaultPickupSimulator } from "./pickups.js";
export { DefaultRespawnSimulator } from "./respawn.js";
export {
  DefaultProgression,
  LEVEL_INTERMISSION_TICKS,
  calculateWaveDurationSeconds,
  WAVE_BASE_DURATION_SECONDS,
  WAVE_SECONDS_PER_NPC,
  WAVE_MAX_DURATION_SECONDS,
  resolveDefaultSettings,
  type DefaultLevelPhase,
  type DefaultProgressionState
} from "./progression.js";

function serializeEntities(entities: readonly Readonly<DefaultEntity>[]): JsonValue[] {
  return entities.map((entity) => ({
    id: entity.id,
    typeId: entity.typeId,
    position: { x: entity.position.x, y: entity.position.y },
    radius: entity.radius,
    state: structuredClone(entity.state)
  }));
}

function collectStandings(
  roster: readonly RosterMember[],
  states: readonly DefaultPlayerState[]
): JsonValue[] {
  const players = new Map(states.map((state) => [state.accountId, state]));
  const standings = roster.map((member) => {
    const player = players.get(member.accountId);
    return {
      accountId: member.accountId,
      username: member.username,
      points: player?.points ?? 0,
      kills: player?.kills ?? 0,
      deaths: player?.deaths ?? 0
    };
  });
  standings.sort(
    (left, right) =>
      right.points - left.points ||
      right.kills - left.kills ||
      left.deaths - right.deaths ||
      compareText(left.username.toLowerCase(), right.username.toLowerCase())
  );
  return standings.map((standing, index) => ({ ...standing, rank: index + 1 }));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
