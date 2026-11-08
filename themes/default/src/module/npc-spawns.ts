import { MAP_CELL_SIZE, type ModuleContext, type Point2 } from "@multiplayer-game/theme-sdk";
import type { LoadedMap } from "./maps.js";
import { PLAYER_RADIUS } from "./tuning.js";
import type { DefaultEntity } from "./types.js";

const ZONES_PER_AXIS = 4;
const NPC_RADIUS = 8;
const PLAYER_CLEARANCE_MARGIN = 16;

export function selectNpcSpawns(
  context: ModuleContext<DefaultEntity>,
  map: LoadedMap,
  players: readonly Point2[],
  seed: number,
  wave: number,
  count: number
): Point2[] {
  const columns = map.definition.bounds.width / MAP_CELL_SIZE;
  const rows = map.definition.bounds.height / MAP_CELL_SIZE;
  const cellCount = columns * rows;
  const positions = Array.from({ length: cellCount }, (_, index) => ({
    x: (index % columns + 0.5) * MAP_CELL_SIZE,
    y: (Math.floor(index / columns) + 0.5) * MAP_CELL_SIZE
  }));
  const walkable = positions.map(position =>
    map.isWalkable(position, PLAYER_RADIUS) &&
    context.geometry.isWalkable(position.x, position.y, PLAYER_RADIUS) &&
    !context.geometry.intersectsObstacle(position.x, position.y, PLAYER_RADIUS)
  );
  const visited = new Uint8Array(cellCount);
  const queue: number[] = [];
  const origins = players.length > 0 ? players
    : map.definition.spawns.filter(spawn => spawn.kind === "player").map(spawn => spawn.position);
  for (const origin of origins) {
    const index = Math.floor(origin.y / MAP_CELL_SIZE) * columns +
      Math.floor(origin.x / MAP_CELL_SIZE);
    const position = positions[index];
    if (!position || !walkable[index] || visited[index]) continue;
    const moved = context.geometry.moveCircle(origin, {
      x: position.x - origin.x, y: position.y - origin.y
    }, PLAYER_RADIUS);
    if (Math.hypot(moved.x - position.x, moved.y - position.y) > 1e-6) continue;
    visited[index] = 1;
    queue.push(index);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    const x = index % columns;
    const y = Math.floor(index / columns);
    const adjacent = [
      x > 0 ? index - 1 : -1, x + 1 < columns ? index + 1 : -1,
      y > 0 ? index - columns : -1, y + 1 < rows ? index + columns : -1
    ];
    for (const next of adjacent) {
      if (next < 0 || visited[next] || !walkable[next]) continue;
      const from = positions[index]!;
      const to = positions[next]!;
      const moved = context.geometry.moveCircle(from, {
        x: to.x - from.x, y: to.y - from.y
      }, PLAYER_RADIUS);
      if (Math.hypot(moved.x - to.x, moved.y - to.y) > 1e-6) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }

  const zones: Point2[][] = Array.from({ length: ZONES_PER_AXIS ** 2 }, () => []);
  for (const index of queue) {
    const position = positions[index]!;
    if (players.some(player => Math.hypot(player.x - position.x, player.y - position.y) <
      PLAYER_RADIUS + NPC_RADIUS + PLAYER_CLEARANCE_MARGIN)) continue;
    const zoneX = Math.floor(position.x / map.definition.bounds.width * ZONES_PER_AXIS);
    const zoneY = Math.floor(position.y / map.definition.bounds.height * ZONES_PER_AXIS);
    zones[zoneY * ZONES_PER_AXIS + zoneX]!.push(position);
  }

  // A private stream keeps placement independent of respawn/pickup RNG consumption.
  let randomState = (seed >>> 0) ^ Math.imul(wave, 0x9e3779b9);
  const random = (): number => {
    randomState = (randomState + 0x6d2b79f5) | 0;
    let value = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const shuffle = <T>(items: T[]): void => {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [items[index], items[other]] = [items[other]!, items[index]!];
    }
  };
  for (const zone of zones) shuffle(zone);
  shuffle(zones);
  const selected: Point2[] = [];
  let fallback = false;
  while (selected.length < count) {
    let added = false;
    for (const zone of zones) {
      if (selected.length === count) break;
      const position = zone.pop();
      if (position) {
        selected.push(position);
        added = true;
      } else {
        fallback = true;
      }
    }
    if (!added) break;
  }
  if (fallback) context.metrics.increment("default.npc_spawn.zone_fallback");
  if (selected.length !== count) {
    context.metrics.increment("default.npc_spawn.insufficient_space");
    throw new RangeError(
      `Map provides only ${selected.length} reachable clear NPC locations for ${count} enemies.`
    );
  }
  return selected;
}
