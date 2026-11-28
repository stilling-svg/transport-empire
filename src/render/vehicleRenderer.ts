/** Draws road vehicles at their interpolated positions every frame. */
import { Container, Graphics } from 'pixi.js';
import { dirBetween, dirInfo } from '../sim/constants.ts';
import { cargoInfo } from '../sim/cargo.ts';
import type { Vehicle } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { HEIGHT_STEP, TILE_H, TILE_W, drawBlock } from './iso.ts';
import type { ViewRect } from './mapRenderer.ts';
import type { MapView } from './view.ts';
import { BUS_BODY, BUS_ROOF, VAN_BODY, shadeFor } from './palette.ts';

/** How far to the right of the centre line buses drive, in tiles. */
const LANE_OFFSET = 0.17;

export class VehicleRenderer {
  readonly layer = new Container();
  private sprites = new Map<number, Graphics>();
  private warnings = new Map<number, Graphics>();
  /** Last drawn world positions, for tapping vehicles. */
  private positions = new Map<number, { x: number; y: number }>();

  /** Positions all vehicles. Returns true if any vehicle is on screen. */
  update(world: World, mapView: MapView, view: ViewRect): boolean {
    const alive = new Set<number>();
    let anyVisible = false;
    // Vehicles loading at the same stop are drawn side by side.
    const slot = new Map<number, number>();
    const loaders = new Map<number, number>();
    for (const v of world.vehicles) {
      if (v.loadingAt < 0) continue;
      const n = loaders.get(v.loadingAt) ?? 0;
      slot.set(v.id, n);
      loaders.set(v.loadingAt, n + 1);
    }
    for (const bus of world.vehicles) {
      alive.add(bus.id);
      let g = this.sprites.get(bus.id);
      if (!g) {
        g = new Graphics();
        drawVehicle(g, bus);
        this.layer.addChild(g);
        this.sprites.set(bus.id, g);
      }
      const p = busPosition(world, mapView, bus);
      const s = slot.get(bus.id) ?? 0;
      if (s > 0) {
        p.x += 7 * s;
        p.y -= 3.5 * s;
      }
      g.position.set(p.x, p.y);
      g.zIndex = p.depth;
      this.positions.set(bus.id, { x: p.x, y: p.y - 4 });
      // A red warning sign above broken-down vehicles.
      let warn = this.warnings.get(bus.id);
      if (bus.brokenTicks > 0) {
        if (!warn) {
          warn = new Graphics();
          warn.poly([0, -22, 6, -12, -6, -12]).fill(0xff3b30);
          warn.rect(-0.75, -19.5, 1.5, 4).fill(0xffffff);
          warn.rect(-0.75, -14.5, 1.5, 1.5).fill(0xffffff);
          this.layer.addChild(warn);
          this.warnings.set(bus.id, warn);
        }
        warn.position.set(p.x, p.y);
        warn.zIndex = p.depth + 0.01;
        warn.visible = true;
      } else if (warn) warn.visible = false;
      const visible =
        bus.state !== 'idle' &&
        bus.state !== 'servicing' &&
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
        this.warnings.get(id)?.destroy();
        this.warnings.delete(id);
        this.positions.delete(id);
      }
    }
    this.layer.sortableChildren = true;
    return anyVisible;
  }

  clear(): void {
    for (const g of this.sprites.values()) g.destroy();
    for (const g of this.warnings.values()) g.destroy();
    this.sprites.clear();
    this.warnings.clear();
    this.positions.clear();
  }

  /** The visible vehicle closest to a world point within `radius`, or -1. */
  hitTest(world: World, wx: number, wy: number, radius: number): number {
    let best = -1;
    let bestD = radius;
    for (const v of world.vehicles) {
      if (v.state === 'idle' || v.state === 'servicing') continue;
      const p = this.positions.get(v.id);
      if (!p) continue;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }
}

/** Screen position of a bus: between two tile centres, shifted into the right-hand lane. */
function drawVehicle(g: Graphics, v: Vehicle): void {
  if (v.model === 'bus') drawBlock(g, 0, 0, 6, 3, 6, BUS_BODY, BUS_ROOF);
  else if (v.model === 'van') drawBlock(g, 0, 0, 5, 2.5, 5, VAN_BODY, shadeFor(VAN_BODY, 1.3));
  else {
    // Truck: grey cab plus a load box in the colour of its cargo.
    const cargo = Number(cargoInfo(v.cargo).color);
    drawBlock(g, -2, 1, 6, 3, 5, cargo, shadeFor(cargo, 1.3));
    drawBlock(g, 4, -2, 3, 1.5, 6, 0x7d8a96, 0xb7c3cc);
  }
}

export function busPosition(
  world: World,
  mapView: MapView,
  bus: Vehicle,
): { x: number; y: number; depth: number } {
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
  const { u, v } = mapView.pointToView(tx, ty);
  return {
    x: (u - v) * (TILE_W / 2),
    y: (u + v) * (TILE_H / 2) - h * HEIGHT_STEP,
    depth: u + v,
  };
}
