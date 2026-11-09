import { z } from "zod";
import {
  JsonValueSchema,
  RequestIdSchema,
  type JsonValue
} from "@multiplayer-game/protocol";
import type { MapDefinition } from "./maps.js";
export { Countdown } from "./countdown.js";
export {
  RadarMarkerSchema,
  RadarViewSchema,
  drawRadar,
  type RadarMarker,
  type RadarRenderOptions,
  type RadarView
} from "./radar.js";
export {
  MAP_CELL_SIZE,
  MAX_MAP_COLLISIONS,
  MAX_MAP_DIMENSION,
  MAX_MAP_OBJECTS,
  MAX_MAP_SPAWNS,
  MapCollisionSchema,
  MapDefinitionSchema,
  MapObjectSchema,
  MapSpawnSchema,
  validateMapDefinition,
  type MapCollision,
  type MapDefinition,
  type MapObject,
  type MapSpawn
} from "./maps.js";

const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const PositiveVersionSchema = z.number().int().positive();

export const ThemeDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().min(1).max(64),
    version: VersionSchema,
    engineApiMajor: PositiveVersionSchema,
    module: z
      .object({
        id: IdentifierSchema,
        version: VersionSchema,
        stateSchemaVersion: PositiveVersionSchema
      })
      .strict(),
    skin: z
      .object({
        rendererId: IdentifierSchema,
        version: VersionSchema,
        acceptedModuleId: IdentifierSchema,
        acceptedStateSchemaVersions: z.array(PositiveVersionSchema).min(1).max(32)
      })
      .strict(),
    assetsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    settingsSchemaVersion: PositiveVersionSchema,
    settingsSchema: z.record(z.string(), JsonValueSchema),
    settingsDefaults: z.record(z.string(), JsonValueSchema)
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.skin.acceptedModuleId !== definition.module.id) {
      context.addIssue({
        code: "custom",
        path: ["skin", "acceptedModuleId"],
        message: "The skin must accept the theme's declared module."
      });
    }

    if (!definition.skin.acceptedStateSchemaVersions.includes(definition.module.stateSchemaVersion)) {
      context.addIssue({
        code: "custom",
        path: ["skin", "acceptedStateSchemaVersions"],
        message: "The skin must accept the module's state schema version."
      });
    }
  });

export type ThemeDefinition = z.infer<typeof ThemeDefinitionSchema>;

export function isThemeCompatible(definition: ThemeDefinition, engineApiMajor: number): boolean {
  return definition.engineApiMajor === engineApiMajor;
}

export interface MonotonicClock {
  nowMs(): number;
}

export interface RandomSource {
  next(): number;
}

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface EntityStore<TEntity extends { readonly id: string }> {
  get(id: string): Readonly<TEntity> | undefined;
  add(entity: TEntity): void;
  update(id: string, update: (entity: Readonly<TEntity>) => TEntity): void;
  remove(id: string): boolean;
  values(): readonly Readonly<TEntity>[];
  queryRadius(center: Point2, radius: number, maxCells?: number): readonly Readonly<TEntity>[];
}

export interface GeometryService {
  isWalkable(x: number, y: number, radius?: number): boolean;
  intersectsObstacle(x: number, y: number, radius: number): boolean;
  moveCircle(position: Point2, delta: Point2, radius: number): Point2;
}

export type NavigationPathResult =
  | {
      readonly status: "found";
      readonly path: readonly Point2[];
      readonly expandedNodes: number;
    }
  | {
      readonly status: "no-path" | "limit";
      readonly path: readonly Point2[];
      readonly expandedNodes: number;
    };

export interface NavigationService {
  requestPath(from: Point2, to: Point2): string | undefined;
  getPath(requestId: string): NavigationPathResult | undefined;
}

export interface ScopedEvent {
  readonly type: string;
  readonly data: JsonValue;
}

export interface ModuleMetrics {
  increment(name: string, amount?: number): void;
  gauge(name: string, value: number): void;
}

export interface MapGeometry {
  readonly bounds: Readonly<{ width: number; height: number }>;
  readonly cellSize: number;
  readonly obstacles: readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
}

export interface MapTransitionService<TEntity> {
  prepare(layout: MapGeometry): number;
  commit(token: number, entities: readonly TEntity[]): void;
}

export interface ModuleContext<TEntity extends { readonly id: string }> {
  readonly clock: MonotonicClock;
  readonly random: RandomSource;
  readonly entities: EntityStore<TEntity>;
  readonly geometry: GeometryService;
  readonly navigation: NavigationService;
  readonly maps?: MapTransitionService<TEntity>;
  emit(event: ScopedEvent): void;
  requestCompletion(request: Readonly<{ kind: "level" | "match"; reason: string }>): void;
  readonly metrics: ModuleMetrics;
}

