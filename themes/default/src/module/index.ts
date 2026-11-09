import {
  type GameModuleFactory,
  type GameModuleInstance,
  type ModuleContext,
  type RadarView,
  type RosterMember
} from "@multiplayer-game/theme-sdk";
import { JsonValueSchema, resolveTerrainDensity, type JsonValue } from "@multiplayer-game/protocol";
import { z } from "zod";
import { DefaultPlayerActionSchema, type DefaultPlayerAction } from "./actions.js";
import type { DefaultEntity, DefaultPlayerState } from "./types.js";
import { DefaultEntitySimulator } from "./entities.js";
import { DefaultCombatSimulator } from "./combat.js";
import { generateMap, generateDensityMap, loadMap, type DensityMap } from "./maps.js";
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
  readonly startingNpcCount: number;
  readonly livingNpcCount: number;
  readonly levelStandings: JsonValue[];
  readonly intermissionEndsAtTick?: number;
  readonly waveRemainingSeconds?: number;
}

export interface DefaultModuleSnapshot extends Record<string, JsonValue> {
  readonly acceptedInputs: number;
  readonly entities: JsonValue[];
  readonly players: JsonValue[];
  readonly radar: ReturnType<typeof serializeRadar>;
  readonly map: JsonValue;
  readonly tick: number;
  readonly viewerAccountId: string;
  readonly viewerRole: "player" | "spectator";
  readonly level: number;
  readonly phase: DefaultLevelPhase;
  readonly startingNpcCount: number;
  readonly livingNpcCount: number;
  readonly levelStandings: JsonValue[];
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
  createInitialMap(settings: Readonly<Record<string, JsonValue>>, seed: number) {
    if (settings.mapMode === "simple-generated") {
      return generateDensityMap(seed, 1, resolveTerrainDensity(
        settings.terrainDensity, 1, Number(settings.maxLevels ?? 5)
      )).map.definition;
    }
    return settings.mapMode === "fixed" ? generateMap(seed, "fixed").map.definition : undefined;
  },
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
    let levelStartingPoints = new Map<string, number>();
    const gameSettings = resolveDefaultSettings(settings, roster.length);
    const simulator = new DefaultEntitySimulator(
      _context,
      gameSettings.npcMovementSpeed,
      gameSettings.npcDetectionRange,
      seed
    );
    const usesDensity = gameSettings.mapMode === "simple-generated";
    if (usesDensity && !_context.maps) {
      throw new Error("Simple Generated density requires the authoritative map transition service.");
    }
    let coverage: DensityMap["terrain"] | undefined;
    let pending: { layout: DensityMap; token: number } | undefined;
    let map = "defaultMapDefinition" in _context
      ? loadMap(_context.defaultMapDefinition)
      : loadMap(this.createInitialMap?.(settings, seed) ?? generateMap(seed).map.definition);
    if (usesDensity) {
      const density = resolveTerrainDensity(gameSettings.terrainDensity, 1, gameSettings.maxLevels);
      const actualCoveragePercent = map.obstacles.reduce((sum, rect) =>
        sum + rect.width * rect.height, 0) / (map.definition.bounds.width * map.definition.bounds.height) * 100;
      coverage = { level: 1, density, targetCoveragePercent: density * 8, actualCoveragePercent,
        budgetExhausted: actualCoveragePercent + 100 / 4096 < density * 8 };
    }
    const presentationMap = () => ({
      width: map.definition.bounds.width,
      height: map.definition.bounds.height,
      obstacles: map.obstacles.map((obstacle) => ({ ...obstacle })),
      ...(coverage ? { terrain: { ...coverage } } : {})
    });
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
          if (usesDensity) commitNextLayout(level);
          simulator.startLevel(level, difficulty.npcCount, difficulty.npcHealth, map);
        }
        levelStartingPoints = new Map(respawn.playerStates().map(player =>
          [player.accountId, player.points]));
      },
      usesDensity ? prepareNextLayout : undefined
    );
    return {
      stateSchemaVersion: defaultModuleMetadata.stateSchemaVersion,
      get state() {
        const progressionState = progression.state;
        return Object.freeze({
          acceptedInputs,
          entities: serializeEntities(_context.entities.values()),
          players: respawn.snapshot(),
          map: presentationMap(),
          tick: currentTick,
          level: progressionState.level,
          phase: progressionState.phase,
          ...waveSummary(),
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
        if (coverage) reportCoverage();
      },
      snapshot(viewer): DefaultModuleSnapshot {
        assertActive();
        const progressionState = progression.state;
        return {
          acceptedInputs,
          entities: serializeEntities(_context.entities.values()),
          players: respawn.snapshot(),
          radar: serializeRadar(_context.entities.values(), viewer.accountId, map.obstacles),
          map: presentationMap(),
          tick: currentTick,
          viewerAccountId: viewer.accountId,
          viewerRole: viewer.role,
          level: progressionState.level,
          phase: progressionState.phase,
          ...waveSummary(),
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

    function prepareNextLayout(level: number): void {
      const layout = generateDensityMap(seed, level,
        resolveTerrainDensity(gameSettings.terrainDensity, level, gameSettings.maxLevels));
      const token = _context.maps!.prepare({
        bounds: layout.map.definition.bounds, cellSize: layout.map.definition.cellSize,
        obstacles: layout.map.obstacles
      });
      pending = { layout, token };
      _context.metrics.increment("default.map.prepared");
    }

    function commitNextLayout(level: number): void {
      if (!pending || pending.layout.terrain.level !== level) {
        throw new Error("The next level terrain was not prepared during intermission.");
      }
      const nextMap = pending.layout.map;
      const spawns = nextMap.definition.spawns.filter(spawn => spawn.kind === "player");
      const replacements = _context.entities.values().flatMap(entity => {
        if (entity.state.kind === "player") {
          const accountId = entity.state.accountId;
          const index = roster.findIndex(member => member.accountId === accountId);
          const spawn = spawns[index];
          if (!spawn) throw new Error("New map has insufficient player spawns.");
          return [{ ...entity, position: spawn.position }];
        }
        if (entity.state.kind === "pickup") {
          const spawn = nextMap.definition.spawns.find(spawn => `pickup:${spawn.id}` === entity.id);
          if (!spawn) throw new Error("New map has no retained pickup spawn.");
          return [{ ...entity, position: spawn.position }];
        }
        return [];
      });
      _context.maps!.commit(pending.token, replacements);
      map = nextMap;
      coverage = pending.layout.terrain;
      pending = undefined;
      respawn.setMap(map);
      reportCoverage();
    }

    function reportCoverage(): void {
      if (!coverage) throw new Error("Density coverage is unavailable.");
      _context.metrics.gauge("default.map.actual_coverage_percent", coverage.actualCoveragePercent);
      _context.metrics.gauge("default.map.target_coverage_percent", coverage.targetCoveragePercent);
      if (coverage.budgetExhausted) _context.metrics.increment("default.map.density_shortfall");
    }

    function waveSummary() {
      const players = respawn.playerStates();
      return {
        startingNpcCount: progression.state.startingNpcCount,
        livingNpcCount: _context.entities.values().filter(entity =>
          entity.state.kind === "npc" && entity.state.health > 0).length,
        levelStandings: collectStandings(roster, players).map(standing => {
          const player = players.find(item => item.accountId === standing.accountId);
          return {
            ...standing,
            levelPoints: (player?.points ?? 0) - (levelStartingPoints.get(standing.accountId) ?? 0)
          };
        })
      };
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

function serializeRadar(
  entities: readonly Readonly<DefaultEntity>[],
  viewerAccountId: string,
  obstacles: readonly { x: number; y: number; width: number; height: number }[]
) {
  return {
    categories: ["player", "enemy", "pickup", "terrain"],
    markers: [
      ...entities.flatMap((entity) => {
        const state = entity.state;
        const category = state.kind === "npc" && state.health > 0 ? "enemy"
          : state.kind === "player" && state.health > 0 && state.accountId !== viewerAccountId ? "player"
          : state.kind === "pickup" ? "pickup" : undefined;
        return category ? [{ id: entity.id, category, position: { ...entity.position } }] : [];
      }),
      ...obstacles.map((obstacle, index) => ({
        id: `terrain:${index}`, category: "terrain",
        position: { x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 },
        footprint: { width: obstacle.width, height: obstacle.height }
      }))
    ]
  } satisfies RadarView;
}

function collectStandings(
  roster: readonly RosterMember[],
  states: readonly DefaultPlayerState[]
) {
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
