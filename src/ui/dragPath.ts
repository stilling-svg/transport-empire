/** Turning finger movement into a continuous path of 4-adjacent tiles. */

/** Extends a drag path tile by tile towards `target`; stepping back onto the path trims it. */
export function extendPath(path: number[], target: number, width: number): void {
  if (target < 0) return;
  if (path.length === 0) {
    path.push(target);
    return;
  }
  let last = path[path.length - 1]!;
  let guard = 0;
  while (last !== target && guard++ < 512) {
    const lx = last % width;
    const ly = (last - lx) / width;
    const tx = target % width;
    const ty = (target - tx) / width;
    let nx = lx;
    let ny = ly;
    if (Math.abs(tx - lx) >= Math.abs(ty - ly)) nx += Math.sign(tx - lx);
    else ny += Math.sign(ty - ly);
    const next = ny * width + nx;
    const k = path.lastIndexOf(next);
    if (k >= 0) path.length = k + 1;
    else path.push(next);
    last = next;
  }
}
