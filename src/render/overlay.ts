/** Build previews and highlights drawn on top of the map. */
import { Graphics } from 'pixi.js';
import type { RoadPlan } from '../sim/roads.ts';
import type { World } from '../sim/world.ts';
import { TILE_H, TILE_W, tileTop } from './iso.ts';
import { HIGHLIGHT, PREVIEW_BAD, PREVIEW_OK } from './palette.ts';

export class Overlay {
  readonly gfx = new Graphics();

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
    return tileTop(x, y, world.map.heights[i]!);
  }
}
