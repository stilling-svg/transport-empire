/**
 * Procedural map generator (GDD section 3).
 *
 * Pipeline: heights -> sea -> lakes (filled depressions) -> rivers -> terrain
 * -> towns -> industries -> farmland -> validation. If validation fails the map
 * is regenerated from a derived seed ("<seed>#<attempt>").
 */
import cfg from '../data/mapgen.json' with { type: 'json' };
import { fbm, createNoise2D } from './noise.ts';
import { generateTownNames } from './names.ts';
import { Rng } from './rng.ts';
import {
  DEFAULT_SETTINGS,
  MAP_DIMENSIONS,
  Occupant,
  Terrain,
  WaterKind,
  type GameMap,
  type Industry,
  type IndustryType,
  type MapSettings,
  type Town,
} from './types.ts';
import { DIR4, dist, isPassable, labelLandmasses, largestLabel } from './util.ts';
import { validateMap } from './validate.ts';

export class MapGenerationError extends Error {}

export function generateMap(seed: string, settings: MapSettings = DEFAULT_SETTINGS): GameMap {
  const maxAttempts = cfg.maxAttempts;
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const usedSeed = attempt === 0 ? seed : `${seed}#${attempt}`;
    // Later attempts get a little less sea, which makes valid maps more likely.
    const seaRelax = 1 - Math.min(attempt / maxAttempts, 1) * 0.5;
    const map = buildMap(seed, usedSeed, settings, seaRelax);
    lastErrors = validateMap(map);
    if (lastErrors.length === 0) {
      map.attempts = attempt + 1;
      return map;
    }
  }
  throw new MapGenerationError(
    `Could not generate a valid map for seed "${seed}": ${lastErrors.join(', ')}`,
  );
}

function buildMap(seed: string, usedSeed: string, settings: MapSettings, seaRelax: number): GameMap {
  const width = MAP_DIMENSIONS[settings.size];
  const height = width;
  const n = width * height;
  const rng = new Rng(usedSeed);
  const maxHeight = cfg.maxHeight[settings.relief];

  const map: GameMap = {
    seed,
    usedSeed,
    attempts: 1,
    settings: { ...settings },
    width,
    height,
    maxHeight,
    heights: new Uint8Array(n),
    terrain: new Uint8Array(n),
    water: new Uint8Array(n),
    occupant: new Uint8Array(n),
    occupantId: new Int16Array(n).fill(-1),
    towns: [],
    industries: [],
  };

  const elevationNoise = createNoise2D(rng);
  const forestNoise = createNoise2D(rng);
  const roughNoise = createNoise2D(rng);

  generateHeights(map, rng, elevationNoise, seaRelax);
  fillDepressionsAndMakeLakes(map, rng);
  classifyTerrain(map, forestNoise, roughNoise);

  const { labels, sizes } = labelLandmasses(width, height, map.water);
  const mainLand = largestLabel(sizes);
  placeTowns(map, rng, labels, mainLand);
  placeIndustries(map, rng, labels, mainLand);
  addFarmland(map);
  return map;
}

// ---------------------------------------------------------------------------
// Heights and sea

