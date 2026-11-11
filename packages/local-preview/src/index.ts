import {
  AuthoritativeMapTransition,
  BoundedNavigation,
  FIXED_STEP_SECONDS,
  SeededRandom,
  SessionWorld,
  SystemMonotonicClock
} from "@multiplayer-game/engine";
import {
  JsonValueSchema,
  type JsonValue
} from "@multiplayer-game/protocol";
import {
  validateMapDefinition,
  type AssetLoader,
  type EntityStore,
  type GameModuleFactory,
  type GameModuleInstance,
  type MapDefinition,
  type ModuleContext,
  type ModuleMetrics,
  type NavigationPathResult,
  type RosterMember,
  type ScopedEvent,
  type SkinFactory,
  type SkinHost,
  type SkinInstance
} from "@multiplayer-game/theme-sdk";

const MAX_RETAINED_PATH_RESULTS = 256;
const MAX_EVENTS_PER_STEP = 256;
const MAX_COMPLETION_REQUESTS_PER_STEP = 8;

export interface LocalPreviewEntity {
  readonly id: string;
  readonly typeId: string;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly radius: number;
  readonly state: JsonValue;
}

export interface LocalPreviewViewer {
  readonly accountId: string;
  readonly role: "player" | "spectator";
}

export interface LocalGameOptions<
  TSettings extends JsonValue,
  TInput,
  TState extends JsonValue,
  TSnapshot extends JsonValue,
  TResult extends JsonValue,
  TEntity extends LocalPreviewEntity
> {
  readonly moduleFactory: GameModuleFactory<
    TSettings,
    TInput,
    TState,
    TSnapshot,
    TResult,
    TEntity
  >;
  readonly settings: TSettings;
  readonly map?: MapDefinition;
  readonly seed: number;
  readonly roster: readonly RosterMember[];
  readonly viewer: LocalPreviewViewer;
  readonly sessionId?: string;
}

export interface LocalGameFrame<TSnapshot extends JsonValue> {
  readonly tick: number;
  readonly snapshot: TSnapshot;
  readonly events: readonly JsonValue[];
  readonly completionRequests: readonly Readonly<{ kind: "level" | "match"; reason: string }>[];
}

export interface LocalGame<TInput, TSnapshot extends JsonValue> {
  readonly moduleId: string;
  readonly stateSchemaVersion: number;
  readonly viewer: Readonly<{ accountId: string; username: string }>;
  readonly tick: number;
  readonly snapshot: TSnapshot;
  step(): LocalGameFrame<TSnapshot>;
  sendInput(accountId: string, input: unknown): boolean;
  subscribe(listener: (frame: LocalGameFrame<TSnapshot>) => void): () => void;
  dispose(): void;
}

export async function createLocalGame<
  TSettings extends JsonValue,
  TInput,
  TState extends JsonValue,
  TSnapshot extends JsonValue,
  TResult extends JsonValue,
  TEntity extends LocalPreviewEntity
>(
  options: LocalGameOptions<TSettings, TInput, TState, TSnapshot, TResult, TEntity>
): Promise<LocalGame<TInput, TSnapshot>> {
  validateGameOptions(options);
  if (!options.moduleFactory.validateSettings(options.settings)) {
    throw new TypeError("The game module rejected the supplied settings.");
  }
  const seed = options.seed;
  const candidateMap = options.map ??
    options.moduleFactory.createInitialMap?.(options.settings, seed);
  if (!candidateMap) {
    throw new TypeError("Provide a map or let the game module create its initial map.");
  }
  const map = validateMapDefinition(candidateMap);
  const obstacles = mapObstacles(map);
  const world = new SessionWorld<TEntity>(
    options.sessionId ?? "local-preview",
    map.bounds,
    obstacles,
    map.cellSize
  );
  const navigation = new BoundedNavigation(world.geometry, {
    cellSize: map.cellSize,
    agentRadius: 8
  });
  const pathResults = new Map<string, NavigationPathResult>();
  const events: ScopedEvent[] = [];
  const completionRequests: Array<Readonly<{ kind: "level" | "match"; reason: string }>> = [];
  const clock = new SystemMonotonicClock();
  const metrics: ModuleMetrics = { increment: () => {}, gauge: () => {} };
  const context = createModuleContext(
    world,
    navigation,
    pathResults,
    events,
    completionRequests,
    clock,
    new SeededRandom(seed),
    metrics
  );
  const module = options.moduleFactory.create(
    context,
    options.settings,
    options.roster,
    seed
  );
  if (module.stateSchemaVersion !== options.moduleFactory.metadata.stateSchemaVersion) {
    module.dispose();
    throw new TypeError("The game module instance state schema does not match its factory metadata.");
  }
  const game = new LocalGameRuntime(
    options,
    navigation,
    module,
    events,
    completionRequests
  );
  try {
    await game.initialize();
  } catch (error) {
    try {
      module.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        "Local game initialization and cleanup both failed."
      );
    }
    throw error;
  }
  return game;
}

