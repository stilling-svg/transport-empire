/** Build previews and highlights drawn on top of the map. */
import { Graphics } from 'pixi.js';
import type { RoadPlan } from '../sim/roads.ts';
import type { Vehicle } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { TILE_H, TILE_W, tileTop } from './iso.ts';
import { HIGHLIGHT, PREVIEW_BAD, PREVIEW_OK } from './palette.ts';
import { MapView } from './view.ts';

export class Overlay {
  readonly gfx = new Graphics();
  /** Set by the game whenever the map or its rotation changes. */
  view = new MapView(1, 1);

  clear(): void {
    this.gfx.clear();
  }

  /** Green/red diamonds over the tiles of a planned road. */
  showPlan(world: World, plan: RoadPlan): void {
    this.gfx.clear();
    for (const t of plan.tiles) this.diamond(world, t.index, t.ok && plan.ok ? PREVIEW_OK : PREVIEW_BAD, 0.45);
  }

  /** Highlights a set of tiles, e.g. the tiles about to be demolished. */
  showTiles(world: World, tiles: Iterable<number>, color: number, alpha = 0.45): void {
    this.gfx.clear();
    for (const i of tiles) this.diamond(world, i, color, alpha);
  }

  /** Outlines tiles without clearing first (used for route stops). */
  outline(world: World, tiles: Iterable<number>, color = HIGHLIGHT): void {
    for (const i of tiles) {
      const { px, py } = this.top(world, i);
      this.gfx
        .poly([px, py, px + TILE_W / 2, py + TILE_H / 2, px, py + TILE_H, px - TILE_W / 2, py + TILE_H / 2])
        .stroke({ width: 2.5, color });
    }
  }

  /**
   * A vehicle's route: all its stops outlined (the next one brighter) and a
   * line along the road it will take to the next stop.
   */
  showRoute(world: World, v: Vehicle): void {
    this.gfx.clear();
    const stops = v.orders.map((o) => world.stops.get(o.stopId)).filter((s) => s !== undefined);
    const next = v.orders[v.orderIndex]?.stopId;
    for (const s of stops) this.diamond(world, s.tile, s.id === next && !v.goingToDepot ? HIGHLIGHT : 0x8fd3ff, 0.45);
    const rest = v.path.slice(v.pathIndex);
    if (rest.length >= 2) {
      const pts = rest.map((i) => {
        const t = this.top(world, i);
        return [t.px, t.py + TILE_H / 2] as const;
      });
      this.gfx.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) this.gfx.lineTo(x, y);
      this.gfx.stroke({ width: 3, color: HIGHLIGHT, alpha: 0.9 });
    }
  }

  private diamond(world: World, i: number, color: number, alpha: number): void {
    const { px, py } = this.top(world, i);
    this.gfx
      .poly([px, py, px + TILE_W / 2, py + TILE_H / 2, px, py + TILE_H, px - TILE_W / 2, py + TILE_H / 2])
      .fill({ color, alpha });
  }

  private top(world: World, i: number): { px: number; py: number } {
    const { width } = world.map;
    const x = i % width;
    const y = (i - x) / width;
    const { u, v } = this.view.toView(x, y);
    return tileTop(u, v, world.map.heights[i]!);
  }
}