function generateHeights(
  map: GameMap,
  rng: Rng,
  noise: ReturnType<typeof createNoise2D>,
  seaRelax: number,
): void {
  const { width, height, maxHeight } = map;
  const n = width * height;
  const raw = new Float32Array(n);
  // Feature size scales a little with the map so small maps still get variety.
  const scale = 1 / Math.min(72, Math.max(36, width * 0.35));
  const offX = rng.range(0, 1000);
  const offY = rng.range(0, 1000);
  const border = Math.max(4, Math.floor(width * 0.12));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = fbm(noise, x * scale + offX, y * scale + offY, 5);
      // Gentle push down towards the edges so the sea tends to surround the land.
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (edge < border) {
        const t = 1 - edge / border;
        v -= 0.35 * t * t;
      }
      raw[y * width + x] = v;
    }
  }

  // Sea threshold = quantile so the sea share matches the setting.
  const sorted = Float32Array.from(raw).sort();
  const seaFraction = cfg.seaFraction[map.settings.water] * seaRelax;
  const threshold = sorted[Math.min(n - 1, Math.floor(n * seaFraction))]!;
  const top = sorted[n - 1]!;
  const exponent = cfg.reliefExponent[map.settings.relief];

  const below = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i]!;
    if (v < threshold) {
      below[i] = 1;
      map.heights[i] = 0;
    } else {
      const t = top > threshold ? (v - threshold) / (top - threshold) : 0;
      map.heights[i] = Math.min(maxHeight, 1 + Math.floor(Math.pow(t, exponent) * maxHeight));
    }
  }

  // Low tiles connected to the map border become sea. Inland low tiles stay
  // land at height 0 and become lakes in the next step.
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const y = (i - x) / width;
    const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (onBorder && below[i]) {
      map.water[i] = WaterKind.Sea;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (below[j] && map.water[j] === WaterKind.None) {
        map.water[j] = WaterKind.Sea;
        stack.push(j);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lakes and rivers (priority flood)

function fillDepressionsAndMakeLakes(map: GameMap, rng: Rng): void {
  const { width, height, maxHeight } = map;
  const n = width * height;
  const filled = new Uint8Array(n);
  const visited = new Uint8Array(n);
  /** Next tile downstream towards the sea or map edge, -1 at an outlet. */
  const downstream = new Int32Array(n).fill(-1);

  // Bucket queue: heights are small integers, so one FIFO per level.
  const buckets: number[][] = Array.from({ length: maxHeight + 1 }, () => []);
  const heads = new Int32Array(maxHeight + 1);

  for (let i = 0; i < n; i++) {
    const x = i % width;
    const y = (i - x) / width;
    const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (map.water[i] === WaterKind.Sea || onBorder) {
      visited[i] = 1;
      filled[i] = map.heights[i]!;
      buckets[filled[i]!]!.push(i);
    }
  }

  let level = 0;
  while (level <= maxHeight) {
    const bucket = buckets[level]!;
    if (heads[level]! >= bucket.length) {
      level++;
      continue;
    }
    const i = bucket[heads[level]!++]!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (visited[j]) continue;
      visited[j] = 1;
      const f = Math.max(map.heights[j]!, filled[i]!);
      filled[j] = f;
      downstream[j] = i;
      buckets[f]!.push(j);
      if (f < level) level = f; // cannot happen (f >= level), kept for safety
    }
  }

  // Depressions: tiles whose filled level is above the ground.
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (seen[start] || map.water[start] !== WaterKind.None || filled[start]! <= map.heights[start]!) {
      continue;
    }
    const component: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (seen[j] || map.water[j] !== WaterKind.None || filled[j]! <= map.heights[j]!) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    const isLake = component.length >= cfg.minLakeSize;
    for (const i of component) {
      map.heights[i] = filled[i]!;
      if (isLake) map.water[i] = WaterKind.Lake;
    }
  }
  // Any remaining height-0 land (tiny pits) is raised to 1.
  for (let i = 0; i < n; i++) {
    if (map.water[i] === WaterKind.None && map.heights[i] === 0) map.heights[i] = 1;
  }

  carveRivers(map, rng, downstream);
}

function carveRivers(map: GameMap, rng: Rng, downstream: Int32Array): void {
  const { width, maxHeight } = map;
  const count = Math.round(cfg.rivers[map.settings.size] * cfg.riverWaterFactor[map.settings.water]);
  const minSourceHeight = Math.ceil(maxHeight * 0.55);
  const candidates: number[] = [];
  for (let i = 0; i < map.heights.length; i++) {
    if (map.water[i] === WaterKind.None && map.heights[i]! >= minSourceHeight) candidates.push(i);
  }
  rng.shuffle(candidates);

  const sources: Array<{ x: number; y: number }> = [];
  let made = 0;
  for (const start of candidates) {
    if (made >= count) break;
    const sx = start % width;
    const sy = (start - sx) / width;
    if (sources.some((s) => dist(s, { x: sx, y: sy }) < 12)) continue;

    const path: number[] = [];
    let i = start;
    while (i !== -1 && map.water[i] === WaterKind.None && path.length < 4 * width) {
      path.push(i);
      i = downstream[i]!;
    }
    if (path.length < cfg.minRiverLength) continue;
    for (const p of path) map.water[p] = WaterKind.River;
    sources.push({ x: sx, y: sy });
    made++;
  }
}