export interface MountedLocalPreview {
  readonly host: SkinHost;
  dispose(): void;
}

export interface MountLocalPreviewOptions {
  readonly assets?: AssetLoader;
  readonly onNavigate?: SkinHost["navigate"];
  readonly onInputRejected?: (accountId: string) => void;
}

export function mountLocalPreview<
  TInput,
  TSnapshot extends JsonValue
>(
  root: HTMLElement,
  game: LocalGame<TInput, TSnapshot>,
  skinFactory: SkinFactory,
  options: MountLocalPreviewOptions = {}
): MountedLocalPreview {
  if (skinFactory.metadata.acceptedModuleId !== game.moduleId) {
    throw new TypeError("The skin does not accept this game's module.");
  }
  if (!skinFactory.metadata.acceptedStateSchemaVersions.includes(game.stateSchemaVersion)) {
    throw new TypeError("The skin does not support this game's state schema.");
  }
  const viewer = game.viewer;
  const world = document.createElement("section");
  world.className = "local-preview-world";
  const hud = document.createElement("section");
  hud.className = "local-preview-hud";
  const controls = document.createElement("section");
  controls.className = "local-preview-controls";
  root.replaceChildren(hud, world, controls);

  let cameraAnchor: Readonly<{ x: number; y: number }> | undefined;
  let disposed = false;
  let skin: SkinInstance | undefined;
  let unsubscribe = (): void => {};
  const host: SkinHost = {
    slots: new Map([["world", world], ["hud", hud], ["controls", controls]]),
    selectedTarget: viewer,
    get cameraAnchor() { return cameraAnchor; },
    setCameraAnchor(anchor) {
      if (anchor && (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))) {
        throw new TypeError("Camera anchor must contain finite coordinates.");
      }
      cameraAnchor = anchor ? Object.freeze({ ...anchor }) : undefined;
    },
    dispatchInput(input) {
      if (!game.sendInput(viewer.accountId, input)) {
        options.onInputRejected?.(viewer.accountId);
      }
    },
    navigate(action) {
      options.onNavigate?.(action);
    }
  };
  const assets = options.assets ?? missingAssets;
  const resize = (): void => {
    if (disposed || !skin) return;
    const rect = world.getBoundingClientRect();
    skin.handleViewport(
      Math.max(1, rect.width),
      Math.max(1, rect.height),
      typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1)
    );
  };
  const onResize = (): void => resize();
  const render = (frame: LocalGameFrame<TSnapshot>): void => {
    if (disposed || !skin) return;
    skin.handleSnapshot(frame.snapshot);
    skin.handleEvents(frame.events);
    skin.render(typeof performance === "undefined" ? 0 : performance.now(), frame.snapshot);
  };

  try {
    skin = skinFactory.mount(host, assets);
    resize();
    if (typeof window !== "undefined") window.addEventListener("resize", onResize);
    unsubscribe = game.subscribe(render);
    render({
      tick: game.tick,
      snapshot: game.snapshot,
      events: [],
      completionRequests: []
    });
    return {
      host,
      dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        if (typeof window !== "undefined") window.removeEventListener("resize", onResize);
        try {
          skin?.dispose();
        } finally {
          cameraAnchor = undefined;
          root.replaceChildren();
        }
      }
    };
  } catch (error) {
    unsubscribe();
    try {
      skin?.dispose();
    } finally {
      root.replaceChildren();
    }
    throw error;
  }
}

class LocalGameRuntime<
  TSettings extends JsonValue,
  TInput,
  TState extends JsonValue,
  TSnapshot extends JsonValue,
  TResult extends JsonValue,
  TEntity extends LocalPreviewEntity
