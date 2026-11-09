import { BoundedNavigation, NavigationGrid } from "./navigation.js";
import { SessionWorld, WorldGeometry, type Rect, type WorldBounds, type WorldEntity } from "./world.js";

export interface PreparedMapGeometry {
  readonly bounds: WorldBounds;
  readonly obstacles: readonly Rect[];
  readonly cellSize: number;
}

let nextTransitionToken = 0;

export class AuthoritativeMapTransition<TEntity extends WorldEntity = WorldEntity> {
  #pending: { token: number; geometry: WorldGeometry; grid: NavigationGrid } | undefined;

  constructor(
    readonly world: SessionWorld<TEntity>,
    readonly navigation: BoundedNavigation,
    readonly clearPathResults: () => void
  ) {}

  prepare(layout: PreparedMapGeometry): number {
    const geometry = new WorldGeometry(layout.bounds, layout.obstacles);
    const grid = new NavigationGrid(geometry.bounds, geometry, layout.cellSize,
      this.navigation.grid.agentRadius);
    if (nextTransitionToken >= Number.MAX_SAFE_INTEGER) throw new RangeError("Map transition tokens exhausted.");
    const token = ++nextTransitionToken;
    this.#pending = { token, geometry, grid };
    return token;
  }

  commit(token: number, entities: readonly TEntity[]): void {
    const prepared = this.#pending;
    if (!prepared || prepared.token !== token) {
      throw new RangeError("Map transition token is unknown, superseded or already committed.");
    }
    this.world.replaceLayout(prepared.geometry, entities);
    this.navigation.replaceGeometry(prepared.geometry, prepared.grid);
    this.clearPathResults();
    this.#pending = undefined;
  }
}
