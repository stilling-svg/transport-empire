/**
 * Draws a GameMap isometrically with placeholder graphics.
 *
 * The map is split into chunks of CHUNK x CHUNK tiles. Each chunk is one
 * Graphics object that is built once; chunks outside the screen are hidden.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Occupant, Terrain, WaterKind, type GameMap } from '../mapgen/types.ts';
import { CHUNK, HEIGHT_STEP, TILE_H, TILE_W, shade, tileCenter, tileHash, tileTop } from './iso.ts';
import {
  HOUSE_ROOF,
  HOUSE_WALL,
  TERRAIN_COLORS,
  TREE_COLOR,
  WATER_COLORS,
  industryColor,
  industryName,
} from './palette.ts';

interface Chunk {
  gfx: Graphics;
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

export class MapRenderer {
  readonly root = new Container();
  private readonly terrainLayer = new Container();
  private readonly labelLayer = new Container();
  private chunks: Chunk[] = [];
  private townLabels: Text[] = [];
  private industryLabels: Text[] = [];

  constructor() {
    this.terrainLayer.sortableChildren = true;
    this.root.addChild(this.terrainLayer, this.labelLayer);
  }

  /** World-space bounding box of the whole map. */
  bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  setMap(map: GameMap): void {
    this.clear();
    const chunksX = Math.ceil(map.width / CHUNK);
    const chunksY = Math.ceil(map.height / CHUNK);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunk = this.buildChunk(map, cx, cy);
        chunk.gfx.zIndex = cx + cy;
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
    this.buildLabels(map);
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

  private clear(): void {
    for (const c of this.chunks) c.gfx.destroy();
    this.chunks = [];
    for (const t of [...this.townLabels, ...this.industryLabels]) t.destroy();
    this.townLabels = [];
    this.industryLabels = [];
  }

  private buildChunk(map: GameMap, cx: number, cy: number): Chunk {
    const g = new Graphics();
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(map.width, x0 + CHUNK);
    const y1 = Math.min(map.height, y0 + CHUNK);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Back-to-front: walk the diagonals (x + y ascending).
    for (let s = x0 + y0; s <= x1 - 1 + (y1 - 1); s++) {
      for (let x = Math.max(x0, s - (y1 - 1)); x <= Math.min(x1 - 1, s - y0); x++) {
        const y = s - x;
        this.drawTile(g, map, x, y);
        const { px, py } = tileTop(x, y, map.heights[y * map.width + x]!);
        minX = Math.min(minX, px - TILE_W / 2);
        maxX = Math.max(maxX, px + TILE_W / 2);
        minY = Math.min(minY, py - 24);
        maxY = Math.max(maxY, py + TILE_H + map.maxHeight * HEIGHT_STEP + 8);
      }
    }
    return { gfx: g, minX, minY, maxX, maxY };
  }

  private drawTile(g: Graphics, map: GameMap, x: number, y: number): void {
    const { width } = map;
    const i = y * width + x;
    const h = map.heights[i]!;
    const terrain = map.terrain[i]!;
    const water = map.water[i]!;
    const { px, py } = tileTop(x, y, h);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    let top =
      water !== WaterKind.None
        ? WATER_COLORS[water]!
        : shade(TERRAIN_COLORS[terrain]!, 0.92 + h * 0.018);
    // Subtle checker variation so flat areas read as tiles.
    if ((x + y) % 2 === 0) top = shade(top, 1.03);

    // Side faces down to lower neighbours (or to the base at the map edge).
    const hRight = x + 1 < map.width ? map.heights[i + 1]! : -1;
    const hLeft = y + 1 < map.height ? map.heights[i + width]! : -1;
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

    if (terrain === Terrain.Farmland) {
      // Furrows.
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

    if (map.occupant[i] === Occupant.Town) this.drawHouse(g, x, y, h);

    if (map.occupant[i] === Occupant.Industry) {
      const ind = map.industries[map.occupantId[i]!];
      // Draw the 2x2 building once, from its front-most tile.
      if (ind && x === ind.x + 1 && y === ind.y + 1) this.drawIndustry(g, map, ind.x, ind.y);
    }
  }

  private drawHouse(g: Graphics, x: number, y: number, h: number): void {
    const r = tileHash(x, y);
    const c = tileCenter(x, y, h);
    const w = 7 + (r % 3);
    const tall = 6 + ((r >>> 3) % 8);
    this.drawBlock(g, c.px, c.py + 2, w, w / 2, tall, HOUSE_WALL, HOUSE_ROOF);
  }

  private drawIndustry(g: Graphics, map: GameMap, x: number, y: number): void {
    const ind = map.industries[map.occupantId[y * map.width + x]!]!;
    let h = 0;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) h = Math.max(h, map.heights[(y + dy) * map.width + x + dx]!);
    }
    // Centre of the 2x2 footprint.
    const top = tileTop(x, y, h);
    const cx = top.px;
    const cy = top.py + TILE_H;
    const color = industryColor(ind.type);
    this.drawBlock(g, cx, cy, TILE_W * 0.8, TILE_H * 0.8, 14, shade(color, 1.1), color);
    // Chimney so industries read differently from houses.
    this.drawBlock(g, cx + 6, cy - 10, 4, 2, 12, 0x6b6b6b, 0x555555);
  }

  /** An isometric box centred at (cx, cy) on the ground. */
  private drawBlock(
    g: Graphics,
    cx: number,
    cy: number,
    halfW: number,
    halfH: number,
    tall: number,
    wall: number,
    roof: number,
  ): void {
    const l = [cx - halfW, cy];
    const r = [cx + halfW, cy];
    const b = [cx, cy + halfH];
    const t = [cx, cy - halfH];
    g.poly([l[0]!, l[1]!, b[0]!, b[1]!, b[0]!, b[1]! - tall, l[0]!, l[1]! - tall]).fill(shade(wall, 0.85));
    g.poly([b[0]!, b[1]!, r[0]!, r[1]!, r[0]!, r[1]! - tall, b[0]!, b[1]! - tall]).fill(shade(wall, 0.7));
    g.poly([
      t[0]!, t[1]! - tall,
      r[0]!, r[1]! - tall,
      b[0]!, b[1]! - tall,
      l[0]!, l[1]! - tall,
    ]).fill(roof);
  }

  private buildLabels(map: GameMap): void {
    for (const town of map.towns) {
      const h = map.heights[town.y * map.width + town.x]!;
      const c = tileCenter(town.x, town.y, h);
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
      const h = map.heights[ind.y * map.width + ind.x]!;
      const top = tileTop(ind.x, ind.y, h);
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