> implements LocalGame<TInput, TSnapshot> {
  readonly moduleId: string;
  readonly stateSchemaVersion: number;
  readonly #options: LocalGameOptions<TSettings, TInput, TState, TSnapshot, TResult, TEntity>;
  readonly #navigation: BoundedNavigation;
  readonly #module: GameModuleInstance<TInput, TState, TSnapshot, TResult>;
  readonly #events: ScopedEvent[];
  readonly #completionRequests: Array<Readonly<{ kind: "level" | "match"; reason: string }>>;
  readonly #listeners = new Set<(frame: LocalGameFrame<TSnapshot>) => void>();
  #snapshot: TSnapshot | undefined;
  #tick = 0;
  #disposed = false;
  readonly viewer: Readonly<{ accountId: string; username: string }>;

  constructor(
    options: LocalGameOptions<TSettings, TInput, TState, TSnapshot, TResult, TEntity>,
    navigation: BoundedNavigation,
    module: GameModuleInstance<TInput, TState, TSnapshot, TResult>,
    events: ScopedEvent[],
    completionRequests: Array<Readonly<{ kind: "level" | "match"; reason: string }>>
  ) {
    this.#options = options;
    this.#navigation = navigation;
    this.#module = module;
    this.#events = events;
    this.#completionRequests = completionRequests;
    this.moduleId = options.moduleFactory.metadata.id;
    this.stateSchemaVersion = module.stateSchemaVersion;
    const viewer = options.roster.find(member => member.accountId === options.viewer.accountId)!;
    this.viewer = Object.freeze({ accountId: viewer.accountId, username: viewer.username });
  }

  get tick(): number {
    return this.#tick;
  }

  get snapshot(): TSnapshot {
    if (this.#snapshot === undefined) throw new Error("The local game has no snapshot yet.");
    return this.#snapshot;
  }

  async initialize(): Promise<void> {
    await this.#module.initialize();
    for (const member of this.#options.roster) {
      this.#module.setPlayerPresence?.(member.accountId, "connected");
    }
    this.#snapshot = readSnapshot(this.#module, this.#options.viewer);
  }

  step(): LocalGameFrame<TSnapshot> {
    this.#assertRunning();
    this.#events.length = 0;
    this.#completionRequests.length = 0;
    const nextTick = this.#tick + 1;
    let snapshot: TSnapshot;
    try {
      this.#navigation.processTick();
      this.#module.step(FIXED_STEP_SECONDS, nextTick);
      snapshot = readSnapshot(this.#module, this.#options.viewer);
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.#tick = nextTick;
    this.#snapshot = snapshot;
    const frame: LocalGameFrame<TSnapshot> = Object.freeze({
      tick: this.#tick,
      snapshot: this.#snapshot,
      events: Object.freeze(
        this.#events.splice(0).map(event =>
          structuredClone({ type: event.type, data: event.data })
        )
      ),
      completionRequests: Object.freeze(this.#completionRequests.splice(0))
    });
    for (const listener of this.#listeners) listener(frame);
    return frame;
  }

  sendInput(accountId: string, input: unknown): boolean {
    this.#assertRunning();
    if (!this.#options.roster.some(member => member.accountId === accountId)) return false;
    if (!this.#module.validateInput(input)) return false;
    this.#module.applyInput(accountId, input);
    return true;
  }

  subscribe(listener: (frame: LocalGameFrame<TSnapshot>) => void): () => void {
    this.#assertRunning();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
    try {
      this.#module.dispose();
    } finally {
      this.#snapshot = undefined;
    }
  }

  #assertRunning(): void {
    if (this.#disposed) throw new Error("The local game has been disposed.");
  }
}

function createModuleContext<TEntity extends LocalPreviewEntity>(
  world: SessionWorld<TEntity>,
  navigation: BoundedNavigation,
  pathResults: Map<string, NavigationPathResult>,
  events: ScopedEvent[],
  completionRequests: Array<Readonly<{ kind: "level" | "match"; reason: string }>>,
  clock: SystemMonotonicClock,
  random: SeededRandom,
  metrics: ModuleMetrics
): ModuleContext<TEntity> {
  const entities: EntityStore<TEntity> = {
    get: (id) => world.getEntity(id),
    add: (entity) => world.addEntity(entity),
    update: (id, update) => {
      const current = world.getEntity(id);
      if (!current) throw new RangeError(`Entity ${id} does not exist in this local game.`);
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
      const numericId = navigation.requestPath(from, to, result => {
        if (!requestId) throw new Error("Navigation completed before its request was registered.");
        if (pathResults.size >= MAX_RETAINED_PATH_RESULTS) {
          throw new RangeError("The local game exceeded its retained navigation-result limit.");
        }
        pathResults.set(requestId, result);
      });
      if (numericId === undefined) return undefined;
      nextPathId += 1;
      requestId = String(nextPathId);
      return requestId;
    },
    getPath(requestId: string) {
      const result = pathResults.get(requestId);
      if (result) pathResults.delete(requestId);
      return result;
    }
  };
  const maps = new AuthoritativeMapTransition(world, navigation, () => pathResults.clear());
  return {
    clock,
    random,
    entities,
    geometry: {
      isWalkable: (x, y, radius = 0) => world.geometry.isCircleWalkable({ x, y }, radius),
      intersectsObstacle: (x, y, radius) => world.geometry.intersectsObstacle({ x, y }, radius),
      moveCircle: (position, delta, radius) => world.geometry.moveCircle(position, delta, radius)
    },
    navigation: contextNavigation,
    maps,
    emit(event) {
      if (events.length >= MAX_EVENTS_PER_STEP) {
        throw new RangeError("The local game exceeded its per-step event limit.");
      }
      JsonValueSchema.parse(event);
      events.push(Object.freeze(structuredClone({ type: event.type, data: event.data })));
    },
    requestCompletion(request) {
      if (completionRequests.length >= MAX_COMPLETION_REQUESTS_PER_STEP) {
        throw new RangeError("The local game exceeded its per-step completion-request limit.");
      }
      completionRequests.push(Object.freeze({ ...request }));
    },
    metrics
  };
}

function validateGameOptions<
  TSettings extends JsonValue,
  TInput,
  TState extends JsonValue,
  TSnapshot extends JsonValue,
  TResult extends JsonValue,
  TEntity extends LocalPreviewEntity
>(
  options: LocalGameOptions<TSettings, TInput, TState, TSnapshot, TResult, TEntity>
): void {
  if (!Number.isSafeInteger(options.seed)) throw new RangeError("The game seed must be a safe integer.");
  if (!options.roster.length) throw new TypeError("A local game requires at least one player.");
  const accountIds = new Set<string>();
  for (const member of options.roster) {
    if (!member.accountId.trim() || !member.username.trim() ||
        !Number.isSafeInteger(member.joinedOrder) || member.joinedOrder < 0 ||
        accountIds.has(member.accountId)) {
      throw new TypeError("The local roster contains an invalid or duplicate player.");
    }
    accountIds.add(member.accountId);
  }
  if (!accountIds.has(options.viewer.accountId)) {
    throw new TypeError("The preview viewer must belong to the local roster.");
  }
  if (options.viewer.role !== "player" && options.viewer.role !== "spectator") {
    throw new TypeError("The local preview viewer role must be player or spectator.");
  }
  if (options.sessionId !== undefined && !options.sessionId.trim()) {
    throw new TypeError("The local session ID must not be empty.");
  }
}

function mapObstacles(map: MapDefinition): readonly Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>[] {
  const objects = new Map(map.objects.map(object => [object.id, object]));
  return map.collisions.map(collision => {
    const object = objects.get(collision.objectId);
    if (!object) throw new TypeError(`Map collision references missing object ${collision.objectId}.`);
    const { width, height } = collision.shape;
    return Object.freeze({
      x: object.position.x - width / 2,
      y: object.position.y - height / 2,
      width,
      height
    });
  });
}

function readSnapshot<
  TInput,
  TState extends JsonValue,
  TSnapshot extends JsonValue,
  TResult extends JsonValue
>(
  module: GameModuleInstance<TInput, TState, TSnapshot, TResult>,
  viewer: LocalPreviewViewer
): TSnapshot {
  const snapshot = structuredClone(module.snapshot(viewer));
  JsonValueSchema.parse(snapshot);
  freezeJson(snapshot);
  return snapshot;
}

function freezeJson(value: JsonValue): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  if (Array.isArray(value)) {
    for (const child of value) freezeJson(child);
  } else {
    for (const child of Object.values(value)) freezeJson(child);
  }
  Object.freeze(value);
}

const missingAssets: AssetLoader = {
  async image(assetId) {
    throw new Error(`No image asset is registered: ${assetId}.`);
  },
  async audio(assetId) {
    throw new Error(`No audio asset is registered: ${assetId}.`);
  }
};
