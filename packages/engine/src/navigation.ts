import {
  WorldGeometry,
  type Vector2,
  type WorldBounds
} from "./world.js";

export const MAX_PATH_SEARCHES_PER_TICK = 8;
export const MAX_PATH_NODES_PER_SEARCH = 2_048;
export const MAX_PATH_NODES_PER_TICK = 2_048;
export const MAX_PATH_SEARCH_NODES_PER_TICK = 256;
export const MAX_OUTSTANDING_PATH_REQUESTS = 256;
export const MAX_NAVIGATION_GRID_CELLS = 1_000_000;

export interface NavigationOptions {
  readonly cellSize?: number;
  readonly agentRadius?: number;
  readonly maxSearchesPerTick?: number;
  readonly maxNodesPerSearch?: number;
  readonly maxNodesPerTick?: number;
  readonly maxNodesPerSearchPerTick?: number;
  readonly maxOutstandingRequests?: number;
}

export type PathResult =
  | {
      readonly status: "found";
      readonly path: readonly Vector2[];
      readonly expandedNodes: number;
    }
  | {
      readonly status: "no-path" | "limit";
      readonly path: readonly Vector2[];
      readonly expandedNodes: number;
    };

export interface NavigationTickStats {
  readonly startedSearches: number;
  readonly nodesProcessed: number;
  readonly completedSearches: number;
  readonly activeSearches: number;
  readonly queuedRequests: number;
}

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly index: number;
  readonly position: Vector2;
}

interface HeapNode {
  readonly index: number;
  readonly cost: number;
  readonly priority: number;
}

interface SearchJob {
  readonly id: number;
  readonly start: Vector2;
  readonly goal: Vector2;
  readonly startCell: Cell | undefined;
  readonly goalCell: Cell | undefined;
  readonly onComplete: (result: PathResult) => void;
  readonly open: MinHeap<HeapNode>;
  readonly costs: Map<number, number>;
  readonly cameFrom: Map<number, number>;
  readonly closed: Set<number>;
  processedNodes: number;
  expandedNodes: number;
  processedThisTick: number;
}

export class NavigationGrid {
  readonly columns: number;
  readonly rows: number;
  readonly #cellCount: number;

  constructor(
    readonly bounds: WorldBounds,
    readonly geometry: WorldGeometry,
    readonly cellSize: number,
    readonly agentRadius = 0
  ) {
    positiveFinite(cellSize, "Navigation cell size");
    nonnegativeFinite(agentRadius, "Navigation agent radius");
    this.columns = Math.ceil(bounds.width / cellSize);
    this.rows = Math.ceil(bounds.height / cellSize);
    this.#cellCount = this.columns * this.rows;
    if (
      !Number.isSafeInteger(this.columns) ||
      !Number.isSafeInteger(this.rows) ||
      !Number.isSafeInteger(this.#cellCount) ||
      this.#cellCount > MAX_NAVIGATION_GRID_CELLS
    ) {
      throw new RangeError("Navigation grid exceeds the supported cell limit.");
    }
  }

  cellAt(position: Vector2): Cell | undefined {
    if (
      !finitePoint(position) ||
      position.x < 0 ||
      position.y < 0 ||
      position.x > this.bounds.width ||
      position.y > this.bounds.height
    ) {
      return undefined;
    }
    const x = Math.min(this.columns - 1, Math.floor(position.x / this.cellSize));
    const y = Math.min(this.rows - 1, Math.floor(position.y / this.cellSize));
    const cell = this.#cell(x, y);
    return this.isWalkable(cell) ? cell : undefined;
  }

  canTraverse(from: Vector2, to: Vector2): boolean {
    const moved = this.geometry.moveCircle(
      from,
      { x: to.x - from.x, y: to.y - from.y },
      this.agentRadius
    );
    return Math.abs(moved.x - to.x) < 1e-6 && Math.abs(moved.y - to.y) < 1e-6;
  }

  isWalkable(cell: Cell): boolean {
    return this.geometry.isCircleWalkable(cell.position, this.agentRadius);
  }

  neighbors(cell: Cell): readonly Cell[] {
    const result: Cell[] = [];
    const adjacent = [
      [cell.x + 1, cell.y],
      [cell.x - 1, cell.y],
      [cell.x, cell.y + 1],
      [cell.x, cell.y - 1]
    ] as const;
    for (const [x, y] of adjacent) {
      if (x < 0 || x >= this.columns || y < 0 || y >= this.rows) {
        continue;
      }
      const next = this.#cell(x, y);
      if (
        this.isWalkable(next) &&
        this.canTraverse(cell.position, next.position)
      ) {
        result.push(next);
      }
    }
    return result;
  }

  cellByIndex(index: number): Cell {
    return this.#cell(index % this.columns, Math.floor(index / this.columns));
  }

  #cell(x: number, y: number): Cell {
    const position = Object.freeze({
      x: Math.min((x + 0.5) * this.cellSize, this.bounds.width),
      y: Math.min((y + 0.5) * this.cellSize, this.bounds.height)
    });
    return Object.freeze({ x, y, index: y * this.columns + x, position });
  }

}

