import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/mapgen/generator.ts';
import { Rng } from '../src/mapgen/rng.ts';
import {
  MAP_DIMENSIONS,
  type MapSettings,
  type MapSize,
  type Relief,
  type TownAmount,
  type WaterAmount,
} from '../src/mapgen/types.ts';
import { validateMap } from '../src/mapgen/validate.ts';

const SIZES: MapSize[] = ['small', 'medium', 'large'];
const settingsFor = (size: MapSize): MapSettings => ({
  size,
  water: 'medium',
  relief: 'hilly',
  towns: 'normal',
});

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng('hello');
    const b = new Rng('hello');
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('differs between seeds', () => {
    expect(new Rng('a').nextUint32()).not.toBe(new Rng('b').nextUint32());
  });

  it('keeps int() within bounds', () => {
    const r = new Rng('bounds');
    for (let i = 0; i < 10_000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe('generateMap', () => {
  it('produces an identical map for the same seed and settings', () => {
    for (const size of SIZES) {
      const a = generateMap('aarhus', settingsFor(size));
      const b = generateMap('aarhus', settingsFor(size));
      expect(a.usedSeed).toBe(b.usedSeed);
      expect(a.heights).toEqual(b.heights);
      expect(a.terrain).toEqual(b.terrain);
      expect(a.water).toEqual(b.water);
      expect(a.occupant).toEqual(b.occupant);
      expect(a.towns).toEqual(b.towns);
      expect(a.industries).toEqual(b.industries);
    }
  });

  it('produces different maps for different seeds', () => {
    const a = generateMap('one', settingsFor('medium'));
    const b = generateMap('two', settingsFor('medium'));
    expect(a.heights).not.toEqual(b.heights);
  });

  it('uses the right dimensions', () => {
    for (const size of SIZES) {
      const m = generateMap('dims', settingsFor(size));
      expect(m.width).toBe(MAP_DIMENSIONS[size]);
      expect(m.heights.length).toBe(m.width * m.height);
    }
  });

  for (const size of SIZES) {
    it(`generates 1000 valid ${size} maps`, () => {
      for (let s = 0; s < 1000; s++) {
        const map = generateMap(`test-${s}`, settingsFor(size));
        const errors = validateMap(map);
        expect(errors, `seed test-${s}`).toEqual([]);
        expect(map.industries.some((i) => i.type === 'coal_mine')).toBe(true);
        expect(map.industries.some((i) => i.type === 'power_station')).toBe(true);
        expect(map.industries.some((i) => i.type === 'farm')).toBe(true);
        expect(map.industries.some((i) => i.type === 'food_factory')).toBe(true);
        expect(map.industries.some((i) => i.type === 'forest')).toBe(true);
        expect(map.industries.some((i) => i.type === 'sawmill')).toBe(true);
      }
    });
  }

  it('generates valid maps for every combination of settings', () => {
    const waters: WaterAmount[] = ['low', 'medium', 'high'];
    const reliefs: Relief[] = ['flat', 'hilly', 'mountainous'];
    const towns: TownAmount[] = ['few', 'normal', 'many'];
    for (const size of SIZES) {
      for (const water of waters) {
        for (const relief of reliefs) {
          for (const town of towns) {
            const seeds = size === 'large' ? 2 : 5;
            for (let s = 0; s < seeds; s++) {
              const map = generateMap(`combo-${s}`, { size, water, relief, towns: town });
              expect(validateMap(map)).toEqual([]);
            }
          }
        }
      }
    }
  });

  it('generates a large map in under 3 seconds', () => {
    const start = performance.now();
    generateMap('speed', settingsFor('large'));
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