// ---------------------------------------------------------------------------
// Terrain

function classifyTerrain(
  map: GameMap,
  forestNoise: ReturnType<typeof createNoise2D>,
  roughNoise: ReturnType<typeof createNoise2D>,
): void {
  const { width, height, maxHeight } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (map.water[i] !== WaterKind.None) {
        map.terrain[i] = Terrain.Water;
        continue;
      }
      const h = map.heights[i]!;
      let slope = 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (map.water[j] !== WaterKind.None) continue;
        slope = Math.max(slope, Math.abs(h - map.heights[j]!));
      }
      const rough = fbm(roughNoise, x / 7, y / 7, 2);
      const forest = fbm(forestNoise, x / 18, y / 18, 3);
      if (slope >= 2 || (maxHeight >= 10 && h >= maxHeight - 1 && rough > -0.2)) {
        map.terrain[i] = Terrain.Rock;
      } else if (forest > 0.22) {
        map.terrain[i] = Terrain.Forest;
      } else if (rough > 0.4) {
        map.terrain[i] = Terrain.Rough;
      } else {
        map.terrain[i] = Terrain.Grass;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Towns

function placeTowns(map: GameMap, rng: Rng, labels: Int32Array, mainLand: number): void {
  const { width, height } = map;
  const wanted = cfg.towns[map.settings.size][map.settings.towns];
  const margin = 3;

  type Candidate = { x: number; y: number; score: number };
  const candidates: Candidate[] = [];
  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      if (labels[y * width + x] !== mainLand) continue;
      // The 3x3 core must be dry, non-rock and nearly flat.
      let ok = true;
      let lo = 99;
      let hi = 0;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * width + (x + dx);
          if (map.water[j] !== WaterKind.None || map.terrain[j] === Terrain.Rock) {
            ok = false;
            break;
          }
          lo = Math.min(lo, map.heights[j]!);
          hi = Math.max(hi, map.heights[j]!);
        }
      }
      if (!ok || hi - lo > 1) continue;
      let score = rng.next();
      if (nearWater(map, x, y, 6)) score += 0.5;
      if (hi === lo) score += 0.3;
      candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);

  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (chosen.length >= wanted) break;
    if (chosen.some((o) => dist(o, c) < cfg.minTownDistance)) continue;
    chosen.push(c);
  }

  const names = generateTownNames(rng, chosen.length);
  chosen.forEach((c, id) => {
    const population = rng.int(150, 1600);
    const town: Town = { id, name: names[id]!, x: c.x, y: c.y, population };
    map.towns.push(town);
    const radius = population >= 600 ? 2 : 1;
    const centreHeight = map.heights[c.y * width + c.x]!;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const j = y * width + x;
        const core = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        if (!core) {
          if (map.water[j] !== WaterKind.None || map.terrain[j] === Terrain.Rock) continue;
          if (Math.abs(map.heights[j]! - centreHeight) > 1 || map.occupant[j] !== Occupant.None) continue;
        }
        map.occupant[j] = Occupant.Town;
        map.occupantId[j] = id;
        map.terrain[j] = Terrain.Grass;
      }
    }
  });
}

