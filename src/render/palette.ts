/**
 * Placeholder colours. Kept in one place so they are easy to replace with
 * real sprites later.
 */
import industries from '../data/industries.json' with { type: 'json' };
import { Terrain, WaterKind, type IndustryType } from '../mapgen/types.ts';

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

export function industryColor(type: IndustryType): number {
  return Number(industries[type].color);
}

export function industryName(type: IndustryType): string {
  return industries[type].name;
}
