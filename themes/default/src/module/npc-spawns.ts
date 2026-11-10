import { MAP_CELL_SIZE, type ModuleContext, type Point2 } from "@multiplayer-game/theme-sdk";
import type { LoadedMap } from "./maps.js";
import { PLAYER_RADIUS } from "./tuning.js";
import type { DefaultEntity } from "./types.js";

const ZONES_PER_AXIS = 4;
const NPC_RADIUS = 8;
const PLAYER_CLEARANCE_MARGIN = 16;
const SPAWN_BAND_WEIGHTS = [0.2, 0.4, 0.4] as const;

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

  const bands: Point2[][][] = Array.from(
    { length: SPAWN_BAND_WEIGHTS.length },
    () => Array.from({ length: ZONES_PER_AXIS ** 2 }, () => [])
  );
  const shorterSide = Math.min(map.definition.bounds.width, map.definition.bounds.height);
  for (const index of queue) {
    const position = positions[index]!;
    if (players.some(player => Math.hypot(player.x - position.x, player.y - position.y) <
      PLAYER_RADIUS + NPC_RADIUS + PLAYER_CLEARANCE_MARGIN)) continue;
    const edgeDistance = Math.min(
      position.x,
      position.y,
      map.definition.bounds.width - position.x,
      map.definition.bounds.height - position.y
    ) / shorterSide;
    const band = edgeDistance < 0.1 ? 0 : edgeDistance < 0.25 ? 1 : 2;
    const zoneX = Math.floor(position.x / map.definition.bounds.width * ZONES_PER_AXIS);
    const zoneY = Math.floor(position.y / map.definition.bounds.height * ZONES_PER_AXIS);
    bands[band]![zoneY * ZONES_PER_AXIS + zoneX]!.push(position);
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
  for (const band of bands) for (const zone of band) shuffle(zone);
  const zoneOrder = Array.from({ length: ZONES_PER_AXIS ** 2 }, (_, index) => index);
  shuffle(zoneOrder);
  const capacities = bands.map(band => band.reduce((total, zone) => total + zone.length, 0));
  const targets = SPAWN_BAND_WEIGHTS.map(weight => Math.floor(count * weight));
  const remainderOrder = SPAWN_BAND_WEIGHTS.map((weight, index) => ({
    index,
    remainder: count * weight - targets[index]!
  })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let remaining = count - targets.reduce((total, target) => total + target, 0),
    index = 0; remaining > 0; remaining -= 1, index += 1) {
    targets[remainderOrder[index]!.index]! += 1;
  }
  let redistributed = 0;
  for (let band = 0; band < targets.length; band += 1) {
    if (targets[band]! <= capacities[band]!) continue;
    redistributed += targets[band]! - capacities[band]!;
    targets[band] = capacities[band]!;
  }
  const usedRedistribution = redistributed > 0;
  while (redistributed > 0) {
    const available = targets.map((target, band) => ({ band, target }))
      .filter(({ band, target }) => target < capacities[band]!)
      .sort((a, b) =>
        SPAWN_BAND_WEIGHTS[b.band]! / (b.target + 1) -
        SPAWN_BAND_WEIGHTS[a.band]! / (a.target + 1) || a.band - b.band);
    if (available.length === 0) break;
    targets[available[0]!.band]! += 1;
    redistributed -= 1;
  }

  const selected: Point2[] = [];
  const zoneCounts = Array(ZONES_PER_AXIS ** 2).fill(0) as number[];
  const quadrantCounts = Array(4).fill(0) as number[];
  const availableZoneCount = new Set(bands.flatMap(band =>
    band.flatMap((zone, index) => zone.length > 0 ? [index] : []))).size;
  for (let band = 0; band < bands.length; band += 1) {
    for (let placed = 0; placed < targets[band]!; placed += 1) {
      const availableZones = zoneOrder.filter(zone => bands[band]![zone]!.length > 0)
        .sort((a, b) => {
          const quadrantA = (a % ZONES_PER_AXIS >= ZONES_PER_AXIS / 2 ? 1 : 0) +
            (Math.floor(a / ZONES_PER_AXIS) >= ZONES_PER_AXIS / 2 ? 2 : 0);
          const quadrantB = (b % ZONES_PER_AXIS >= ZONES_PER_AXIS / 2 ? 1 : 0) +
            (Math.floor(b / ZONES_PER_AXIS) >= ZONES_PER_AXIS / 2 ? 2 : 0);
          return quadrantCounts[quadrantA]! - quadrantCounts[quadrantB]! ||
            zoneCounts[a]! - zoneCounts[b]!;
        });
      const zone = availableZones[0];
      if (zone === undefined) break;
      const position = bands[band]![zone]!.pop()!;
      selected.push(position);
      zoneCounts[zone]! += 1;
      const quadrant = (zone % ZONES_PER_AXIS >= ZONES_PER_AXIS / 2 ? 1 : 0) +
        (Math.floor(zone / ZONES_PER_AXIS) >= ZONES_PER_AXIS / 2 ? 2 : 0);
      quadrantCounts[quadrant]! += 1;
    }
  }
  if (usedRedistribution || availableZoneCount < ZONES_PER_AXIS ** 2) {
    context.metrics.increment("default.npc_spawn.zone_fallback");
  }
  if (selected.length !== count) {
    context.metrics.increment("default.npc_spawn.insufficient_space");
    throw new RangeError(
      `Map provides only ${selected.length} reachable clear NPC locations for ${count} enemies.`
    );
  }
  return selected;
}
