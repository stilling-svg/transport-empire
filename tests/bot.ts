/**
 * A very simple computer player used by tests: it builds one truck line from
 * a coal mine to a power station and runs it.
 */
import { Occupant, WaterKind } from '../src/mapgen/types.ts';
import { dirBetween } from '../src/sim/constants.ts';
import { isStraightRoad } from '../src/sim/roads.ts';
import { findBuildPath } from '../src/sim/roadPlanner.ts';
import type { World } from '../src/sim/world.ts';

export interface BotLine {
  sourceStop: number;
  targetStop: number;
  trucks: number[];
  roadLength: number;
}

/** Free tiles 2–3 tiles from an industry, nearest to `toward` first. */
function tilesNear(world: World, ix: number, iy: number, toward: { x: number; y: number }): number[] {
  const { map } = world;
  const out: Array<{ i: number; d: number }> = [];
  for (let y = iy - 3; y <= iy + 4; y++) {
    for (let x = ix - 3; x <= ix + 4; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const i = y * map.width + x;
      if (map.water[i] !== WaterKind.None || map.occupant[i] !== Occupant.None || world.roads[i] !== 0) continue;
      out.push({ i, d: Math.hypot(x - toward.x, y - toward.y) });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.i);
}

/** Index of a straight road tile on the path (searching from `from` towards `to`) inside the industry's catchment. */
function stopTile(world: World, path: number[], from: number, to: number, industryId: number): number {
  const step = to > from ? 1 : -1;
  for (let k = from; k !== to; k += step) {
    if (k <= 0 || k >= path.length - 1) continue;
    const i = path[k]!;
    if (!isStraightRoad(world.roads[i]!) || world.stopAt[i]! >= 0) continue;
    const ind = world.map.industries[industryId]!;
    const x = i % world.map.width;
    const y = (i - x) / world.map.width;
    const dx = Math.max(ind.x - x, 0, x - (ind.x + 1));
    const dy = Math.max(ind.y - y, 0, y - (ind.y + 1));
    if (Math.max(dx, dy) <= 3) return i;
  }
  return -1;
}

export function buildCoalLine(world: World, trucks = 2): BotLine | null {
  const { map } = world;
  const mines = map.industries.filter((i) => i.type === 'coal_mine');
  const plants = map.industries.filter((i) => i.type === 'power_station');
  const pairs = mines
    .flatMap((m) => plants.map((p) => ({ m, p, d: Math.hypot(m.x - p.x, m.y - p.y) })))
    .filter((q) => q.d >= 15 && q.d <= 40)
    // Longer routes pay more; aim for about 25 tiles.
    .sort((a, b) => Math.abs(a.d - 25) - Math.abs(b.d - 25));

  for (const { m, p } of pairs) {
    for (const start of tilesNear(world, m.x, m.y, p).slice(0, 4)) {
      for (const end of tilesNear(world, p.x, p.y, m).slice(0, 4)) {
        const path = findBuildPath(world, start, end);
        if (!path || path.length < 6) continue;
        if (!world.buildRoad(path).ok) continue;
        const a = stopTile(world, path, 1, path.length - 1, m.id);
        const b = stopTile(world, path, path.length - 2, 0, p.id);
        if (a < 0 || b < 0 || a === b) continue;
        const w = map.width;
        if (Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w)) < 12) continue;
        if (!world.placeStop(a, 'truck').ok || !world.placeStop(b, 'truck').ok) continue;
        const sourceStop = world.stopAt[a]!;
        const targetStop = world.stopAt[b]!;
        // A depot beside the road near the mine.
        let depotId = -1;
        for (const i of path) {
          const x = i % map.width;
          const y = (i - x) / map.width;
          for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
            const n = (y + dy) * map.width + (x + dx);
            if (x + dx < 0 || y + dy < 0 || x + dx >= map.width || y + dy >= map.height) continue;
            if (dirBetween(map.width, i, n) === 0) continue;
            if (world.placeDepot(n).ok) {
              depotId = world.depotAt[n]!;
              break;
            }
          }
          if (depotId >= 0) break;
        }
        if (depotId < 0) continue;
        const ids: number[] = [];
        for (let k = 0; k < trucks; k++) {
          const t = world.buyVehicle(depotId, 'truck', 'coal');
          if (!t) break;
          world.setRoute(t.id, [
            { stopId: sourceStop, fullLoad: true },
            { stopId: targetStop, fullLoad: false },
          ]);
          ids.push(t.id);
        }
        return { sourceStop, targetStop, trucks: ids, roadLength: path.length };
      }
    }
  }
  return null;
}
