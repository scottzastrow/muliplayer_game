import { z } from "zod";
import {
  MAP_CELL_SIZE,
  validateMapDefinition,
  type MapDefinition,
  type MapSpawn
} from "@multiplayer-game/theme-sdk";
import { PICKUP_RADIUS } from "./tuning.js";
import { SAFE_SPAWN_MARGIN } from "./tuning.js";
import { TerrainDensitySchema } from "@multiplayer-game/protocol";

export const DEFAULT_MAP_WIDTH = 2_048;
export const DEFAULT_MAP_HEIGHT = 2_048;
export const DEFAULT_ARENA_ID = "dots-and-squares-tile-arena-v1";
export const DEFAULT_ARENA_NAME = "Tile Cluster Arena";
export const MAX_MAP_GENERATION_ATTEMPTS = 4;
export const DEFAULT_MAP_MODE: MapMode = "fixed";
export type MapMode = "fixed" | "simple-generated";
const DEFAULT_PLAYER_RADIUS = 14;
const TETROMINO_CLUSTERS: readonly {
  readonly id: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly tiles: readonly (readonly [number, number])[];
}[] = [
  {
    id: "northwest-t",
    tileX: 12,
    tileY: 12,
    tiles: [[0, 0], [1, 0], [2, 0], [1, 1]]
  },
  {
    id: "northeast-j",
    tileX: 32,
    tileY: 15,
    tiles: [[0, 0], [0, 1], [0, 2], [1, 2]]
  },
  {
    id: "southeast-s",
    tileX: 40,
    tileY: 34,
    tiles: [[1, 0], [2, 0], [0, 1], [1, 1]]
  },
  {
    id: "southwest-l",
    tileX: 20,
    tileY: 40,
    tiles: [[1, 0], [1, 1], [0, 2], [1, 2]]
  }
];
const COVER_SHAPES = {
  block: ["11111", "11111", "11111", "11111", "11111"],
  t: ["11111", "11111", "00100", "00100", "00100"],
  l: ["11000", "11000", "11000", "11111", "11111"],
  steps: ["11100", "11100", "11111", "00111", "00111"],
  cross: ["01110", "11111", "11111", "11111", "01110"]
} as const;
const FIXED_ARENA_CLUSTERS = [
  ...TETROMINO_CLUSTERS,
  ...([
    ["north-t", 24, 4],
    ["north-east-t", 44, 4],
    ["east-upper-t", 54, 18],
    ["west-middle-t", 6, 20],
    ["inner-west-t", 20, 28],
    ["inner-east-t", 42, 25],
    ["inner-south-t", 27, 35],
    ["east-lower-t", 53, 36],
    ["west-lower-t", 7, 46],
    ["south-middle-t", 35, 50],
    ["south-east-t", 47, 51],
    ["south-west-t", 19, 55]
  ] as const).map(([id, tileX, tileY]) => ({
    id, tileX, tileY,
    tiles: [[0, 0], [1, 0], [2, 0], [1, 1]] as const
  })),
  ...([
    ["block", 1, 1], ["t", 10, 1], ["l", 19, 1], ["steps", 26, 1],
    ["cross", 34, 1], ["block", 52, 1], ["t", 58, 1],
    ["l", 1, 12], ["steps", 19, 12], ["cross", 26, 12], ["block", 34, 12],
    ["t", 52, 12], ["l", 58, 12],
    ["steps", 1, 26], ["cross", 10, 26], ["block", 58, 26],
    ["t", 1, 34], ["l", 58, 34],
    ["steps", 1, 44], ["cross", 10, 44], ["block", 43, 44], ["t", 52, 44], ["l", 58, 44],
    ["steps", 1, 58], ["cross", 10, 58], ["block", 19, 58], ["t", 26, 58],
    ["l", 34, 58], ["steps", 43, 58], ["cross", 52, 58], ["block", 58, 58]
  ] as const).map(([shape, tileX, tileY]) => ({
    id: `cover-${shape}-${tileX}-${tileY}`,
    tileX,
    tileY,
    tiles: COVER_SHAPES[shape].flatMap((row, y) =>
      [...row].flatMap((solid, x): (readonly [number, number])[] =>
        solid === "1" ? [[x, y]] : []))
  }))
];

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

export class MapValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MapValidationError";
  }
}

export interface LoadedMap {
  readonly definition: MapDefinition;
  readonly obstacles: readonly Rect[];
  isWalkable(position: Readonly<{ x: number; y: number }>, radius: number): boolean;
}

export interface GeneratedMap {
  readonly map: LoadedMap;
  readonly source: "fixed" | "generated" | "fallback";
  readonly attempts: number;
}

