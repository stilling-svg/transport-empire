/** A* path finding over the road network. */
import { DIRS } from './constants.ts';

/** Binary min-heap keyed by priority. */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prio[p]! <= this.prio[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

/**
 * Finds the shortest road path from `start` to `goal` (tile indices).
 * Two tiles are connected when both have road bits pointing at each other.
 * Returns the tiles from start to goal inclusive, or null if unreachable.
 */
export function findRoadPath(
  roads: Uint8Array,
  width: number,
  height: number,
  start: number,
  goal: number,
): number[] | null {
  if (start === goal) return [start];
  if (roads[start] === 0 || roads[goal] === 0) return null;
  const gx = goal % width;
  const gy = (goal - gx) / width;
  const cameFrom = new Map<number, number>();
  const cost = new Map<number, number>([[start, 0]]);
  const open = new MinHeap();
  open.push(start, 0);

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c)!;
        path.push(c);
      }
      return path.reverse();
    }
    const cx = cur % width;
    const cy = (cur - cx) / width;
    const bits = roads[cur]!;
    const g = cost.get(cur)!;
    for (const d of DIRS) {
      if ((bits & d.bit) === 0) continue;
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if ((roads[n]! & d.opposite) === 0) continue;
      const ng = g + 1;
      const known = cost.get(n);
      if (known !== undefined && known <= ng) continue;
      cost.set(n, ng);
      cameFrom.set(n, cur);
      open.push(n, ng + Math.abs(nx - gx) + Math.abs(ny - gy));
    }
  }
  return null;
}
