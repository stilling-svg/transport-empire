/**
 * Draws the world isometrically with placeholder graphics.
 *
 * The map is split into chunks of CHUNK x CHUNK tiles. Each chunk is one
 * Graphics object that is built once and rebuilt only when a tile in it
 * changes (roads, stops, depots). Chunks outside the screen are hidden.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Occupant, Terrain, WaterKind } from '../mapgen/types.ts';
import { DIRS } from '../sim/constants.ts';
import type { World } from '../sim/world.ts';
import {
  CHUNK,
  HEIGHT_STEP,
  TILE_H,
  TILE_W,
  drawBlock,
  shade,
  tileCenter,
  tileHash,
  tileTop,
} from './iso.ts';
import { MapView, type Rotation } from './view.ts';
import {
  BRIDGE_COLOR,
  DEPOT_COLOR,
  HOUSE_ROOF,
  HOUSE_WALL,
  ROAD_COLOR,
  STOP_COLOR,
  TERRAIN_COLORS,
  TREE_COLOR,
  TRUCK_STOP_COLOR,
  WATER_COLORS,
  industryColor,
  industryName,
} from './palette.ts';

interface Chunk {
  gfx: Graphics;
  cx: number;
  cy: number;
  /** World-space bounds, used for culling. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen offsets (from a tile's top corner) of the middle of each edge, by direction bit. */
const EDGE_MID: Record<number, [number, number]> = {
  1: [TILE_W / 4, TILE_H / 4], // N edge: between top and right corner
  2: [TILE_W / 4, (TILE_H * 3) / 4], // E edge: between right and bottom corner
  4: [-TILE_W / 4, (TILE_H * 3) / 4], // S edge: between left and bottom corner
  8: [-TILE_W / 4, TILE_H / 4], // W edge: between top and left corner
};

export class MapRenderer {
  readonly root = new Container();
  /** Layer for things drawn on top of the terrain (previews, vehicles). */
  readonly overlayLayer = new Container();
  private readonly terrainLayer = new Container();
  private readonly labelLayer = new Container();
  private chunks: Chunk[] = [];
  private chunksX = 0;
  private townLabels: Text[] = [];
  private industryLabels: Text[] = [];
  private world: World | null = null;
  private mapView = new MapView(1, 1);

  /** World-space bounding box of the whole map. */
  bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor() {
    this.terrainLayer.sortableChildren = true;
    this.root.addChild(this.terrainLayer, this.overlayLayer, this.labelLayer);
  }

  /** The current rotation and coordinate conversions. */
  get view(): MapView {
    return this.mapView;
  }

