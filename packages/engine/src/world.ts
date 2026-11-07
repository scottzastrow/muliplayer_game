import type { JsonValue } from "@multiplayer-game/protocol";

export const MAX_COLLISION_OBSTACLES = 4_096;
export const MAX_ENTITIES_PER_SESSION = 4_096;

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

export interface WorldEntity {
  readonly id: string;
  readonly typeId: string;
  readonly position: Vector2;
  readonly radius: number;
  readonly state: JsonValue;
}

export class WorldGeometry {
  readonly bounds: WorldBounds;
  readonly obstacles: readonly Rect[];

  constructor(
    bounds: WorldBounds,
    obstacles: readonly Rect[] = []
  ) {
    assertPositiveFinite(bounds.width, "World width");
    assertPositiveFinite(bounds.height, "World height");
    if (obstacles.length > MAX_COLLISION_OBSTACLES) {
      throw new RangeError("World exceeds the supported obstacle limit.");
    }
    this.bounds = Object.freeze({ ...bounds });
    this.obstacles = Object.freeze(obstacles.map((obstacle) => {
      assertRect(obstacle);
      if (
        obstacle.x < 0 ||
        obstacle.y < 0 ||
        obstacle.x + obstacle.width > this.bounds.width ||
        obstacle.y + obstacle.height > this.bounds.height
      ) {
        throw new RangeError("Obstacles must be inside the world bounds.");
      }
      return Object.freeze({ ...obstacle });
    }));
  }

  containsCircle(position: Vector2, radius: number): boolean {
    assertPoint(position);
    assertNonnegativeFinite(radius, "Circle radius");
    return (
      position.x - radius >= 0 &&
      position.y - radius >= 0 &&
      position.x + radius <= this.bounds.width &&
      position.y + radius <= this.bounds.height
    );
  }

  intersectsObstacle(position: Vector2, radius: number): boolean {
    assertPoint(position);
    assertNonnegativeFinite(radius, "Circle radius");
    return this.obstacles.some((obstacle) => circleIntersectsRect(position, radius, obstacle));
  }

  isCircleWalkable(position: Vector2, radius: number): boolean {
    return this.containsCircle(position, radius) && !this.intersectsObstacle(position, radius);
  }

  moveCircle(position: Vector2, delta: Vector2, radius: number): Vector2 {
    assertPoint(position);
    assertPoint(delta);
    assertNonnegativeFinite(radius, "Circle radius");
    if (!this.isCircleWalkable(position, radius)) {
      throw new RangeError("The starting circle must be walkable.");
    }

    let x = position.x + delta.x;
    let y = position.y;
    x = this.#resolveAxis(position.x, x, y, radius, "x");
    y = position.y + delta.y;
    y = this.#resolveAxis(position.y, y, x, radius, "y");
    return Object.freeze({ x, y });
  }

  #resolveAxis(
    from: number,
    to: number,
    fixed: number,
    radius: number,
    axis: "x" | "y"
  ): number {
    const min = radius;
    const max = (axis === "x" ? this.bounds.width : this.bounds.height) - radius;
    let target = Math.min(max, Math.max(min, to));
    for (const obstacle of this.obstacles) {
      const distanceFromRange = axis === "x"
        ? distanceToRange(fixed, obstacle.y, obstacle.y + obstacle.height)
        : distanceToRange(fixed, obstacle.x, obstacle.x + obstacle.width);
      if (distanceFromRange > radius) {
        continue;
      }
      const clearance = Math.sqrt(Math.max(0, radius * radius - distanceFromRange * distanceFromRange));
      const obstacleStart = (axis === "x" ? obstacle.x : obstacle.y) - clearance;
      const obstacleEnd =
        (axis === "x" ? obstacle.x + obstacle.width : obstacle.y + obstacle.height) + clearance;
      if (target > from && from <= obstacleStart && target > obstacleStart) {
        target = Math.min(target, obstacleStart);
      } else if (target < from && from >= obstacleEnd && target < obstacleEnd) {
        target = Math.max(target, obstacleEnd);
      }
    }
    return target;
  }
}

export class SpatialGrid<TEntity extends WorldEntity = WorldEntity> {
  readonly #cells = new Map<string, Set<string>>();
  readonly #entityCells = new Map<string, string>();
  readonly #entities = new Map<string, TEntity>();

  constructor(
    readonly cellSize: number,
    readonly maxEntities = MAX_ENTITIES_PER_SESSION
  ) {
    assertPositiveFinite(cellSize, "Spatial grid cell size");
    if (!Number.isSafeInteger(maxEntities) || maxEntities < 1) {
      throw new RangeError("Spatial grid entity limit must be a positive safe integer.");
    }
  }

  get size(): number {
    return this.#entities.size;
  }

  set(entity: TEntity): void {
    assertEntity(entity);
    const copy = cloneEntity(entity);
    const cell = this.#cellKey(copy.position);
    const previousCell = this.#entityCells.get(copy.id);
    if (!previousCell && this.#entities.size >= this.maxEntities) {
      throw new RangeError("Session entity store is at its configured limit.");
    }
    if (previousCell) {
      this.#removeFromCell(copy.id, previousCell);
    }
    this.#entities.set(copy.id, copy);
    this.#entityCells.set(copy.id, cell);
    let entities = this.#cells.get(cell);
    if (!entities) {
      entities = new Set<string>();
      this.#cells.set(cell, entities);
    }
    entities.add(copy.id);
  }

