/** Draws buses at their interpolated positions every frame. */
import { Container, Graphics } from 'pixi.js';
import { dirBetween, dirInfo } from '../sim/constants.ts';
import type { Bus } from '../sim/vehicles.ts';
import type { World } from '../sim/world.ts';
import { HEIGHT_STEP, TILE_H, TILE_W, drawBlock } from './iso.ts';
import type { ViewRect } from './mapRenderer.ts';
import { BUS_BODY, BUS_ROOF } from './palette.ts';

/** How far to the right of the centre line buses drive, in tiles. */
const LANE_OFFSET = 0.17;

export class VehicleRenderer {
  readonly layer = new Container();
  private sprites = new Map<number, Graphics>();

  /** Positions all buses. Returns true if any bus is on screen. */
  update(world: World, view: ViewRect): boolean {
    const alive = new Set<number>();
    let anyVisible = false;
    for (const bus of world.buses) {
      alive.add(bus.id);
      let g = this.sprites.get(bus.id);
      if (!g) {
        g = new Graphics();
        drawBlock(g, 0, 0, 6, 3, 6, BUS_BODY, BUS_ROOF);
        this.layer.addChild(g);
        this.sprites.set(bus.id, g);
      }
      const p = busPosition(world, bus);
      g.position.set(p.x, p.y);
      g.zIndex = p.depth;
      const visible =
        bus.state !== 'idle' &&
        p.x >= view.x - 20 &&
        p.x <= view.x + view.width + 20 &&
        p.y >= view.y - 20 &&
        p.y <= view.y + view.height + 20;
      g.visible = visible;
      if (visible) anyVisible = true;
    }
    for (const [id, g] of this.sprites) {
      if (!alive.has(id)) {
        g.destroy();
        this.sprites.delete(id);
      }
    }
    this.layer.sortableChildren = true;
    return anyVisible;
  }

  clear(): void {
    for (const g of this.sprites.values()) g.destroy();
    this.sprites.clear();
  }
}

/** Screen position of a bus: between two tile centres, shifted into the right-hand lane. */
export function busPosition(world: World, bus: Bus): { x: number; y: number; depth: number } {
  const { width } = world.map;
  const a = bus.path[bus.pathIndex] ?? bus.tile;
  const b = bus.state === 'driving' ? (bus.path[bus.pathIndex + 1] ?? a) : a;
  // When standing still, face the way the bus came from.
  const from = a !== b ? a : (bus.path[bus.pathIndex - 1] ?? a);
  const to = a !== b ? b : a;
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  const t = bus.state === 'driving' ? bus.progress : 0;
  let tx = ax + (bx - ax) * t + 0.5;
  let ty = ay + (by - ay) * t + 0.5;
  const h = world.map.heights[a]! + (world.map.heights[b]! - world.map.heights[a]!) * t;

  const d = from !== to ? dirBetween(width, from, to) : 0;
  if (d !== 0) {
    const info = dirInfo(d);
    // Right-hand side of the travel direction (y grows southwards).
    tx += -info.dy * LANE_OFFSET;
    ty += info.dx * LANE_OFFSET;
  }
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2) - h * HEIGHT_STEP,
    depth: tx + ty,
  };
}
