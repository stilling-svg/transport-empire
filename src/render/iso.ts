/** Isometric projection constants and helpers. */

/** Width and height of one tile's diamond in world pixels. */
export const TILE_W = 32;
export const TILE_H = 16;
/** How many pixels one height step lifts a tile. */
export const HEIGHT_STEP = 4;
/** Tiles per render chunk along each axis. */
export const CHUNK = 32;

/** World position of the top corner of tile (x, y) at height h. */
export function tileTop(x: number, y: number, h: number): { px: number; py: number } {
  return {
    px: (x - y) * (TILE_W / 2),
    py: (x + y) * (TILE_H / 2) - h * HEIGHT_STEP,
  };
}

/** World position of the centre of tile (x, y) at height h. */
export function tileCenter(x: number, y: number, h: number): { px: number; py: number } {
  const t = tileTop(x, y, h);
  return { px: t.px, py: t.py + TILE_H / 2 };
}

/** Multiplies each colour channel by `factor` (darken < 1 < lighten). */
export function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Cheap deterministic per-tile hash for visual variation (not gameplay). */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Minimal drawing surface (a PixiJS Graphics satisfies this). */
export interface PolyTarget {
  poly(points: number[]): { fill(color: number | { color: number; alpha?: number }): unknown };
}

/** An isometric box standing on the ground point (cx, cy). */
export function drawBlock(
  g: PolyTarget,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  tall: number,
  wall: number,
  roof: number,
): void {
  g.poly([cx - halfW, cy, cx, cy + halfH, cx, cy + halfH - tall, cx - halfW, cy - tall]).fill(shade(wall, 0.85));
  g.poly([cx, cy + halfH, cx + halfW, cy, cx + halfW, cy - tall, cx, cy + halfH - tall]).fill(shade(wall, 0.7));
  g.poly([
    cx, cy - halfH - tall,
    cx + halfW, cy - tall,
    cx, cy + halfH - tall,
    cx - halfW, cy - tall,
  ]).fill(roof);
}

/** Inverse projection: the tile under a world point, honouring tile heights. -1 if none. */
export function pickTile(
  map: { width: number; height: number; maxHeight: number; heights: Uint8Array },
  wx: number,
  wy: number,
): number {
  const a = wx / (TILE_W / 2);
  for (let h = map.maxHeight; h >= 0; h--) {
    const b = (wy + h * HEIGHT_STEP) / (TILE_H / 2);
    const tx = Math.floor((a + b) / 2);
    const ty = Math.floor((b - a) / 2);
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
    const i = ty * map.width + tx;
    if (map.heights[i] === h) return i;
  }
  return -1;
}