  get(entityId: string): TEntity | undefined {
    const entity = this.#entities.get(entityId);
    return entity ? cloneEntity(entity) : undefined;
  }

  remove(entityId: string): boolean {
    const cell = this.#entityCells.get(entityId);
    if (!cell) {
      return false;
    }
    this.#removeFromCell(entityId, cell);
    this.#entityCells.delete(entityId);
    this.#entities.delete(entityId);
    return true;
  }

  queryRadius(center: Vector2, radius: number, maxCells = 4096): readonly TEntity[] {
    assertPoint(center);
    assertNonnegativeFinite(radius, "Query radius");
    if (!Number.isSafeInteger(maxCells) || maxCells < 1) {
      throw new RangeError("Maximum query cells must be a positive safe integer.");
    }
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (!Number.isSafeInteger(cellCount) || cellCount > maxCells) {
      throw new RangeError("Spatial query exceeds its cell-work limit.");
    }

    const found: TEntity[] = [];
    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        const ids = this.#cells.get(`${cellX},${cellY}`);
        if (!ids) {
          continue;
        }
        for (const id of ids) {
          const entity = this.#entities.get(id);
          if (entity && distanceSquared(center, entity.position) <= radius * radius) {
            found.push(cloneEntity(entity));
          }
        }
      }
    }
    return Object.freeze(found);
  }

  values(): readonly TEntity[] {
    return Object.freeze([...this.#entities.values()].map(cloneEntity));
  }

  #cellKey(position: Vector2): string {
    return `${Math.floor(position.x / this.cellSize)},${Math.floor(position.y / this.cellSize)}`;
  }

  #removeFromCell(entityId: string, key: string): void {
    const entities = this.#cells.get(key);
    if (!entities) {
      return;
    }
    entities.delete(entityId);
    if (entities.size === 0) {
      this.#cells.delete(key);
    }
  }
}

export class SessionWorld<TEntity extends WorldEntity = WorldEntity> {
  readonly geometry: WorldGeometry;
  readonly #entities: SpatialGrid<TEntity>;

  constructor(
    readonly sessionId: string,
    bounds: WorldBounds,
    obstacles: readonly Rect[] = [],
    cellSize = 32,
    maxEntities = MAX_ENTITIES_PER_SESSION
  ) {
    if (!sessionId.trim()) {
      throw new TypeError("Session ID must not be empty.");
    }
    this.#entities = new SpatialGrid<TEntity>(cellSize, maxEntities);
    this.geometry = new WorldGeometry(bounds, obstacles);
  }

  get entityCount(): number {
    return this.#entities.size;
  }

  getEntity(entityId: string): TEntity | undefined {
    return this.#entities.get(entityId);
  }

  queryEntities(center: Vector2, radius: number, maxCells = 4096): readonly TEntity[] {
    return this.#entities.queryRadius(center, radius, maxCells);
  }

  entities(): readonly TEntity[] {
    return this.#entities.values();
  }

  addEntity(entity: TEntity): void {
    if (!this.geometry.isCircleWalkable(entity.position, entity.radius)) {
      throw new RangeError("Entity position is outside walkable world geometry.");
    }
    this.#entities.set(entity);
  }

  moveEntity(entityId: string, delta: Vector2): TEntity {
    const entity = this.#entities.get(entityId);
    if (!entity) {
      throw new RangeError("Entity does not exist in this session.");
    }
    const position = this.geometry.moveCircle(entity.position, delta, entity.radius);
    const moved = { ...entity, position };
    this.#entities.set(moved);
    return this.#entities.get(entityId)!;
  }

  removeEntity(entityId: string): boolean {
    return this.#entities.remove(entityId);
  }
}

function assertEntity(entity: WorldEntity): void {
  if (
    typeof entity.id !== "string" ||
    entity.id.length < 1 ||
    entity.id.length > 128 ||
    typeof entity.typeId !== "string" ||
    entity.typeId.length < 1 ||
    entity.typeId.length > 128
  ) {
    throw new TypeError("World entity identifiers must contain 1–128 characters.");
  }
  assertPoint(entity.position);
  assertNonnegativeFinite(entity.radius, "Entity radius");
  validateJsonValue(entity.state, 0);
}

function cloneEntity<TEntity extends WorldEntity>(entity: TEntity): TEntity {
  const copy = structuredClone(entity);
  deepFreeze(copy);
  return copy;
}

function validateJsonValue(value: unknown, depth: number): asserts value is JsonValue {
  if (depth > 32) {
    throw new RangeError("Entity state exceeds the supported nesting depth.");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Entity state numbers must be finite.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      validateJsonValue(child, depth + 1);
    }
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Entity state must contain only plain JSON values.");
  }
  for (const child of Object.values(value)) {
    validateJsonValue(child, depth + 1);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function circleIntersectsRect(position: Vector2, radius: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(position.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(position.y, rect.y + rect.height));
  const distance = distanceSquared(position, { x: closestX, y: closestY });
  return radius === 0
    ? distance === 0
    : distance < radius * radius;
}

function distanceToRange(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
}

function distanceSquared(left: Vector2, right: Vector2): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function assertPoint(value: Vector2): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError("World coordinates must be finite.");
  }
}

function assertRect(value: Rect): void {
  assertPoint(value);
  assertPositiveFinite(value.width, "Obstacle width");
  assertPositiveFinite(value.height, "Obstacle height");
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and greater than zero.`);
  }
}

function assertNonnegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative.`);
  }
}