export class BoundedNavigation {
  readonly grid: NavigationGrid;
  readonly #maxSearchesPerTick: number;
  readonly #maxNodesPerSearch: number;
  readonly #maxNodesPerTick: number;
  readonly #maxNodesPerSearchPerTick: number;
  readonly #maxOutstandingRequests: number;
  readonly #queue: SearchJob[] = [];
  readonly #active: SearchJob[] = [];
  #nextId = 1;
  #activeCursor = 0;
  #lastTickStats: NavigationTickStats = Object.freeze({
    startedSearches: 0,
    nodesProcessed: 0,
    completedSearches: 0,
    activeSearches: 0,
    queuedRequests: 0
  });

  constructor(
    readonly geometry: WorldGeometry,
    options: NavigationOptions = {}
  ) {
    const cellSize = options.cellSize ?? 32;
    const agentRadius = options.agentRadius ?? 0;
    this.#maxSearchesPerTick = positiveInteger(
      options.maxSearchesPerTick ?? MAX_PATH_SEARCHES_PER_TICK,
      "Searches per tick"
    );
    this.#maxNodesPerSearch = positiveInteger(
      options.maxNodesPerSearch ?? MAX_PATH_NODES_PER_SEARCH,
      "Nodes per search"
    );
    this.#maxNodesPerTick = positiveInteger(
      options.maxNodesPerTick ?? MAX_PATH_NODES_PER_TICK,
      "Nodes per tick"
    );
    this.#maxNodesPerSearchPerTick = positiveInteger(
      options.maxNodesPerSearchPerTick ?? MAX_PATH_SEARCH_NODES_PER_TICK,
      "Nodes per search per tick"
    );
    this.#maxOutstandingRequests = positiveInteger(
      options.maxOutstandingRequests ?? MAX_OUTSTANDING_PATH_REQUESTS,
      "Outstanding path requests"
    );
    if (
      this.#maxNodesPerSearchPerTick > this.#maxNodesPerSearch ||
      this.#maxNodesPerSearchPerTick > this.#maxNodesPerTick
    ) {
      throw new RangeError("Per-tick path work must not exceed the configured total work limit.");
    }
    this.grid = new NavigationGrid(
      geometry.bounds,
      geometry,
      cellSize,
      agentRadius
    );
  }

  get stats(): NavigationTickStats {
    return this.#lastTickStats;
  }

  get outstandingRequests(): number {
    return this.#queue.length + this.#active.length;
  }

  requestPath(
    start: Vector2,
    goal: Vector2,
    onComplete: (result: PathResult) => void
  ): number | undefined {
    assertPoint(start);
    assertPoint(goal);
    if (this.outstandingRequests >= this.#maxOutstandingRequests) {
      return undefined;
    }
    const startCopy = Object.freeze({ ...start });
    const goalCopy = Object.freeze({ ...goal });
    const candidateStartCell = this.grid.cellAt(startCopy);
    const candidateGoalCell = this.grid.cellAt(goalCopy);
    const startCell =
      candidateStartCell && this.grid.canTraverse(startCopy, candidateStartCell.position)
        ? candidateStartCell
        : undefined;
    const goalCell =
      candidateGoalCell && this.grid.canTraverse(candidateGoalCell.position, goalCopy)
        ? candidateGoalCell
        : undefined;
    const id = this.#nextId;
    this.#nextId += 1;
    this.#queue.push({
      id,
      start: startCopy,
      goal: goalCopy,
      startCell,
      goalCell,
      onComplete,
      open: new MinHeap<HeapNode>(compareHeapNodes),
      costs: new Map<number, number>(),
      cameFrom: new Map<number, number>(),
      closed: new Set<number>(),
      processedNodes: 0,
      expandedNodes: 0,
      processedThisTick: 0
    });
    return id;
  }

  processTick(): NavigationTickStats {
    for (const job of this.#active) {
      job.processedThisTick = 0;
    }

    let startedSearches = 0;
    let completedSearches = 0;
    while (
      startedSearches < this.#maxSearchesPerTick &&
      this.#queue.length > 0
    ) {
      const job = this.#queue.shift()!;
      startedSearches += 1;
      if (!job.startCell || !job.goalCell) {
        this.#complete(job, noPath(0));
        completedSearches += 1;
        continue;
      }
      job.costs.set(job.startCell.index, 0);
      job.open.push({
        index: job.startCell.index,
        cost: 0,
        priority: manhattan(job.startCell, job.goalCell)
      });
      this.#active.push(job);
    }

    let nodesProcessed = 0;
    let idlePasses = 0;
    while (nodesProcessed < this.#maxNodesPerTick && this.#active.length > 0) {
      if (this.#activeCursor >= this.#active.length) {
        this.#activeCursor = 0;
      }
      const job = this.#active[this.#activeCursor]!;
      if (job.processedThisTick >= this.#maxNodesPerSearchPerTick) {
        this.#activeCursor += 1;
        idlePasses += 1;
        if (idlePasses >= this.#active.length) {
          break;
        }
        continue;
      }

      idlePasses = 0;
      const beforeCount = this.#active.length;
      const result = this.#advance(job);
      nodesProcessed += result.nodesProcessed;
      if (result.completed) {
        this.#complete(job, result.completed);
        completedSearches += 1;
        if (this.#active.length < beforeCount && this.#activeCursor >= this.#active.length) {
          this.#activeCursor = 0;
        }
      } else {
        this.#activeCursor += 1;
      }
    }

    this.#lastTickStats = Object.freeze({
      startedSearches,
      nodesProcessed,
      completedSearches,
      activeSearches: this.#active.length,
      queuedRequests: this.#queue.length
    });
    return this.#lastTickStats;
  }

  #advance(
    job: SearchJob
  ): { readonly nodesProcessed: number; readonly completed?: PathResult } {
    if (job.processedNodes >= this.#maxNodesPerSearch) {
      return { nodesProcessed: 0, completed: limited(job.expandedNodes) };
    }
    const current = job.open.pop();
    if (!current) {
      return { nodesProcessed: 0, completed: noPath(job.expandedNodes) };
    }
    job.processedNodes += 1;
    job.processedThisTick += 1;
    const knownCost = job.costs.get(current.index);
    if (knownCost === undefined || current.cost !== knownCost || job.closed.has(current.index)) {
      return {
        nodesProcessed: 1,
        ...(job.processedNodes >= this.#maxNodesPerSearch
          ? { completed: limited(job.expandedNodes) }
          : {})
      };
    }

    job.expandedNodes += 1;
    if (current.index === job.goalCell!.index) {
      return {
        nodesProcessed: 1,
        completed: found(this.#buildPath(job), job.expandedNodes)
      };
    }

    job.closed.add(current.index);
    const currentCell = this.grid.cellByIndex(current.index);
    for (const neighbor of this.grid.neighbors(currentCell)) {
      if (job.closed.has(neighbor.index)) {
        continue;
      }
      const nextCost = current.cost + 1;
      const oldCost = job.costs.get(neighbor.index);
      if (oldCost !== undefined && nextCost >= oldCost) {
        continue;
      }
      job.costs.set(neighbor.index, nextCost);
      job.cameFrom.set(neighbor.index, current.index);
      job.open.push({
        index: neighbor.index,
        cost: nextCost,
        priority: nextCost + manhattan(neighbor, job.goalCell!)
      });
    }

    if (job.processedNodes >= this.#maxNodesPerSearch) {
      return { nodesProcessed: 1, completed: limited(job.expandedNodes) };
    }
    if (job.open.size === 0) {
      return { nodesProcessed: 1, completed: noPath(job.expandedNodes) };
    }
    return { nodesProcessed: 1 };
  }

  #buildPath(job: SearchJob): readonly Vector2[] {
    const reversed: Vector2[] = [];
    let currentIndex = job.goalCell!.index;
    reversed.push(job.goalCell!.position);
    while (currentIndex !== job.startCell!.index) {
      const previous = job.cameFrom.get(currentIndex);
      if (previous === undefined) {
        return Object.freeze([]);
      }
      currentIndex = previous;
      reversed.push(this.grid.cellByIndex(currentIndex).position);
    }
    reversed.reverse();
    const points: Vector2[] = [job.start];
    for (const point of reversed) {
      if (points.at(-1)?.x !== point.x || points.at(-1)?.y !== point.y) {
        points.push(point);
      }
    }
    if (points.at(-1)?.x !== job.goal.x || points.at(-1)?.y !== job.goal.y) {
      points.push(job.goal);
    }
    return Object.freeze(points.map((point) => Object.freeze({ ...point })));
  }

  #complete(job: SearchJob, result: PathResult): void {
    const activeIndex = this.#active.indexOf(job);
    if (activeIndex >= 0) {
      this.#active.splice(activeIndex, 1);
      if (activeIndex < this.#activeCursor) {
        this.#activeCursor -= 1;
      }
    }
    job.onComplete(result);
  }
}

