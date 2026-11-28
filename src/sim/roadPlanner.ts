/**
 * Finds a buildable road route between two tiles across open terrain,
 * following the same rules as the player's road tool (slopes, straight
 * bridges over rivers, no building through houses or industries).
 * Used by the test bot today and by computer opponents later.
 */
import costs from '../data/costs.json' with { type: 'json' };
import { Occupant, Terrain, WaterKind } from '../mapgen/types.ts';
import { DIRS } from './constants.ts';
import type { World } from './world.ts';

class Heap {
  private items: Array<[number, number]> = [];
  get size(): number {
    return this.items.length;
  }
  push(key: number, prio: number): void {
    const a = this.items;
    a.push([key, prio]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![1] <= a[i]![1]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]![0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![1] < a[m]![1]) m = l;
        if (r < a.length && a[r]![1] < a[m]![1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Returns a list of 4-adjacent tiles from start to goal that the road tool would accept, or null. */
export function findBuildPath(world: World, start: number, goal: number, maxExpanded = 300_000): number[] | null {
  const { map } = world;
  const { width, height } = map;
  const enterable = (i: number): boolean => {
    const water = map.water[i]!;
    if (water === WaterKind.Sea || water === WaterKind.Lake) return false;
    if (map.occupant[i] === Occupant.Industry || world.depotAt[i]! >= 0) return false;
    if (map.occupant[i] === Occupant.Town && world.roads[i] === 0) return false;
    if (water === WaterKind.River && world.roads[i] !== 0) return false;
    return true;
  };
  if (!enterable(start) || !enterable(goal)) return null;
  if (map.water[start] === WaterKind.River || map.water[goal] === WaterKind.River) return null;

  // State = tile * 5 + incoming direction index (4 = none).
  const gx = goal % width;
  const gy = (goal - gx) / width;
  const cost = new Map<number, number>();
  const came = new Map<number, number>();
  const open = new Heap();
  const startKey = start * 5 + 4;
  cost.set(startKey, 0);
  open.push(startKey, 0);
  let expanded = 0;

  while (open.size > 0 && expanded++ < maxExpanded) {
    const key = open.pop();
    const tile = Math.floor(key / 5);
    const inDir = key % 5;
    if (tile === goal) {
      const path: number[] = [];
      let k: number | undefined = key;
      while (k !== undefined) {
        path.push(Math.floor(k / 5));
        k = came.get(k);
      }
      return path.reverse();
    }
    const g = cost.get(key)!;
    const x = tile % width;
    const y = (tile - x) / width;
    const onRiver = map.water[tile] === WaterKind.River;
    for (let di = 0; di < 4; di++) {
      if (onRiver && di !== inDir) continue; // bridges are straight
      const d = DIRS[di]!;
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (!enterable(n)) continue;
      if (n === goal && map.water[n] === WaterKind.River) continue;
      if (Math.abs(map.heights[n]! - map.heights[tile]!) > costs.maxRoadClimb) continue;
      let step: number;
      if ((world.roads[tile]! & d.bit) !== 0 && (world.roads[n]! & d.opposite) !== 0) step = 0.3;
      else if (map.water[n] === WaterKind.River) step = costs.bridgePerTile / costs.roadPerTile;
      else {
        const t = map.terrain[n]!;
        step = t === Terrain.Rock ? 3 : t === Terrain.Farmland ? 1.5 : t === Terrain.Forest ? 1.5 : 1;
        if (map.heights[n] !== map.heights[tile]) step *= 1.5;
      }
      const nk = n * 5 + di;
      const ng = g + step;
      const known = cost.get(nk);
      if (known !== undefined && known <= ng) continue;
      cost.set(nk, ng);
      came.set(nk, key);
      open.push(nk, ng + Math.abs(nx - gx) + Math.abs(ny - gy));
    }
  }
  return null;
}