function nearWater(map: GameMap, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (map.water[ny * map.width + nx] !== WaterKind.None) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Industries

type Pt = { x: number; y: number };

function placeIndustries(map: GameMap, rng: Rng, labels: Int32Array, mainLand: number): void {
  const counts = cfg.industryCounts[map.settings.size];
  const reach = cfg.chainMaxDistance - 6; // keep a safety margin inside the 40-tile rule
  const towns: Pt[] = map.towns.map((t) => ({ x: t.x, y: t.y }));
  const of = (type: IndustryType): Pt[] =>
    map.industries.filter((i) => i.type === type).map((i) => ({ x: i.x + 0.5, y: i.y + 0.5 }));
  const withinOf = (p: Pt, targets: Pt[], lo: number, hi: number): boolean =>
    targets.some((t) => {
      const d = dist(p, t);
      return d >= lo && d <= hi;
    });

  const { width, height, maxHeight } = map;
  const tiles: number[] = [];
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = (i - x) / width;
    if (x >= 1 && y >= 1 && x < width - 2 && y < height - 2 && labels[i] === mainLand) tiles.push(i);
  }

  const place = (
    type: IndustryType,
    count: number,
    required: (p: Pt) => boolean,
    preferred: (p: Pt, x: number, y: number) => boolean,
  ): void => {
    const order = rng.shuffle(tiles.slice());
    for (let k = 0; k < count; k++) {
      let spot = -1;
      const same = of(type);
      for (const pass of [0, 1]) {
        for (const i of order) {
          const x = i % width;
          const y = (i - x) / width;
          const p = { x: x + 0.5, y: y + 0.5 };
          if (!canPlaceIndustry(map, labels, mainLand, x, y)) continue;
          if (same.some((o) => dist(o, p) < 12)) continue;
          if (!required(p)) continue;
          if (pass === 0 && !preferred(p, x, y)) continue;
          spot = i;
          break;
        }
        if (spot !== -1) break;
      }
      if (spot === -1) return; // validation will reject the map if a chain is missing
      const x = spot % width;
      const y = (spot - x) / width;
      const ind: Industry = { id: map.industries.length, type, x, y };
      map.industries.push(ind);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const j = (y + dy) * width + (x + dx);
          map.occupant[j] = Occupant.Industry;
          map.occupantId[j] = ind.id;
          map.terrain[j] = Terrain.Grass;
        }
      }
    }
  };

  const any = (): boolean => true;
  const nearTown = (p: Pt): boolean => withinOf(p, towns, 6, 22);

  // Acceptors first, then the sources that feed them.
  place('power_station', counts.power_station, any, (_p, x, y) => nearWater(map, x, y, 5));
  place('food_factory', counts.food_factory, nearTown, any);
  place('sawmill', counts.sawmill, nearTown, any);
  place(
    'coal_mine',
    counts.coal_mine,
    (p) => withinOf(p, of('power_station'), 10, reach),
    (_p, x, y) => map.heights[y * width + x]! >= Math.ceil(maxHeight * 0.4),
  );
  place(
    'farm',
    counts.farm,
    (p) => withinOf(p, of('food_factory'), 8, reach),
    (_p, x, y) => map.heights[y * width + x]! <= Math.ceil(maxHeight * 0.6),
  );
  place(
    'forest',
    counts.forest,
    (p) => withinOf(p, of('sawmill'), 8, reach),
    (_p, x, y) => forestDensity(map, x, y, 3) >= 8,
  );
}

function canPlaceIndustry(
  map: GameMap,
  labels: Int32Array,
  mainLand: number,
  x: number,
  y: number,
): boolean {
  const { width, height } = map;
  if (x < 1 || y < 1 || x + 2 >= width || y + 2 >= height) return false;
  let lo = 99;
  let hi = 0;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const j = (y + dy) * width + (x + dx);
      if (labels[j] !== mainLand || map.water[j] !== WaterKind.None) return false;
      if (map.terrain[j] === Terrain.Rock) return false;
      lo = Math.min(lo, map.heights[j]!);
      hi = Math.max(hi, map.heights[j]!);
    }
  }
  if (hi - lo > 1) return false;
  // Keep a one-tile gap around other towns and industries.
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -1; dx <= 2; dx++) {
      if (map.occupant[(y + dy) * width + (x + dx)] !== Occupant.None) return false;
    }
  }
  const centre = { x: x + 0.5, y: y + 0.5 };
  return !map.towns.some((t) => dist(t, centre) < 5);
}

function forestDensity(map: GameMap, x: number, y: number, r: number): number {
  let count = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (map.terrain[ny * map.width + nx] === Terrain.Forest) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Farmland

function addFarmland(map: GameMap): void {
  const r = cfg.farmlandRadius;
  const { width, height } = map;
  for (const farm of map.industries) {
    if (farm.type !== 'farm') continue;
    for (let y = farm.y - r; y <= farm.y + 1 + r; y++) {
      for (let x = farm.x - r; x <= farm.x + 1 + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const j = y * width + x;
        if (map.occupant[j] !== Occupant.None || !isPassable(map.water[j]!)) continue;
        if (map.water[j] !== WaterKind.None) continue;
        const t = map.terrain[j];
        if (t === Terrain.Grass || t === Terrain.Rough) map.terrain[j] = Terrain.Farmland;
      }
    }
  }
}
