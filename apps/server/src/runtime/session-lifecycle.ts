import {
  BoundedNavigation,
  FIXED_STEP_MS,
  SessionRunner,
  SeededRandom,
  SessionWorld,
  SystemMonotonicClock
} from "@multiplayer-game/engine";
import {
  GameSettingsSchema,
  type GameSettings,
  type JsonValue
} from "@multiplayer-game/protocol";
import type {
  EntityStore,
  ModuleContext,
  NavigationPathResult,
  RosterMember
} from "@multiplayer-game/theme-sdk";
import {
  generateMap,
  type DefaultEntity,
  type DefaultModuleSnapshot
} from "@multiplayer-game/default-theme";
import type { SqliteDatabase } from "../storage/database.js";
import type { LobbyRegistry } from "../lobby/registry.js";
import type { ThemeLoader } from "../themes/builtins.js";
import type { ModuleInput } from "../transport/socket.js";

const SNAPSHOT_INTERVAL_TICKS = 2;
const MAX_COMPLETION_REQUESTS_PER_STEP = 8;
const MAX_RETAINED_PATH_RESULTS = 256;

interface MatchRuntimeRow {
  settings_json: string;
  seed: number;
  theme_id: string;
  theme_version: string;
}

interface ParticipantRow {
  account_id: string;
  username: string;
  joined_order: number;
}

interface ActiveSession {
  readonly id: string;
  readonly settings: GameSettings;
  readonly roster: readonly RosterMember[];
  readonly module: ReturnType<ThemeLoader["createModuleInstance"]>;
  readonly navigation: BoundedNavigation;
  readonly pathResults: Map<string, NavigationPathResult>;
  currentLevel: number;
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
    readonly reportError: (error: unknown) => void = () => {}
  ) {}

  async start(sessionId: string): Promise<void> {
    if (this.#sessions.has(sessionId)) {
      throw new Error("Session simulation is already running.");
    }

    let module: ActiveSession["module"] | undefined;
    try {
      const { settings, seed, revision, roster } = this.#readRuntime(sessionId);
      const map = generateMap(seed).map;
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
      const context = createModuleContext(
        world,
        navigation,
        pathResults,
        seed,
        (request) => {
          if (completionRequests.length >= MAX_COMPLETION_REQUESTS_PER_STEP) {
            throw new RangeError("The module exceeded its completion-request limit.");
          }
          completionRequests.push(request);
        }
      );
      module = this.themes.createModuleInstance(
        revision,
        context,
        settings,
        roster,
        seed
      );
      await module.initialize();
      const active: ActiveSession = {
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
          step: (dtSeconds, tick) => this.#step(active, dtSeconds, tick),
          snapshot: () => active.module.state ?? {},
          onError: (error) => this.#fail(active, error),
          dispose: () => active.module.dispose()
        }
      });
      this.#sessions.set(sessionId, active);
      active.timer = setInterval(
        () => this.#advance(active),
        FIXED_STEP_MS
      );
    } catch (error) {
      if (module) {
        try {
          module.dispose();
        } catch (disposeError) {
          this.reportError(disposeError);
        }
      }
      this.lobby.markTerminal(sessionId, "failed");
      this.reportError(error);
      throw error;
    }
  }

  applyInput(input: ModuleInput): boolean {
    const active = this.#sessions.get(input.sessionId);
    if (!active || !active.roster.some((member) => member.accountId === input.accountId)) {
      return false;
    }
    if (!active.module.validateInput(input.action)) {
      return false;
    }
    active.module.applyInput(input.accountId, input.action);
    return true;
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

  #readRuntime(sessionId: string): {
    readonly settings: GameSettings;
    readonly seed: number;
    readonly revision: string;
    readonly roster: readonly RosterMember[];
  } {
    const match = this.database
      .prepare(
        `SELECT m.settings_json, m.seed, t.theme_id, t.version AS theme_version
         FROM matches m
         JOIN theme_revisions t ON t.digest = m.theme_digest
         WHERE m.id = ? AND m.state = 'running'`
      )
      .get(sessionId) as MatchRuntimeRow | undefined;
    if (!match) {
      throw new Error("Running session metadata could not be loaded.");
    }
    const settings = GameSettingsSchema.parse(JSON.parse(match.settings_json));
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
      revision: `${match.theme_id}@${match.theme_version}`,
      roster
    };
  }

  #advance(active: ActiveSession): void {
    if (this.#sessions.get(active.id) !== active || !active.runner) {
      return;
    }
    try {
      active.runner.advance();
    } catch (error) {
      this.#fail(active, error);
    }
  }

  #step(active: ActiveSession, dtSeconds: number, tick: number): void {
    active.navigation.processTick();
    active.module.step(dtSeconds, tick);
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.#publish(active, tick);
    }

    const requests = active.completionRequests.splice(0);
    for (const request of requests) {
      if (request.kind === "level") {
        this.#advanceLevel(active);
      } else {
        this.#finishMatch(active, tick);
      }
    }
  }

  #advanceLevel(active: ActiveSession): void {
    const state = active.module.state;
    if (
      state?.phase !== "intermission" ||
      state.level !== active.currentLevel ||
      active.currentLevel >= active.settings.maxLevels ||
      !this.lobby.advanceLevel(active.id, active.currentLevel, active.currentLevel + 1)
    ) {
      throw new Error("Module requested an invalid or duplicate level transition.");
    }
    active.currentLevel += 1;
  }

  #finishMatch(active: ActiveSession, tick: number): void {
    const state = active.module.state;
    const results = active.module.results();
    if (
      state?.phase !== "complete" ||
      results.status !== "finished" ||
      results.finalLevel !== active.currentLevel ||
      results.finalLevel !== active.settings.maxLevels
    ) {
      throw new Error("Module requested match completion before the configured final level.");
    }
    if (tick % SNAPSHOT_INTERVAL_TICKS !== 0) {
      this.#publish(active, tick);
    }
    const standings = parseStandings(results.standings);
    if (!this.lobby.finalizeFinishedMatch(active.id, results.finalLevel, standings)) {
      throw new Error("Finished match result was already finalized or the match is no longer active.");
    }
    this.#release(active);
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
    try {
      this.lobby.markTerminal(active.id, "failed");
    } catch (finalizationError) {
      this.reportError(finalizationError);
    } finally {
      this.#release(active);
    }
    this.reportError(error);
  }

  #release(active: ActiveSession): void {
    if (active.timer) {
      clearInterval(active.timer);
      delete active.timer;
    }
    this.#sessions.delete(active.id);
    active.runner?.dispose();
    active.pathResults.clear();
  }
}

function createModuleContext(
  world: SessionWorld<DefaultEntity>,
  navigation: BoundedNavigation,
  pathResults: Map<string, NavigationPathResult>,
  seed: number,
  requestCompletion: ModuleContext<DefaultEntity>["requestCompletion"]
): ModuleContext<DefaultEntity> {
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
  return {
    clock: new SystemMonotonicClock(),
    random: new SeededRandom(seed),
    entities,
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) =>
        world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) =>
        world.geometry.moveCircle(position, delta, radius)
    },
    navigation: contextNavigation,
    emit: () => {},
    requestCompletion,
    metrics: {
      increment: () => {},
      gauge: () => {}
    }
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
