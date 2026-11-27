/**
 * Playability rules from GDD section 3.3. A map is only used if
 * validateMap() returns an empty list.
 */
import cfg from '../data/mapgen.json' with { type: 'json' };
import { Occupant, WaterKind, type GameMap, type IndustryType } from './types.ts';
import {
  dist,
  industryCenter,
  isPassable,
  labelLandmasses,
  largestLabel,
  landmassOf,
  townCenter,
} from './util.ts';

type Point = { x: number; y: number };

export function validateMap(map: GameMap): string[] {
  const errors: string[] = [];
  const { width, height } = map;
  const { labels, sizes } = labelLandmasses(width, height, map.water);

  // 1. Enough towns.
  const minTowns = cfg.minTowns[map.settings.size];
  if (map.towns.length < minTowns) {
    errors.push(`too few towns: ${map.towns.length} < ${minTowns}`);
  }

  // 2. At least 70 % of the land is one connected landmass.
  let land = 0;
  for (let i = 0; i < map.water.length; i++) if (isPassable(map.water[i]!)) land++;
  const main = largestLabel(sizes);
  const mainSize = main >= 0 ? sizes[main]! : 0;
  if (land === 0 || mainSize / land < cfg.mainLandmassMinFraction) {
    errors.push(`main landmass too small: ${land === 0 ? 0 : (mainSize / land).toFixed(2)}`);
  }

  // 3. Every cargo chain has a source and an acceptor within range on the same landmass.
  const max = cfg.chainMaxDistance;
  const pointsOf = (type: IndustryType): Point[] =>
    map.industries.filter((i) => i.type === type).map(industryCenter);
  const towns = map.towns.map(townCenter);
  const near = (a: Point[], b: Point[], sameAllowed = false): boolean =>
    a.some((p) =>
      b.some(
        (q) =>
          (sameAllowed || p !== q) &&
          dist(p, q) <= max &&
          landmassOf(map, labels, p.x, p.y) === landmassOf(map, labels, q.x, q.y),
      ),
    );
  if (!near(pointsOf('coal_mine'), pointsOf('power_station'))) errors.push('no coal chain');
  if (!near(pointsOf('farm'), pointsOf('food_factory'))) errors.push('no grain chain');
  if (!near(pointsOf('food_factory'), towns)) errors.push('no food delivery town');
  if (!near(pointsOf('forest'), pointsOf('sawmill'))) errors.push('no wood chain');
  if (!near(pointsOf('sawmill'), towns)) errors.push('no planks delivery town');
  if (!near(towns, towns)) errors.push('no passenger chain (two nearby towns)');

  // 4. Towns and industries sit on land and do not overlap.
  for (const ind of map.industries) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const x = ind.x + dx;
        const y = ind.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          errors.push(`industry ${ind.id} out of bounds`);
          continue;
        }
        const i = y * width + x;
        if (map.water[i] !== WaterKind.None) errors.push(`industry ${ind.id} on water`);
        if (map.occupant[i] !== Occupant.Industry || map.occupantId[i] !== ind.id) {
          errors.push(`industry ${ind.id} overlaps something`);
        }
      }
    }
  }
  for (const town of map.towns) {
    const i = town.y * width + town.x;
    if (map.water[i] !== WaterKind.None) errors.push(`town ${town.id} on water`);
    if (map.occupant[i] !== Occupant.Town || map.occupantId[i] !== town.id) {
      errors.push(`town ${town.id} overlaps something`);
    }
  }
  for (let i = 0; i < map.occupant.length; i++) {
    if (map.occupant[i] !== Occupant.None && map.water[i] !== WaterKind.None) {
      errors.push(`occupied water tile at ${i}`);
      break;
    }
  }

  // 5. Towns are spaced apart.
  for (let a = 0; a < map.towns.length; a++) {
    for (let b = a + 1; b < map.towns.length; b++) {
      if (dist(towns[a]!, towns[b]!) < cfg.minTownDistance) {
        errors.push(`towns ${a} and ${b} too close`);
      }
    }
  }

  return errors;
}
