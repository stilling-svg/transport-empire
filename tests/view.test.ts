import { describe, expect, it } from 'vitest';
import { DIRS } from '../src/sim/constants.ts';
import { MapView, type Rotation } from '../src/render/view.ts';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

describe('map rotation', () => {
  for (const r of ROTATIONS) {
    it(`maps every tile to a unique view position and back (rotation ${r})`, () => {
      const view = new MapView(7, 5, r);
      const seen = new Set<number>();
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) {
          const { u, v } = view.toView(x, y);
          expect(u >= 0 && v >= 0 && u < view.viewWidth && v < view.viewHeight).toBe(true);
          seen.add(v * view.viewWidth + u);
          expect(view.fromView(u, v)).toEqual({ x, y });
          // Tile centres agree with the continuous mapping.
          const c = view.pointToView(x + 0.5, y + 0.5);
          expect(c).toEqual({ u: u + 0.5, v: v + 0.5 });
          expect(view.pointFromView(c.u, c.v)).toEqual({ x: x + 0.5, y: y + 0.5 });
        }
      }
      expect(seen.size).toBe(35);
    });

    it(`turns road directions the same way as the tiles (rotation ${r})`, () => {
      const view = new MapView(7, 5, r);
      const x = 3;
      const y = 2;
      const from = view.toView(x, y);
      for (const d of DIRS) {
        const to = view.toView(x + d.dx, y + d.dy);
        const vd = DIRS.find((q) => q.bit === view.dirToView(d.bit))!;
        expect([to.u - from.u, to.v - from.v]).toEqual([vd.dx, vd.dy]);
      }
    });
  }

  it('turns clockwise in four steps back to the start', () => {
    const view = new MapView(6, 6, 0);
    const start = view.toView(1, 4);
    let dir = DIRS[1]!.bit; // east
    for (const r of [1, 2, 3] as Rotation[]) {
      view.rotation = r;
      expect(view.toView(1, 4)).not.toEqual(start);
    }
    view.rotation = 0;
    expect(view.toView(1, 4)).toEqual(start);
    view.rotation = 1;
    dir = view.dirToView(dir);
    expect(dir).toBe(DIRS[2]!.bit); // east turns to south, i.e. down-left on screen
  });
});
