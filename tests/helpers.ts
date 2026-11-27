import { DEFAULT_SETTINGS, Terrain, WaterKind, type GameMap } from '../src/mapgen/types.ts';

/** A small hand-made map: flat grass at height 1, no towns or industries. */
export function flatMap(width = 16, height = 16): GameMap {
  const n = width * height;
  return {
    seed: 'test',
    usedSeed: 'test',
    attempts: 1,
    settings: { ...DEFAULT_SETTINGS, size: 'small' },
    width,
    height,
    maxHeight: 5,
    heights: new Uint8Array(n).fill(1),
    terrain: new Uint8Array(n).fill(Terrain.Grass),
    water: new Uint8Array(n),
    occupant: new Uint8Array(n),
    occupantId: new Int16Array(n).fill(-1),
    towns: [],
    industries: [],
  };
}

export function setWater(map: GameMap, x: number, y: number, kind: number): void {
  const i = y * map.width + x;
  map.water[i] = kind;
  map.terrain[i] = Terrain.Water;
  if (kind === WaterKind.Sea) map.heights[i] = 0;
}

/** Tile indices of a straight horizontal line from (x0, y) to (x1, y). */
export function row(map: GameMap, y: number, x0: number, x1: number): number[] {
  const out: number[] = [];
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + step; x += step) out.push(y * map.width + x);
  return out;
}

/** Tile indices of a straight vertical line from (x, y0) to (x, y1). */
export function col(map: GameMap, x: number, y0: number, y1: number): number[] {
  const out: number[] = [];
  const step = y1 >= y0 ? 1 : -1;
  for (let y = y0; y !== y1 + step; y += step) out.push(y * map.width + x);
  return out;
}