export interface TerrainCoverage {
  readonly level: number;
  readonly density: number;
  readonly targetCoveragePercent: number;
  readonly actualCoveragePercent: number;
  readonly budgetExhausted: boolean;
}

export interface DensityMap {
  readonly map: LoadedMap;
  readonly terrain: TerrainCoverage;
}

export function generateDensityMap(seed: number, level: number, density: number): DensityMap {
  TerrainDensitySchema.parse(density);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(level) || level < 1 || level > 100) {
    throw new RangeError("Density map requires a safe integer seed and level 1-100.");
  }
  const columns = DEFAULT_MAP_WIDTH / MAP_CELL_SIZE;
  const rows = DEFAULT_MAP_HEIGHT / MAP_CELL_SIZE;
  const count = columns * rows;
  const clear = new Uint8Array(count);
  const spawns = createDefaultSpawns();
  let state = (seed >>> 0) ^ Math.imul(level, 0x9e3779b9) ^ Math.imul(density + 1, 0x85ebca6b);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const rootX = Math.floor(columns / 2) - 7 + Math.floor(random() * 13);
  const rootY = Math.floor(rows / 2) - 1;
  for (const spawn of spawns) {
    const x = Math.floor(spawn.position.x / MAP_CELL_SIZE);
    const y = Math.floor(spawn.position.y / MAP_CELL_SIZE);
    for (let column = Math.min(x, rootX); column <= Math.max(x, rootX); column += 1) {
      clear[y * columns + column] = 1;
    }
    for (let row = Math.min(y, rootY); row <= Math.max(y, rootY); row += 1) {
      clear[row * columns + rootX] = 1;
    }
    const radius = spawn.radius + SAFE_SPAWN_MARGIN;
    for (let row = Math.max(0, Math.floor((spawn.position.y - radius) / MAP_CELL_SIZE));
      row <= Math.min(rows - 1, Math.floor((spawn.position.y + radius) / MAP_CELL_SIZE)); row += 1) {
      for (let column = Math.max(0, Math.floor((spawn.position.x - radius) / MAP_CELL_SIZE));
        column <= Math.min(columns - 1, Math.floor((spawn.position.x + radius) / MAP_CELL_SIZE)); column += 1) {
        if (circleIntersectsRect(spawn.position, radius, {
          x: column * MAP_CELL_SIZE, y: row * MAP_CELL_SIZE, width: MAP_CELL_SIZE, height: MAP_CELL_SIZE
        })) clear[row * columns + column] = 1;
      }
    }
  }

  const desiredSolid = Math.floor(count * density * 8 / 100);
  const desiredClear = count - desiredSolid;
  let clearCount = clear.reduce((sum, value) => sum + value, 0);
  const frontier: number[] = [];
  const queued = new Uint8Array(count);
  const enqueueNeighbors = (index: number) => {
    for (const next of [
      index % columns > 0 ? index - 1 : -1, index % columns + 1 < columns ? index + 1 : -1,
      index >= columns ? index - columns : -1, index + columns < count ? index + columns : -1
    ]) {
      if (next >= 0 && !clear[next] && !queued[next]) {
        queued[next] = 1;
        frontier.push(next);
      }
    }
  };
  for (let index = 0; index < count; index += 1) if (clear[index]) enqueueNeighbors(index);
  // Each cell enters the frontier once; growing only adjacent cells keeps all free space connected.
  for (let work = 0; work < count && clearCount < desiredClear && frontier.length > 0; work += 1) {
    const pick = Math.floor(random() * frontier.length);
    const index = frontier[pick]!;
    frontier[pick] = frontier[frontier.length - 1]!;
    frontier.pop();
    clear[index] = 1;
    clearCount += 1;
    enqueueNeighbors(index);
  }

  const rectangles: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns;) {
      if (clear[row * columns + column]) { column += 1; continue; }
      const first = column;
      while (column < columns && !clear[row * columns + column]) column += 1;
      rectangles.push({ x: first * MAP_CELL_SIZE, y: row * MAP_CELL_SIZE,
        width: (column - first) * MAP_CELL_SIZE, height: MAP_CELL_SIZE });
    }
  }
  const definition: MapDefinition = {
    formatVersion: 1, id: `dots-and-squares-density-level-${level}`, name: "Simple Generated",
    bounds: { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT }, cellSize: MAP_CELL_SIZE,
    objects: rectangles.map((rect, index) => ({
      id: `terrain-${index}`, typeId: "terrain.tetris-tile",
      position: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      tags: ["obstacle"], properties: { material: "stone" }
    })),
    collisions: rectangles.map((rect, index) => ({
      id: `collision-${index}`, objectId: `terrain-${index}`,
      shape: { type: "rect", width: rect.width, height: rect.height }
    })),
    spawns
  };
  const map = loadMap(definition);
  const actualCoveragePercent = rectangles.reduce((area, rect) =>
    area + rect.width * rect.height, 0) / (DEFAULT_MAP_WIDTH * DEFAULT_MAP_HEIGHT) * 100;
  return Object.freeze({ map, terrain: Object.freeze({
    level, density, targetCoveragePercent: density * 8, actualCoveragePercent,
    budgetExhausted: count - clearCount < desiredSolid
  }) });
}

