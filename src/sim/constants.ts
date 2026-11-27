/** Simulation constants shared by sim, render and UI. */

/** Fixed simulation steps per game day. 1 day = 1 second at 1x speed. */
export const TICKS_PER_DAY = 30;

/** Road connection bits: which edges of a tile the road leaves through. */
export const Dir = {
  N: 1, // towards y - 1
  E: 2, // towards x + 1
  S: 4, // towards y + 1
  W: 8, // towards x - 1
} as const;

export interface DirInfo {
  bit: number;
  dx: number;
  dy: number;
  opposite: number;
}

export const DIRS: readonly DirInfo[] = [
  { bit: Dir.N, dx: 0, dy: -1, opposite: Dir.S },
  { bit: Dir.E, dx: 1, dy: 0, opposite: Dir.W },
  { bit: Dir.S, dx: 0, dy: 1, opposite: Dir.N },
  { bit: Dir.W, dx: -1, dy: 0, opposite: Dir.E },
];

/** Direction bit from tile a to the adjacent tile b, or 0 if not adjacent. */
export function dirBetween(width: number, a: number, b: number): number {
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  for (const d of DIRS) if (ax + d.dx === bx && ay + d.dy === by) return d.bit;
  return 0;
}

export function dirInfo(bit: number): DirInfo {
  const d = DIRS.find((x) => x.bit === bit);
  if (!d) throw new Error(`bad direction ${bit}`);
  return d;
}

/** Who built a road tile. Town roads can be used but not demolished. */
export const RoadOwner = {
  None: 0,
  Town: 1,
  Player: 2,
} as const;
