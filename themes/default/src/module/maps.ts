import { z } from "zod";
import {
  MAP_CELL_SIZE,
  validateMapDefinition,
  type MapDefinition,
  type MapSpawn
} from "@multiplayer-game/theme-sdk";

export const DEFAULT_MAP_WIDTH = 2_048;
export const DEFAULT_MAP_HEIGHT = 2_048;
export const MAX_MAP_GENERATION_ATTEMPTS = 4;
const DEFAULT_PLAYER_RADIUS = 14;

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
  readonly source: "generated" | "fallback";
  readonly attempts: number;
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

export function generateMap(seed: number): GeneratedMap {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("Map generation seed must be a safe integer.");
  }

  for (let attempt = 0; attempt < MAX_MAP_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const map = loadMap(createGeneratedCandidate(seed, attempt));
      return Object.freeze({ map, source: "generated", attempts: attempt + 1 });
    } catch (error) {
      if (!(error instanceof MapValidationError)) {
        throw error;
      }
    }
  }

  return Object.freeze({
    map: loadMap(createFallbackDefinition()),
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
  const random = createSeededRandom(((seed >>> 0) + attempt * 0x9e3779b9) >>> 0);
  const openGate = random() >= 0.5;
  const gateRow = 4 + Math.floor(random() * 56);
  const barrier = openGate
    ? [
        { id: "wall-north", position: { x: 1_024, y: gateRow * MAP_CELL_SIZE / 2 }, height: gateRow * MAP_CELL_SIZE },
        {
          id: "wall-south",
          position: {
            x: 1_024,
            y: gateRow * MAP_CELL_SIZE + MAP_CELL_SIZE / 2 +
              (DEFAULT_MAP_HEIGHT - (gateRow + 1) * MAP_CELL_SIZE) / 2
          },
          height: DEFAULT_MAP_HEIGHT - (gateRow + 1) * MAP_CELL_SIZE
        }
      ]
    : [
        {
          id: "wall-closed",
          position: { x: 1_024, y: DEFAULT_MAP_HEIGHT / 2 },
          height: DEFAULT_MAP_HEIGHT
        }
      ];
  const objects = barrier.map(({ id, position }) => ({
    id,
    typeId: "terrain.wall",
    position,
    tags: ["obstacle"],
    properties: { material: "stone" }
  }));
  const collisions = barrier.map(({ id, height }) => ({
    id: `collision-${id}`,
    objectId: id,
    shape: { type: "rect" as const, width: MAP_CELL_SIZE, height }
  }));

  return {
    formatVersion: 1,
    id: `generated-${seed >>> 0}-${attempt + 1}`,
    name: "Generated Arena",
    bounds: { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT },
    cellSize: MAP_CELL_SIZE,
    objects,
    collisions,
    spawns: createDefaultSpawns()
  };
}

function createFallbackDefinition(): MapDefinition {
  return {
    formatVersion: 1,
    id: "fallback-open-arena",
    name: "Fallback Arena",
    bounds: { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT },
    cellSize: MAP_CELL_SIZE,
    objects: [
      {
        id: "fallback-pillar",
        typeId: "terrain.pillar",
        position: { x: 1_024, y: 1_024 },
        tags: ["obstacle"],
        properties: { material: "stone" }
      }
    ],
    collisions: [
      {
        id: "collision-fallback-pillar",
        objectId: "fallback-pillar",
        shape: { type: "rect", width: 64, height: 64 }
      }
    ],
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
  return [...players, ...npcs];
}

function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
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
