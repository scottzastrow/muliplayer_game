import {
  BoundedNavigation,
  AuthoritativeMapTransition,
  FIXED_STEP_MS,
  SessionRunner,
  SeededRandom,
  SessionWorld,
  SystemMonotonicClock
} from "@multiplayer-game/engine";
import {
  GameSettingsSchema,
  JsonValueSchema,
  type GameSettings,
  type JsonValue
} from "@multiplayer-game/protocol";
import type {
  EntityStore,
  ModuleContext,
  ModuleMetrics,
  NavigationPathResult,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import {
  generateMap,
  loadMap,
  type DefaultEntity,
  type DefaultModuleSnapshot
} from "@multiplayer-game/default-theme";
import type { MapDefinition } from "@multiplayer-game/theme-sdk";
import type { SqliteDatabase } from "../storage/database.js";
import type { LobbyRegistry } from "../lobby/registry.js";
import type { ThemeLoader } from "../themes/builtins.js";
import type { ModuleInput } from "../transport/socket.js";
import type { RuntimeMetrics } from "./metrics.js";

const SNAPSHOT_INTERVAL_TICKS = 2;
const MAX_COMPLETION_REQUESTS_PER_STEP = 8;
const MAX_RETAINED_PATH_RESULTS = 256;

interface MatchRuntimeRow {
  settings_json: string;
  seed: number;
  theme_digest: string;
}

interface ParticipantRow {
  account_id: string;
  username: string;
  joined_order: number;
}

interface ActiveSession {
  readonly world: SessionWorld<DefaultEntity>;
  readonly id: string;
  readonly settings: GameSettings;
  readonly roster: readonly RosterMember[];
  readonly module: ReturnType<ThemeLoader["createModuleInstance"]>;
  readonly navigation: BoundedNavigation;
  readonly pathResults: Map<string, NavigationPathResult>;
  currentLevel: number;
  nextLevel?: number;
  completionRequests: Array<Readonly<{ kind: "level" | "match"; reason: string }>>;
  runner?: SessionRunner<JsonValue>;
  timer?: NodeJS.Timeout;
}

export type SnapshotPublisher = (
  sessionId: string,
  tick: number,
  moduleStateSchemaVersion: number,
  snapshotForAccount: (accountId: string) => DefaultModuleSnapshot
) => void;

export class SessionLifecycle {
  readonly #sessions = new Map<string, ActiveSession>();

  constructor(
    readonly database: SqliteDatabase,
    readonly lobby: LobbyRegistry,
    readonly themes: ThemeLoader,
    readonly publishSnapshot: SnapshotPublisher,
    readonly reportError: (error: unknown, sessionId: string) => void = () => {},
    readonly publishResult?: (sessionId: string, tick: number) => void,
    readonly metrics?: RuntimeMetrics,
    readonly publishFailure?: (sessionId: string) => void
  ) {}

  async start(sessionId: string): Promise<void> {
    if (this.#sessions.has(sessionId)) {
      throw new Error("Session simulation is already running.");
    }

    let module: ActiveSession["module"] | undefined;
    try {
      const { settings, seed, revision, themeDigest, roster } = this.#readRuntime(sessionId);
      const moduleSettings = JsonValueSchema.parse(settings);
      if (moduleSettings === null || typeof moduleSettings !== "object" || Array.isArray(moduleSettings)) {
        throw new TypeError("Module settings must be a JSON object.");
      }
      const initialMap = this.themes.resolvePinned(revision, themeDigest)
        .moduleFactory.createInitialMap?.(moduleSettings, seed);
      const selectedMap = initialMap
        ? { map: loadMap(initialMap), source: "generated" }
        : generateMap(seed);
      const map = selectedMap.map;
      const world = new SessionWorld<DefaultEntity>(
        sessionId,
        map.definition.bounds,
        map.obstacles,
        map.definition.cellSize
      );
      const navigation = new BoundedNavigation(world.geometry, {
        cellSize: map.definition.cellSize,
        agentRadius: 8
      });
      const pathResults = new Map<string, NavigationPathResult>();
      const completionRequests: ActiveSession["completionRequests"] = [];
      this.metrics?.startSession(sessionId);
      if (selectedMap.source === "fallback") {
        this.metrics?.moduleMetrics(sessionId).increment("default.map.fallback");
      }
      const context = createModuleContext(
        world,
        navigation,
        pathResults,
        seed,
        map.definition,
        (request) => {
          if (completionRequests.length >= MAX_COMPLETION_REQUESTS_PER_STEP) {
            throw new RangeError("The module exceeded its completion-request limit.");
          }
          completionRequests.push(request);
        },
        this.metrics?.moduleMetrics(sessionId)
      );
      module = this.themes.createModuleInstance(
        revision,
        context,
        moduleSettings,
        roster,
        seed,
        themeDigest
      );
      await module.initialize();
      if (!module.setPlayerPresence) throw new Error("The pinned module does not support reconnect presence.");
      for (const member of roster) module.setPlayerPresence(member.accountId, "disconnected");
      const active: ActiveSession = {
        world,
        id: sessionId,
        settings,
        roster,
        module,
        navigation,
        pathResults,
        currentLevel: 1,
        completionRequests
      };
      active.runner = new SessionRunner<JsonValue>({
        callbacks: {
          step: (dtSeconds, tick) => {
            const startedAt = performance.now();
            try {
              this.#step(active, dtSeconds, tick);
            } finally {
              this.metrics?.timing(active.id, "simulation", performance.now() - startedAt);
            }
          },
          snapshot: () => active.module.state ?? {},
          onError: (error) => this.#fail(active, error),
          dispose: () => active.module.dispose()
        }
      });
      this.#sessions.set(sessionId, active);
      this.lobby.reconnect.start(sessionId, roster.map(member => member.accountId));
      active.timer = setInterval(
        () => this.#advance(active),
        FIXED_STEP_MS
      );
    } catch (error) {
      const registered = this.#sessions.get(sessionId);
      if (registered) {
        try {
          this.#release(registered);
        } catch (disposeError) {
          this.reportError(disposeError, sessionId);
        }
      } else if (module) {
        try {
          module.dispose();
        } catch (disposeError) {
          this.reportError(disposeError, sessionId);
        }
      }
      this.lobby.markTerminal(sessionId, "failed");
      this.metrics?.releaseSession(sessionId);
      this.reportError(error, sessionId);
      throw error;
    }
  }

  applyInput(input: ModuleInput): boolean {
    const active = this.#sessions.get(input.sessionId);
    if (!active || !this.lobby.reconnect.connected(input.sessionId, input.accountId) ||
      !active.roster.some((member) => member.accountId === input.accountId)) {
      return false;
    }
    if (!active.module.validateInput(input.action)) {
      return false;
    }
    active.module.applyInput(input.accountId, input.action);
    return true;
  }

  setPlayerPresence(sessionId: string, accountId: string, presence: "connected" | "disconnected" | "expired"): void {
    const active = this.#sessions.get(sessionId);
    if (!active) return;
    try {
      if (!active.module.setPlayerPresence) throw new Error("The pinned module does not support reconnect presence.");
      active.module.setPlayerPresence(accountId, presence);
    } catch (error) {
      this.#fail(active, error);
    }
  }

  playerLives(sessionId: string): ReadonlyMap<string, "alive" | "dead" | "unavailable"> {
    const active = this.#sessions.get(sessionId);
    const lives = new Map<string, "alive" | "dead" | "unavailable">();
    if (!active) return lives;
    const snapshot = active.module.snapshot({ accountId: active.roster[0]!.accountId, role: "player" });
    for (const player of snapshot.players) {
      if (typeof player !== "object" || player === null || Array.isArray(player) ||
        typeof player.accountId !== "string" || typeof player.alive !== "boolean") {
        throw new TypeError("The active module returned an invalid player life state.");
      }
      lives.set(player.accountId, player.expired === true ? "unavailable" : player.alive ? "alive" : "dead");
    }
    return lives;
  }

  close(): void {
    for (const active of [...this.#sessions.values()]) {
      try {
        this.lobby.markTerminal(active.id, "interrupted");
      } finally {
        this.#release(active);
      }
    }
  }

  end(sessionId: string): void {
    const active = this.#sessions.get(sessionId);
    if (!active || !active.runner) throw new Error("Running session simulation could not be found.");
    try {
      const results = active.module.results();
      if (results.finalLevel !== active.currentLevel) {
        throw new Error("Module standings do not match the current level.");
      }
      this.#finalize(active, active.runner.tick, parseStandings(results.standings));
    } catch (error) {
      this.#fail(active, error);
      throw error;
    }
  }

  #readRuntime(sessionId: string): {
    readonly settings: GameSettings;
    readonly seed: number;
    readonly revision: string;
    readonly themeDigest: string;
    readonly roster: readonly RosterMember[];
  } {
    const match = this.database
      .prepare(
        `SELECT m.settings_json, m.seed, m.theme_digest
         FROM matches m
         WHERE m.id = ? AND m.state = 'running'`
      )
      .get(sessionId) as MatchRuntimeRow | undefined;
    if (!match) {
      throw new Error("Running session metadata could not be loaded.");
    }
    const theme = this.lobby.getPinnedTheme(sessionId);
    const revision = `${theme.theme_id}@${theme.version}`;
    const settings = GameSettingsSchema.parse(JSON.parse(match.settings_json));
    if (settings.themeRevision !== revision || theme.digest !== match.theme_digest) {
      throw new Error("Running session theme settings do not match its pinned revision.");
    }
    const rows = this.database
      .prepare(
        `SELECT p.account_id, a.username, p.joined_order
         FROM match_participants p
         JOIN accounts a ON a.id = p.account_id
         WHERE p.match_id = ?
         ORDER BY p.joined_order, p.account_id`
      )
      .all(sessionId) as ParticipantRow[];
    if (rows.length === 0 || rows.length > settings.maxPlayers) {
      throw new RangeError("Frozen session roster is empty or exceeds configured capacity.");
    }
    const roster = Object.freeze(
      rows.map((row) =>
        Object.freeze({
          accountId: row.account_id,
          username: row.username,
          joinedOrder: row.joined_order
        })
      )
    );
    return {
      settings,
      seed: match.seed,
      revision,
      themeDigest: theme.digest,
      roster
    };
  }

  #advance(active: ActiveSession): void {
    if (this.#sessions.get(active.id) !== active || !active.runner) {
      return;
    }
    try {
      const result = active.runner.advance();
      this.metrics?.runner(active.id, active.world.entityCount,
        result.tick, result.missedDeadlines, result.droppedTimeMs);
    } catch (error) {
      this.#fail(active, error);
    }
  }

  #step(active: ActiveSession, dtSeconds: number, tick: number): void {
    for (const accountId of this.lobby.reconnect.expire(active.id)) {
      this.setPlayerPresence(active.id, accountId, "expired");
    }
    if (this.lobby.reconnect.abandoned(active.id)) {
      this.lobby.markTerminal(active.id, "abandoned");
      this.#release(active);
      return;
    }
    if (this.#sessions.get(active.id) !== active) return;
    active.navigation.processTick();
    active.module.step(dtSeconds, tick);
    const level = active.module.state?.level;
    if (level !== active.currentLevel) {
      if (typeof level !== "number" || level !== active.nextLevel || active.module.state?.phase !== "active" ||
        !this.lobby.advanceLevel(active.id, active.currentLevel, level)) {
        throw new Error("Module advanced to an invalid level.");
      }
      active.currentLevel = level;
      delete active.nextLevel;
    }
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      const startedAt = performance.now();
      try {
        this.#publish(active, tick);
      } finally {
        this.metrics?.timing(active.id, "snapshot", performance.now() - startedAt);
      }
    }

    const requests = active.completionRequests.splice(0);
    for (const request of requests) {
      if (this.#sessions.get(active.id) !== active) return;
      if (request.kind === "level") {
        this.#advanceLevel(active);
      } else {
        this.#finishMatch(active, tick, request.reason);
      }
    }
  }

  #advanceLevel(active: ActiveSession): void {
    const state = active.module.state;
    if (
      state?.phase !== "intermission" ||
      state.level !== active.currentLevel ||
      active.nextLevel !== undefined ||
      active.currentLevel >= active.settings.maxLevels
    ) {
      throw new Error("Module requested an invalid or duplicate level transition.");
    }
    active.nextLevel = active.currentLevel + 1;
  }

  #finishMatch(active: ActiveSession, tick: number, reason: string): void {
    const state = active.module.state;
    const results = active.module.results();
    if (
      state?.phase !== "complete" ||
      state.level !== active.currentLevel ||
      results.status !== "finished" ||
      results.finalLevel !== active.currentLevel ||
      results.finalLevel > active.settings.maxLevels
    ) {
      throw new Error("Module requested match completion with an invalid phase or final level.");
    }
    if (tick % SNAPSHOT_INTERVAL_TICKS !== 0) {
      this.#publish(active, tick);
    }
    const standings = parseStandings(results.standings);
    this.#finalize(active, tick, standings, reason);
  }

  #finalize(active: ActiveSession, tick: number, standings: ReturnType<typeof parseStandings>,
    completionReason?: string): void {
    if (!this.lobby.finalizeFinishedMatch(active.id, active.currentLevel, standings, completionReason)) {
      throw new Error("Finished match result was already finalized or the match is no longer active.");
    }
    this.#release(active);
    this.publishResult?.(active.id, tick);
  }

  #publish(active: ActiveSession, tick: number): void {
    this.publishSnapshot(active.id, tick, active.module.stateSchemaVersion, (accountId) =>
      active.module.snapshot({ accountId, role: "player" })
    );
  }

  #fail(active: ActiveSession, error: unknown): void {
    if (this.#sessions.get(active.id) !== active) {
      return;
    }
    this.metrics?.event(active.id, "errors");
    this.reportError(error, active.id);
    try {
      this.lobby.markTerminal(active.id, "failed");
    } catch (finalizationError) {
      this.reportError(finalizationError, active.id);
    } finally {
      try {
        this.#release(active);
      } catch (disposeError) {
        this.reportError(disposeError, active.id);
      } finally {
        this.publishFailure?.(active.id);
      }
    }
  }

  #release(active: ActiveSession): void {
    if (active.timer) {
      clearInterval(active.timer);
      delete active.timer;
    }
    this.#sessions.delete(active.id);
    active.runner?.dispose();
    active.pathResults.clear();
    this.metrics?.releaseSession(active.id);
  }
}

