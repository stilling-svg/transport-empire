/**
 * Map rotation. The map can be viewed from four sides (0°, 90°, 180°, 270°).
 *
 * Tile coordinates (x, y) belong to the map and never change. View
 * coordinates (u, v) are where a tile ends up after rotating the map; the
 * isometric projection and the back-to-front drawing order use (u, v).
 * Rotation r turns the map 90° clockwise r times.
 */
import { DIRS } from '../sim/constants.ts';

export type Rotation = 0 | 1 | 2 | 3;

export class MapView {
  rotation: Rotation = 0;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, rotation: Rotation = 0) {
    this.width = width;
    this.height = height;
    this.rotation = rotation;
  }

  /** Size of the map in view coordinates. */
  get viewWidth(): number {
    return this.rotation % 2 === 0 ? this.width : this.height;
  }

  get viewHeight(): number {
    return this.rotation % 2 === 0 ? this.height : this.width;
  }

  /** View coordinates of tile (x, y). */
  toView(x: number, y: number): { u: number; v: number } {
    const { width: w, height: h } = this;
    switch (this.rotation) {
      case 0:
        return { u: x, v: y };
      case 1:
        return { u: h - 1 - y, v: x };
      case 2:
        return { u: w - 1 - x, v: h - 1 - y };
      case 3:
        return { u: y, v: w - 1 - x };
    }
  }

  /** Tile coordinates of view position (u, v). */
  fromView(u: number, v: number): { x: number; y: number } {
    const { width: w, height: h } = this;
    switch (this.rotation) {
      case 0:
        return { x: u, y: v };
      case 1:
        return { x: v, y: h - 1 - u };
      case 2:
        return { x: w - 1 - u, y: h - 1 - v };
      case 3:
        return { x: w - 1 - v, y: u };
    }
  }

  /**
   * Same as toView but for any point on the map (tile (x, y) covers
   * [x, x + 1) × [y, y + 1)), used for smoothly moving vehicles.
   */
  pointToView(tx: number, ty: number): { u: number; v: number } {
    const { width: w, height: h } = this;
    switch (this.rotation) {
      case 0:
        return { u: tx, v: ty };
      case 1:
        return { u: h - ty, v: tx };
      case 2:
        return { u: w - tx, v: h - ty };
      case 3:
        return { u: ty, v: w - tx };
    }
  }

  /** Inverse of pointToView. */
  pointFromView(u: number, v: number): { x: number; y: number } {
    const { width: w, height: h } = this;
    switch (this.rotation) {
      case 0:
        return { x: u, y: v };
      case 1:
        return { x: v, y: h - u };
      case 2:
        return { x: w - u, y: h - v };
      case 3:
        return { x: w - v, y: u };
    }
  }

  /** Rotates a tile-space step (dx, dy) into view space. */
  stepToView(dx: number, dy: number): { du: number; dv: number } {
    switch (this.rotation) {
      case 0:
        return { du: dx, dv: dy };
      case 1:
        return { du: -dy, dv: dx };
      case 2:
        return { du: -dx, dv: -dy };
      case 3:
        return { du: dy, dv: -dx };
    }
  }

  /** The view-space direction bit for a tile-space road direction bit. */
  dirToView(bit: number): number {
    const d = DIRS.find((x) => x.bit === bit)!;
    const { du, dv } = this.stepToView(d.dx, d.dy);
    return DIRS.find((x) => x.dx === du && x.dy === dv)!.bit;
  }

  /** Converts all bits of a tile's road mask into view directions. */
  maskToView(mask: number): number {
    let out = 0;
    for (const d of DIRS) if (mask & d.bit) out |= this.dirToView(d.bit);
    return out;
  }
}