class MinHeap<T> {
  readonly #values: T[] = [];

  constructor(readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.#values.length;
  }

  push(value: T): void {
    this.#values.push(value);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.#values[parent]!, value) <= 0) {
        break;
      }
      this.#values[index] = this.#values[parent]!;
      index = parent;
    }
    this.#values[index] = value;
  }

  pop(): T | undefined {
    const first = this.#values[0];
    const last = this.#values.pop();
    if (this.#values.length > 0 && last !== undefined) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.#values.length) {
          break;
        }
        const child =
          right < this.#values.length &&
          this.compare(this.#values[right]!, this.#values[left]!) < 0
            ? right
            : left;
        if (this.compare(last, this.#values[child]!) <= 0) {
          break;
        }
        this.#values[index] = this.#values[child]!;
        index = child;
      }
      this.#values[index] = last;
    }
    return first;
  }
}

function compareHeapNodes(left: HeapNode, right: HeapNode): number {
  return left.priority - right.priority || left.index - right.index;
}

function manhattan(left: Cell, right: Cell): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function found(path: readonly Vector2[], expandedNodes: number): PathResult {
  return Object.freeze({ status: "found", path, expandedNodes });
}

function noPath(expandedNodes: number): PathResult {
  return Object.freeze({ status: "no-path", path: Object.freeze([]), expandedNodes });
}

function limited(expandedNodes: number): PathResult {
  return Object.freeze({ status: "limit", path: Object.freeze([]), expandedNodes });
}

function finitePoint(point: Vector2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function assertPoint(point: Vector2): void {
  if (!finitePoint(point)) {
    throw new TypeError("Navigation coordinates must be finite.");
  }
}

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero.`);
  }
}

function nonnegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative.`);
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}
