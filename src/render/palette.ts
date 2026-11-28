/**
 * Placeholder colours. Kept in one place so they are easy to replace with
 * real sprites later.
 */
import industries from '../data/industries.json' with { type: 'json' };
import { Terrain, WaterKind, type IndustryType } from '../mapgen/types.ts';
import { shade } from './iso.ts';

export const shadeFor = shade;

export const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Grass]: 0x6aa84f,
  [Terrain.Rough]: 0x8f9a5c,
  [Terrain.Farmland]: 0xc9b458,
  [Terrain.Forest]: 0x4f8a3c,
  [Terrain.Rock]: 0x8e8b86,
  [Terrain.Water]: 0x2f6fa8,
};

export const WATER_COLORS: Record<number, number> = {
  [WaterKind.Sea]: 0x2a62a0,
  [WaterKind.Lake]: 0x3577b5,
  [WaterKind.River]: 0x3f86c6,
};

export const TREE_COLOR = 0x23552a;
export const HOUSE_WALL = 0xd9cbb3;
export const HOUSE_ROOF = 0xa5483a;
export const BACKGROUND = 0x1d2b36;
export const ROAD_COLOR = 0x5b5b5e;
export const BRIDGE_COLOR = 0x8c7a62;
export const STOP_COLOR = 0xe3b23c;
export const DEPOT_COLOR = 0x4d6f9c;
export const BUS_BODY = 0xe8a23a;
export const BUS_ROOF = 0xf5e3b5;
export const VAN_BODY = 0xc9423a;
export const TRUCK_STOP_COLOR = 0x5aa0c8;
export const PREVIEW_OK = 0x4cd964;
export const PREVIEW_BAD = 0xff3b30;
export const HIGHLIGHT = 0xffe066;

export function industryColor(type: IndustryType): number {
  return Number(industries[type].color);
}

export function industryName(type: IndustryType): string {
  return industries[type].name;
}