export interface RosterMember {
  readonly accountId: string;
  readonly username: string;
  readonly joinedOrder: number;
}

export interface ModuleMetadata {
  readonly id: string;
  readonly version: string;
  readonly stateSchemaVersion: number;
}

export interface GameModuleInstance<
  TInput = JsonValue,
  TState extends JsonValue = JsonValue,
  TSnapshot extends JsonValue = JsonValue,
  TResult extends JsonValue = JsonValue
> {
  initialize(): void | Promise<void>;
  validateInput(input: unknown): input is TInput;
  applyInput(accountId: string, input: Readonly<TInput>): void;
  setPlayerPresence?(accountId: string, presence: "connected" | "disconnected" | "expired"): void;
  step(dtSeconds: number, tick: number): void;
  snapshot(viewer: Readonly<{ accountId: string; role: "player" | "spectator" }>): TSnapshot;
  results(): TResult;
  dispose(): void;
  readonly stateSchemaVersion: number;
  readonly state?: Readonly<TState>;
}

export interface GameModuleFactory<
  TSettings extends JsonValue = JsonValue,
  TInput = JsonValue,
  TState extends JsonValue = JsonValue,
  TSnapshot extends JsonValue = JsonValue,
  TResult extends JsonValue = JsonValue,
  TEntity extends { readonly id: string } = { readonly id: string }
> {
  readonly metadata: ModuleMetadata;
  createInitialMap?(settings: Readonly<TSettings>, seed: number): MapDefinition | undefined;
  validateSettings(settings: unknown): settings is TSettings;
  create(
    context: ModuleContext<TEntity>,
    settings: Readonly<TSettings>,
    roster: readonly RosterMember[],
    seed: number
  ): GameModuleInstance<TInput, TState, TSnapshot, TResult>;
}

export interface CapabilityContext {
  readonly clock: MonotonicClock;
  readonly random: RandomSource;
  emit(event: ScopedEvent): void;
}

export interface Capability<TState extends JsonValue = JsonValue> {
  readonly typeId: string;
  readonly stateSchemaVersion: number;
  createState(): TState;
  onStep?(state: Readonly<TState>, context: CapabilityContext, dtSeconds: number): TState;
  onInput?(state: Readonly<TState>, context: CapabilityContext, command: JsonValue): TState;
}

export interface SkinFactoryMetadata {
  readonly id: string;
  readonly version: string;
  readonly acceptedModuleId: string;
  readonly acceptedStateSchemaVersions: readonly number[];
}

export interface SkinFactory {
  readonly metadata: SkinFactoryMetadata;
  mount(host: SkinHost, assets: AssetLoader): SkinInstance;
}

export interface SkinInstance<TSnapshot = JsonValue, TEvent = JsonValue> {
  handleSnapshot(snapshot: Readonly<TSnapshot>): void;
  handleEvents(events: readonly Readonly<TEvent>[]): void;
  render(frameTimeMs: number, interpolatedState: Readonly<TSnapshot>): void;
  handleViewport(width: number, height: number, devicePixelRatio: number): void;
  dispose(): void;
}

export interface AssetLoader {
  image(assetId: string): Promise<HTMLImageElement>;
  audio(assetId: string): Promise<AudioBuffer>;
}

export interface SkinHost {
  readonly slots: ReadonlyMap<string, HTMLElement>;
  dispatchInput(input: JsonValue): void;
  readonly cameraAnchor: Readonly<{ x: number; y: number }> | undefined;
  setCameraAnchor(anchor: Point2 | undefined): void;
  readonly selectedTarget: Readonly<{ accountId: string; username: string }> | undefined;
  navigate(action: "lobby" | "players" | "results"): void;
}

export interface ThemePackageRevision {
  readonly definition: ThemeDefinition;
  readonly packageDigest: string;
  readonly installedModule: Readonly<{ id: string; version: string }>;
  readonly installedRenderer: Readonly<{ id: string; version: string }>;
}

export function validateThemeRevision(revision: ThemePackageRevision): ThemeDefinition {
  const definition = ThemeDefinitionSchema.parse(revision.definition);
  if (revision.packageDigest !== definition.assetsDigest) {
    throw new Error("Theme package digest does not match its manifest.");
  }
  if (
    revision.installedModule.id !== definition.module.id ||
    revision.installedModule.version !== definition.module.version
  ) {
    throw new Error("Theme module is not installed at the exact declared version.");
  }
  if (
    revision.installedRenderer.id !== definition.skin.rendererId ||
    revision.installedRenderer.version !== definition.skin.version
  ) {
    throw new Error("Theme renderer is not installed at the exact declared version.");
  }
  return definition;
}

export interface ThemeRequestContext {
  readonly requestId: string;
}

export function createThemeRequestContext(requestId: unknown): ThemeRequestContext {
  return Object.freeze({ requestId: RequestIdSchema.parse(requestId) });
}