export function loadMap(input: unknown): LoadedMap {
  let definition: MapDefinition;
  try {
    definition = validateMapDefinition(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new MapValidationError("Map definition does not match the public map contract.", {
        cause: error
      });
    }
    throw error;
  }

  const objectsById = new Map(definition.objects.map((object) => [object.id, object]));
  const obstacles = definition.collisions.map((collision) => {
    const object = objectsById.get(collision.objectId);
    if (!object) {
      throw new MapValidationError(`Collision ${collision.id} references an unknown object.`);
    }
    return Object.freeze({
      x: object.position.x - collision.shape.width / 2,
      y: object.position.y - collision.shape.height / 2,
      width: collision.shape.width,
      height: collision.shape.height
    });
  });
  const isWalkable = (position: Readonly<{ x: number; y: number }>, radius: number): boolean => {
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(radius) ||
      radius < 0 ||
      position.x - radius < 0 ||
      position.y - radius < 0 ||
      position.x + radius > definition.bounds.width ||
      position.y + radius > definition.bounds.height
    ) {
      return false;
    }
    return obstacles.every((obstacle) => !circleIntersectsRect(position, radius, obstacle));
  };

  for (const spawn of definition.spawns) {
    if (!isWalkable(spawn.position, spawn.radius)) {
      throw new MapValidationError(`Spawn ${spawn.id} is not walkable.`);
    }
  }
  assertSpawnConnectivity(definition, isWalkable);

  return Object.freeze({
    definition,
    obstacles: Object.freeze(obstacles),
    isWalkable
  });
}

export function generateMap(
  seed: number,
  mode: MapMode = DEFAULT_MAP_MODE,
  createCandidate: (seed: number, attempt: number) => unknown = createGeneratedCandidate
): GeneratedMap {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("Map generation seed must be a safe integer.");
  }
  if (mode === "fixed") {
    return Object.freeze({ map: loadMap(createTileClusterArena()), source: "fixed", attempts: 0 });
  }
  if (mode !== "simple-generated") {
    throw new RangeError("Unknown Dots and Squares map mode.");
  }

  for (let attempt = 0; attempt < MAX_MAP_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const map = loadMap(createCandidate(seed, attempt));
      return Object.freeze({ map, source: "generated", attempts: attempt + 1 });
    } catch (error) {
      if (!(error instanceof MapValidationError)) {
        throw error;
      }
    }
  }

  return Object.freeze({
    map: loadMap(createTileClusterArena()),
    source: "fallback",
    attempts: MAX_MAP_GENERATION_ATTEMPTS
  });
}

