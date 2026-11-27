/** Shared map types. Plain data only, so maps can be saved as JSON later. */

export const Terrain = {
  Grass: 0,
  Rough: 1,
  Farmland: 2,
  Forest: 3,
  Rock: 4,
  Water: 5,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** What kind of water a tile holds (only meaningful when terrain is Water). */
export const WaterKind = {
  None: 0,
  Sea: 1,
  Lake: 2,
  River: 3,
} as const;
export type WaterKind = (typeof WaterKind)[keyof typeof WaterKind];

export type MapSize = 'small' | 'medium' | 'large';
export type WaterAmount = 'low' | 'medium' | 'high';
export type Relief = 'flat' | 'hilly' | 'mountainous';
export type TownAmount = 'few' | 'normal' | 'many';

export interface MapSettings {
  size: MapSize;
  water: WaterAmount;
  relief: Relief;
  towns: TownAmount;
}

export const DEFAULT_SETTINGS: MapSettings = {
  size: 'medium',
  water: 'medium',
  relief: 'hilly',
  towns: 'normal',
};

export const MAP_DIMENSIONS: Record<MapSize, number> = {
  small: 64,
  medium: 128,
  large: 256,
};

export type IndustryType =
  | 'coal_mine'
  | 'power_station'
  | 'farm'
  | 'food_factory'
  | 'forest'
  | 'sawmill';

export interface Town {
  id: number;
  name: string;
  /** Centre tile. */
  x: number;
  y: number;
  population: number;
}

export interface Industry {
  id: number;
  type: IndustryType;
  /** Top-left tile of the 2x2 footprint. */
  x: number;
  y: number;
}

/** Occupancy layer values. */
export const Occupant = {
  None: 0,
  Town: 1,
  Industry: 2,
} as const;
export type Occupant = (typeof Occupant)[keyof typeof Occupant];

export interface GameMap {
  /** The seed the player asked for. */
  seed: string;
  /** The seed actually used (differs if earlier attempts failed validation). */
  usedSeed: string;
  attempts: number;
  settings: MapSettings;
  width: number;
  height: number;
  maxHeight: number;
  /** Tile height, 0 = sea level. Index = y * width + x. */
  heights: Uint8Array;
  terrain: Uint8Array;
  water: Uint8Array;
  occupant: Uint8Array;
  /** Id of the town or industry occupying the tile, -1 if none. */
  occupantId: Int16Array;
  towns: Town[];
  industries: Industry[];
}
