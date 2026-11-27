import { WaterKind, type GameMap, type Industry, type Town } from './types.ts';

/** 4-neighbour offsets. */
export const DIR4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Centre point of a 2x2 industry footprint. */
export function industryCenter(ind: Industry): { x: number; y: number } {
  return { x: ind.x + 0.5, y: ind.y + 0.5 };
}

export function townCenter(town: Town): { x: number; y: number } {
  return { x: town.x, y: town.y };
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Tiles land transport can cross. Rivers count as crossable because they are
 * one tile wide and can always be bridged; sea and lakes split landmasses.
 */
export function isPassable(water: number): boolean {
  return water === WaterKind.None || water === WaterKind.River;
}

/**
 * Labels connected landmasses (4-connectivity over passable tiles).
 * Returns the label per tile (-1 for sea/lake) and the size of each label.
 */
export function labelLandmasses(
  width: number,
  height: number,
  water: Uint8Array,
): { labels: Int32Array; sizes: number[] } {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !isPassable(water[start]!)) continue;
    const label = sizes.length;
    let size = 0;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    while (sp > 0) {
      const i = stack[--sp]!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (labels[j] !== -1 || !isPassable(water[j]!)) continue;
        labels[j] = label;
        stack[sp++] = j;
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

export function largestLabel(sizes: number[]): number {
  let best = -1;
  let bestSize = -1;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i]! > bestSize) {
      bestSize = sizes[i]!;
      best = i;
    }
  }
  return best;
}

export function landmassOf(map: GameMap, labels: Int32Array, x: number, y: number): number {
  return labels[Math.floor(y) * map.width + Math.floor(x)]!;
}