function assertSpawnConnectivity(
  definition: MapDefinition,
  isWalkable: LoadedMap["isWalkable"]
): void {
  const columns = definition.bounds.width / definition.cellSize;
  const rows = definition.bounds.height / definition.cellSize;
  const cellCount = columns * rows;
  const playerSpawns = definition.spawns.filter((spawn) => spawn.kind === "player");
  const playerRadius = Math.max(...playerSpawns.map(({ radius }) => radius));
  const visited = new Uint8Array(cellCount);
  const queue = new Int32Array(cellCount);
  const start = spawnCellIndex(playerSpawns[0]!, columns, definition.cellSize);
  let head = 0;
  let tail = 0;
  visited[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % columns;
    const y = Math.floor(index / columns);
    const adjacent = [
      x > 0 ? index - 1 : -1,
      x + 1 < columns ? index + 1 : -1,
      y > 0 ? index - columns : -1,
      y + 1 < rows ? index + columns : -1
    ];
    for (const next of adjacent) {
      if (next < 0 || visited[next]) {
        continue;
      }
      const position = {
        x: ((next % columns) + 0.5) * definition.cellSize,
        y: (Math.floor(next / columns) + 0.5) * definition.cellSize
      };
      if (isWalkable(position, playerRadius)) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  for (const spawn of definition.spawns) {
    const index = spawnCellIndex(spawn, columns, definition.cellSize);
    if (!visited[index] || !isWalkable(spawn.position, playerRadius)) {
      throw new MapValidationError(`Spawn ${spawn.id} is unreachable by a player.`);
    }
  }
}

function spawnCellIndex(spawn: MapSpawn, columns: number, cellSize: number): number {
  return Math.floor(spawn.position.y / cellSize) * columns +
    Math.floor(spawn.position.x / cellSize);
}

function createGeneratedCandidate(seed: number, attempt: number): MapDefinition {
  const clusters = TETROMINO_CLUSTERS.map((cluster, index) => ({
    ...cluster,
    tileX: cluster.tileX + seededOffset(seed, attempt, index * 2),
    tileY: cluster.tileY + seededOffset(seed, attempt, index * 2 + 1)
  }));
  return createTileClusterArena(clusters, "dots-and-squares-simple-generated-v1", "Simple Generated");
}

function seededOffset(seed: number, attempt: number, coordinate: number): number {
  let value = (seed >>> 0) ^ Math.imul(attempt + 1, 0x9e3779b9) ^
    Math.imul(coordinate + 1, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) % 13 - 6;
}

function createTileClusterArena(
  clusters: typeof TETROMINO_CLUSTERS = FIXED_ARENA_CLUSTERS,
  id = DEFAULT_ARENA_ID,
  name = DEFAULT_ARENA_NAME
): MapDefinition {
  const tiles = clusters.flatMap((cluster) =>
    cluster.tiles.map(([offsetX, offsetY], index) => {
      const id = `tile-${cluster.id}-${index + 1}`;
      const tileX = cluster.tileX + offsetX;
      const tileY = cluster.tileY + offsetY;
      return {
        id,
        typeId: "terrain.tetris-tile",
        position: {
          x: (tileX + 0.5) * MAP_CELL_SIZE,
          y: (tileY + 0.5) * MAP_CELL_SIZE
        },
        tags: ["obstacle", "tile-cluster"],
        properties: { material: "stone", clusterId: cluster.id },
        collision: {
          id: `collision-${id}`,
          objectId: id,
          shape: { type: "rect" as const, width: MAP_CELL_SIZE, height: MAP_CELL_SIZE }
        }
      };
    })
  );
  return {
    formatVersion: 1,
    id,
    name,
    bounds: { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT },
    cellSize: MAP_CELL_SIZE,
    objects: tiles.map(({ collision: _collision, ...object }) => object),
    collisions: tiles.map(({ collision }) => collision),
    spawns: createDefaultSpawns()
  };
}

function createDefaultSpawns(): MapSpawn[] {
  const playerColumns = [272, 528, 784, 912, 1_136, 1_264, 1_520, 1_776];
  const playerRows = [272, 784, 1_296, 1_776];
  const players = playerColumns.flatMap((x, column) =>
    playerRows.map((y, row) => ({
      id: `player-${String(column * playerRows.length + row + 1).padStart(2, "0")}`,
      kind: "player" as const,
      position: { x, y },
      radius: DEFAULT_PLAYER_RADIUS
    }))
  );
  const npcs = [
    { id: "npc-northwest", kind: "npc" as const, position: { x: 528, y: 528 }, radius: 8 },
    { id: "npc-southwest", kind: "npc" as const, position: { x: 784, y: 1_520 }, radius: 8 },
    { id: "npc-northeast", kind: "npc" as const, position: { x: 1_520, y: 528 }, radius: 8 },
    { id: "npc-southeast", kind: "npc" as const, position: { x: 1_264, y: 1_520 }, radius: 8 }
  ];
  const pickups = [
    {
      id: "pickup-health",
      kind: "pickup" as const,
      pickupType: "health" as const,
      position: { x: 784, y: 1_008 },
      radius: PICKUP_RADIUS
    },
    {
      id: "pickup-rapid-fire",
      kind: "pickup" as const,
      pickupType: "rapid-fire" as const,
      position: { x: 1_264, y: 1_008 },
      radius: PICKUP_RADIUS
    },
    {
      id: "pickup-spread",
      kind: "pickup" as const,
      pickupType: "spread" as const,
      position: { x: 784, y: 1_264 },
      radius: PICKUP_RADIUS
    }
  ];
  return [...players, ...npcs, ...pickups];
}

function circleIntersectsRect(
  position: Readonly<{ x: number; y: number }>,
  radius: number,
  rect: Rect
): boolean {
  const closestX = Math.max(rect.x, Math.min(position.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(position.y, rect.y + rect.height));
  const dx = position.x - closestX;
  const dy = position.y - closestY;
  const distanceSquared = dx * dx + dy * dy;
  return radius === 0 ? distanceSquared === 0 : distanceSquared < radius * radius;
}
