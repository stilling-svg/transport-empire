/**
 * Road rules: what can be built where, and what it costs (GDD 3.2 and 5.1).
 */
import costs from '../data/costs.json' with { type: 'json' };
import { Occupant, Terrain, WaterKind, type GameMap } from '../mapgen/types.ts';
import { DIRS, RoadOwner, dirBetween } from './constants.ts';

/** Minimal view of the world the road rules need. */
export interface RoadState {
  map: GameMap;
  roads: Uint8Array;
  roadOwner: Uint8Array;
  depotAt: Int32Array;
}

export interface PlannedTile {
  index: number;
  ok: boolean;
  /** Why this tile cannot be built, if not ok. */
  reason?: string;
  /** Cost of this tile (0 if it already has road). */
  cost: number;
  bridge: boolean;
}

export interface RoadPlan {
  ok: boolean;
  tiles: PlannedTile[];
  cost: number;
  /** Road bits to add: [tile index, direction bit]. Both ends of every link are listed. */
  links: Array<[number, number]>;
  reason?: string;
}

const TERRAIN_MULT: Record<number, number> = {
  [Terrain.Grass]: costs.terrainMultiplier.grass,
  [Terrain.Rough]: costs.terrainMultiplier.rough,
  [Terrain.Farmland]: costs.terrainMultiplier.farmland,
  [Terrain.Forest]: costs.terrainMultiplier.forest,
  [Terrain.Rock]: costs.terrainMultiplier.rock,
};

/** Checks a path of 4-adjacent tiles and works out what building a road on it costs. */
export function planRoad(state: RoadState, path: readonly number[]): RoadPlan {
  const { map, roads } = state;
  const { width } = map;
  const tiles: PlannedTile[] = [];
  const links: Array<[number, number]> = [];
  let ok = path.length >= 2;
  let reason: string | undefined = ok ? undefined : 'Drag across at least two tiles';

  for (let k = 0; k < path.length; k++) {
    const i = path[k]!;
    const prev = k > 0 ? path[k - 1]! : -1;
    const next = k < path.length - 1 ? path[k + 1]! : -1;
    const tile: PlannedTile = { index: i, ok: true, cost: 0, bridge: false };
    const fail = (why: string): void => {
      tile.ok = false;
      tile.reason ??= why;
    };

    if (i < 0 || i >= map.heights.length) fail('Outside the map');
    else {
      const water = map.water[i]!;
      if (water === WaterKind.Sea || water === WaterKind.Lake) fail('Cannot build on open water');
      if (map.occupant[i] === Occupant.Industry) fail('An industry is in the way');
      if (state.depotAt[i]! >= 0) fail('A depot is in the way');
      if (map.occupant[i] === Occupant.Town && roads[i] === 0) fail('Houses are in the way');

      if (water === WaterKind.River) {
        tile.bridge = true;
        const straight =
          prev >= 0 && next >= 0 && dirBetween(width, prev, i) === dirBetween(width, i, next);
        if (!straight) fail('Bridges must cross the river in a straight line');
        else if (roads[i] !== 0 && roads[i] !== (dirBetween(width, prev, i) | dirBetween(width, i, next))) {
          fail('Bridges cannot have junctions');
        }
      }

      for (const n of [prev, next]) {
        if (n < 0) continue;
        if (dirBetween(width, i, n) === 0) fail('Path must be continuous');
        else if (Math.abs(map.heights[i]! - map.heights[n]!) > costs.maxRoadClimb) fail('Too steep');
      }
    }

    if (tile.ok && roads[i] === 0) {
      if (tile.bridge) tile.cost = costs.bridgePerTile;
      else {
        const terrain = map.terrain[i]!;
        let c = costs.roadPerTile * (TERRAIN_MULT[terrain] ?? 1);
        if (terrain === Terrain.Forest) c += costs.forestClearing;
        const sloped = [prev, next].some((n) => n >= 0 && map.heights[n] !== map.heights[i]);
        if (sloped) c *= costs.slopeMultiplier;
        tile.cost = Math.round(c);
      }
    }
    if (!tile.ok) {
      ok = false;
      reason ??= tile.reason;
    }
    tiles.push(tile);
  }

  if (ok) {
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k]!;
      const b = path[k + 1]!;
      const d = dirBetween(width, a, b);
      const back = dirBetween(width, b, a);
      if ((roads[a]! & d) === 0) links.push([a, d]);
      if ((roads[b]! & back) === 0) links.push([b, back]);
    }
  }
  const cost = tiles.reduce((s, t) => s + t.cost, 0);
  return { ok, tiles, cost, links, reason };
}

/**
 * Lays out a simple street grid in every town: a cross through the centre,
 * plus a square ring for bigger towns. Town streets are free to use.
 */
export function buildTownRoads(state: RoadState): void {
  const { map, roads, roadOwner } = state;
  const { width, height } = map;

  const canStreet = (x: number, y: number, townId: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = y * width + x;
    if (map.water[i] !== WaterKind.None) return false;
    if (map.occupant[i] === Occupant.Industry) return false;
    if (map.occupant[i] === Occupant.Town) return map.occupantId[i] === townId;
    return map.terrain[i] !== Terrain.Rock;
  };

  const link = (ax: number, ay: number, bx: number, by: number, townId: number): void => {
    if (!canStreet(ax, ay, townId) || !canStreet(bx, by, townId)) return;
    const a = ay * width + ax;
    const b = by * width + bx;
    if (Math.abs(map.heights[a]! - map.heights[b]!) > costs.maxRoadClimb) return;
    roads[a] = roads[a]! | dirBetween(width, a, b);
    roads[b] = roads[b]! | dirBetween(width, b, a);
    for (const i of [a, b]) {
      if (roadOwner[i] === RoadOwner.None) roadOwner[i] = RoadOwner.Town;
      if (map.terrain[i] === Terrain.Forest || map.terrain[i] === Terrain.Farmland) {
        map.terrain[i] = Terrain.Grass;
      }
    }
  };

  for (const town of map.towns) {
    const r = town.population >= 600 ? 2 : 1;
    const reach = r + 1;
    const { x: cx, y: cy, id } = town;
    // Cross through the centre, reaching one tile beyond the houses.
    for (let x = cx - reach; x < cx + reach; x++) link(x, cy, x + 1, cy, id);
    for (let y = cy - reach; y < cy + reach; y++) link(cx, y, cx, y + 1, id);
    if (r === 2) {
      for (const yy of [cy - 2, cy + 2]) for (let x = cx - 2; x < cx + 2; x++) link(x, yy, x + 1, yy, id);
      for (const xx of [cx - 2, cx + 2]) for (let y = cy - 2; y < cy + 2; y++) link(xx, y, xx, y + 1, id);
    }
  }
}

/** True if the tile's road runs straight through (N–S or E–W) with no junction. */
export function isStraightRoad(bits: number): boolean {
  return bits === (DIRS[0]!.bit | DIRS[2]!.bit) || bits === (DIRS[1]!.bit | DIRS[3]!.bit);
}