function createModuleContext(
  world: SessionWorld<DefaultEntity>,
  navigation: BoundedNavigation,
  pathResults: Map<string, NavigationPathResult>,
  seed: number,
  defaultMapDefinition: MapDefinition,
  requestCompletion: ModuleContext<DefaultEntity>["requestCompletion"],
  metrics: ModuleMetrics = { increment: () => {}, gauge: () => {} }
): ModuleContext<DefaultEntity> & { readonly defaultMapDefinition: MapDefinition } {
  const entities: EntityStore<DefaultEntity> = {
    get: (id) => world.getEntity(id),
    add: (entity) => world.addEntity(entity),
    update: (id, update) => {
      const current = world.getEntity(id);
      if (!current) {
        throw new RangeError(`Entity ${id} does not exist in this session.`);
      }
      world.addEntity(update(current));
    },
    remove: (id) => world.removeEntity(id),
    values: () => world.entities(),
    queryRadius: (center, radius, maxCells) => world.queryEntities(center, radius, maxCells)
  };
  let nextPathId = 0;
  const contextNavigation = {
    requestPath(from: Readonly<{ x: number; y: number }>, to: Readonly<{ x: number; y: number }>) {
      let requestId: string | undefined;
      const numericId = navigation.requestPath(from, to, (result) => {
        if (requestId) {
          if (pathResults.size >= MAX_RETAINED_PATH_RESULTS) {
            throw new RangeError("The session exceeded its retained navigation-result limit.");
          }
          pathResults.set(requestId, result);
        }
      });
      if (numericId === undefined) {
        return undefined;
      }
      nextPathId += 1;
      requestId = String(nextPathId);
      return requestId;
    },
    getPath(requestId: string) {
      const result = pathResults.get(requestId);
      if (result) {
        pathResults.delete(requestId);
      }
      return result;
    }
  };
  const maps = new AuthoritativeMapTransition(world, navigation, () => pathResults.clear());
  return {
    clock: new SystemMonotonicClock(),
    random: new SeededRandom(seed),
    defaultMapDefinition,
    entities,
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) =>
        world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) =>
        world.geometry.moveCircle(position, delta, radius)
    },
    navigation: contextNavigation,
    maps,
    emit: () => {},
    requestCompletion,
    metrics
  };
}

function parseStandings(input: readonly JsonValue[]): Array<{
  accountId: string;
  points: number;
  kills: number;
  deaths: number;
}> {
  return input.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof value.accountId !== "string" ||
      typeof value.points !== "number" ||
      !Number.isSafeInteger(value.points) ||
      typeof value.kills !== "number" ||
      !Number.isSafeInteger(value.kills) ||
      typeof value.deaths !== "number" ||
      !Number.isSafeInteger(value.deaths) ||
      value.points < 0 ||
      value.kills < 0 ||
      value.deaths < 0
    ) {
      throw new TypeError("Module returned invalid final standings.");
    }
    return {
      accountId: value.accountId,
      points: value.points,
      kills: value.kills,
      deaths: value.deaths
    };
  });
}