  setWorld(world: World, rotation: Rotation = 0): void {
    this.clear();
    this.world = world;
    const { map } = world;
    this.mapView = new MapView(map.width, map.height, rotation);
    this.chunksX = Math.ceil(this.mapView.viewWidth / CHUNK);
    const chunksY = Math.ceil(this.mapView.viewHeight / CHUNK);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        const chunk = this.buildChunk(world, cx, cy);
        this.terrainLayer.addChild(chunk.gfx);
        this.chunks.push(chunk);
      }
    }
    this.bounds = {
      minX: Math.min(...this.chunks.map((c) => c.minX)),
      minY: Math.min(...this.chunks.map((c) => c.minY)),
      maxX: Math.max(...this.chunks.map((c) => c.maxX)),
      maxY: Math.max(...this.chunks.map((c) => c.maxY)),
    };
    this.buildLabels(world);
    world.dirty.clear();
  }

  /** Rebuilds the chunks containing changed tiles. Returns true if anything was redrawn. */
  refreshDirty(): boolean {
    const world = this.world;
    if (!world || world.dirty.size === 0) return false;
    const { width } = world.map;
    const keys = new Set<number>();
    for (const i of world.dirty) {
      const x = i % width;
      const y = (i - x) / width;
      const { u, v } = this.mapView.toView(x, y);
      keys.add(Math.floor(v / CHUNK) * this.chunksX + Math.floor(u / CHUNK));
    }
    world.dirty.clear();
    for (const k of keys) {
      const old = this.chunks[k];
      if (!old) continue;
      const fresh = this.buildChunk(world, old.cx, old.cy);
      fresh.gfx.visible = old.gfx.visible;
      this.terrainLayer.addChild(fresh.gfx);
      old.gfx.destroy();
      this.chunks[k] = fresh;
    }
    return true;
  }

  /** Hides chunks outside the view and keeps labels a constant on-screen size. */
  update(view: ViewRect, zoom: number): void {
    const pad = TILE_W * 2;
    for (const c of this.chunks) {
      c.gfx.visible =
        c.maxX >= view.x - pad &&
        c.minX <= view.x + view.width + pad &&
        c.maxY >= view.y - pad &&
        c.minY <= view.y + view.height + pad;
    }
    const s = 1 / zoom;
    for (const t of this.townLabels) t.scale.set(s);
    const showIndustries = zoom >= 0.9;
    for (const t of this.industryLabels) {
      t.visible = showIndustries;
      t.scale.set(s);
    }
  }

  /** Rebuilds town and industry names (after an industry opens or closes). */
  rebuildLabels(): void {
    if (!this.world) return;
    for (const t of [...this.townLabels, ...this.industryLabels]) t.destroy();
    this.townLabels = [];
    this.industryLabels = [];
    this.buildLabels(this.world);
  }

  private clear(): void {
    for (const c of this.chunks) c.gfx.destroy();
    this.chunks = [];
    for (const t of [...this.townLabels, ...this.industryLabels]) t.destroy();
    this.townLabels = [];
    this.industryLabels = [];
  }

  private buildChunk(world: World, cx: number, cy: number): Chunk {
    const { map } = world;
    const view = this.mapView;
    const g = new Graphics();
    g.zIndex = cx + cy;
    // Chunks are laid out in view space so drawing order stays back-to-front.
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(view.viewWidth, x0 + CHUNK);
    const y1 = Math.min(view.viewHeight, y0 + CHUNK);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Back-to-front: walk the diagonals (x + y ascending).
    for (let s = x0 + y0; s <= x1 - 1 + (y1 - 1); s++) {
      for (let u = Math.max(x0, s - (y1 - 1)); u <= Math.min(x1 - 1, s - y0); u++) {
        const v = s - u;
        const { x, y } = view.fromView(u, v);
        this.drawTile(g, world, x, y, u, v);
        const { px, py } = tileTop(u, v, map.heights[y * map.width + x]!);
        minX = Math.min(minX, px - TILE_W / 2);
        maxX = Math.max(maxX, px + TILE_W / 2);
        minY = Math.min(minY, py - 24);
        maxY = Math.max(maxY, py + TILE_H + map.maxHeight * HEIGHT_STEP + 8);
      }
    }
    return { gfx: g, cx, cy, minX, minY, maxX, maxY };
  }

  /** Draws tile (x, y), which sits at view position (u, v). */
  private drawTile(g: Graphics, world: World, x: number, y: number, u: number, v: number): void {
    const { map } = world;
    const view = this.mapView;
    const { width } = map;
    const i = y * width + x;
    const h = map.heights[i]!;
    const terrain = map.terrain[i]!;
    const water = map.water[i]!;
    const road = view.maskToView(world.roads[i]!);
    const { px, py } = tileTop(u, v, h);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    let top =
      water !== WaterKind.None
        ? WATER_COLORS[water]!
        : shade(TERRAIN_COLORS[terrain]!, 0.92 + h * 0.018);
    // Subtle checker variation so flat areas read as tiles.
    if ((x + y) % 2 === 0) top = shade(top, 1.03);

    // Side faces down to lower neighbours (or to the base at the map edge).
    // The visible side faces point at the view neighbours (u + 1, v) and (u, v + 1).
    const right = u + 1 < view.viewWidth ? view.fromView(u + 1, v) : null;
    const left = v + 1 < view.viewHeight ? view.fromView(u, v + 1) : null;
    const hRight = right ? map.heights[right.y * width + right.x]! : -1;
    const hLeft = left ? map.heights[left.y * width + left.x]! : -1;
    const base = water !== WaterKind.None ? WATER_COLORS[water]! : 0x8a6a45;
    if (hRight < h) {
      const d = (h - hRight) * HEIGHT_STEP;
      g.poly([px + hw, py + hh, px, py + TILE_H, px, py + TILE_H + d, px + hw, py + hh + d]).fill(
        shade(base, 0.62),
      );
    }
    if (hLeft < h) {
      const d = (h - hLeft) * HEIGHT_STEP;
      g.poly([px - hw, py + hh, px, py + TILE_H, px, py + TILE_H + d, px - hw, py + hh + d]).fill(
        shade(base, 0.78),
      );
    }

    g.poly([px, py, px + hw, py + hh, px, py + TILE_H, px - hw, py + hh]).fill(top);

    if (road !== 0) {
      this.drawRoad(g, px, py, road, water === WaterKind.River);
      if (world.stopAt[i]! >= 0) {
        const stop = world.stops.get(world.stopAt[i]!);
        if (stop?.kind === 'truck') {
          // Loading bay: a low shelter on the roadside.
          drawBlock(g, px + 7, py + hh - 1, 4, 2, 5, TRUCK_STOP_COLOR, shade(TRUCK_STOP_COLOR, 1.25));
        } else {
          drawBlock(g, px + 7, py + hh - 1, 2.5, 1.25, 9, STOP_COLOR, shade(STOP_COLOR, 1.2));
        }
      }
      if (world.depotAt[i]! >= 0) {
        drawBlock(g, px, py + hh, hw * 0.75, hh * 0.75, 12, DEPOT_COLOR, shade(DEPOT_COLOR, 1.25));
      }
      return; // nothing else grows on a road
    }

    if (terrain === Terrain.Farmland) {
      g.moveTo(px - hw / 2, py + hh * 0.5)
        .lineTo(px + hw / 2, py + hh * 1.5)
        .moveTo(px - hw / 2 + 4, py + hh * 0.3)
        .lineTo(px + hw / 2 + 2, py + hh * 1.2)
        .stroke({ width: 1, color: shade(top, 0.82) });
    }

    if (terrain === Terrain.Forest && map.occupant[i] === Occupant.None) {
      const r = tileHash(x, y);
      const trees = 2 + (r % 2);
      for (let t = 0; t < trees; t++) {
        const ox = (((r >>> (t * 5)) & 15) - 7.5) * 0.9;
        const oy = (((r >>> (t * 5 + 3)) & 7) - 3.5) * 0.8;
        const cx = px + ox;
        const cy = py + hh + oy;
        g.poly([cx, cy - 11, cx + 4, cy, cx - 4, cy]).fill(shade(TREE_COLOR, 0.9 + (t % 2) * 0.2));
      }
    }

    if (map.occupant[i] === Occupant.Town) {
      const r = tileHash(x, y);
      const c = tileCenter(u, v, h);
      const w = 7 + (r % 3);
      drawBlock(g, c.px, c.py + 2, w, w / 2, 6 + ((r >>> 3) % 8), HOUSE_WALL, HOUSE_ROOF);
    }

    if (map.occupant[i] === Occupant.Industry) {
      const ind = map.industries[map.occupantId[i]!];
      if (ind) {
        // Draw the 2x2 building once, from its front-most tile in the current view.
        let bh = 0;
        let minU = Infinity;
        let minV = Infinity;
        let maxU = -Infinity;
        let maxV = -Infinity;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            bh = Math.max(bh, map.heights[(ind.y + dy) * width + ind.x + dx]!);
            const p = view.toView(ind.x + dx, ind.y + dy);
            minU = Math.min(minU, p.u);
            minV = Math.min(minV, p.v);
            maxU = Math.max(maxU, p.u);
            maxV = Math.max(maxV, p.v);
          }
        }
        if (u !== maxU || v !== maxV) return;
        const t = tileTop(minU, minV, bh);
        const color = industryColor(ind.type);
        drawBlock(g, t.px, t.py + TILE_H, TILE_W * 0.8, TILE_H * 0.8, 14, shade(color, 1.1), color);
        drawBlock(g, t.px + 6, t.py + TILE_H - 10, 4, 2, 12, 0x6b6b6b, 0x555555);
      }
    }
  }

  private drawRoad(g: Graphics, px: number, py: number, bits: number, bridge: boolean): void {
    const cx = px;
    const cy = py + TILE_H / 2;
    const color = bridge ? BRIDGE_COLOR : ROAD_COLOR;
    for (const d of DIRS) {
      if ((bits & d.bit) === 0) continue;
      const [ex, ey] = EDGE_MID[d.bit]!;
      g.moveTo(cx, cy).lineTo(px + ex, py + ey).stroke({ width: 6, color, cap: 'butt' });
    }
    // Patch the centre so corners and junctions look solid.
    g.poly([cx, cy - 3, cx + 6, cy, cx, cy + 3, cx - 6, cy]).fill(color);
    if (bridge) {
      for (const d of DIRS) {
        if ((bits & d.bit) === 0) continue;
        const [ex, ey] = EDGE_MID[d.bit]!;
        // Railings: two thin lines either side of the deck.
        const nx = -(ey - TILE_H / 2) * 0.35;
        const ny = ex * 0.18;
        g.moveTo(cx + nx, cy + ny)
          .lineTo(px + ex + nx, py + ey + ny)
          .moveTo(cx - nx, cy - ny)
          .lineTo(px + ex - nx, py + ey - ny)
          .stroke({ width: 1, color: shade(BRIDGE_COLOR, 0.6) });
      }
    }
  }

  private buildLabels(world: World): void {
    const { map } = world;
    for (const town of map.towns) {
      const h = map.heights[town.y * map.width + town.x]!;
      const tv = this.mapView.toView(town.x, town.y);
      const c = tileCenter(tv.u, tv.v, h);
      const label = new Text({
        text: town.name,
        style: {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 13,
          fontWeight: '600',
          fill: 0xffffff,
          stroke: { color: 0x1d2b36, width: 3 },
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(c.px, c.py - 26);
      this.labelLayer.addChild(label);
      this.townLabels.push(label);
    }
    for (const ind of map.industries) {
      if (world.industryStats[ind.id]?.closed) continue;
      const h = map.heights[ind.y * map.width + ind.x]!;
      const p = this.mapView.pointToView(ind.x + 1, ind.y + 1);
      const top = tileTop(p.u - 1, p.v - 1, h);
      const label = new Text({
        text: industryName(ind.type),
        style: {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 11,
          fill: 0xf2e9c9,
          stroke: { color: 0x1d2b36, width: 3 },
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(top.px, top.py - 14);
      this.labelLayer.addChild(label);
      this.industryLabels.push(label);
    }
  }
}
