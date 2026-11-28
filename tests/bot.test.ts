import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/mapgen/generator.ts';
import { TICKS_PER_DAY } from '../src/sim/constants.ts';
import { World } from '../src/sim/world.ts';
import { buildCoalLine } from './bot.ts';

const SEEDS = ['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5'];

describe('bot player', () => {
  for (const seed of SEEDS) {
    it(`earns money with a coal line over two years (${seed})`, async () => {
      const map = generateMap(seed, { size: 'medium', water: 'medium', relief: 'hilly', towns: 'normal' });
      const w = new World(map);
      const line = buildCoalLine(w, 2);
      expect(line, 'the bot found a place for a coal line').not.toBe(null);
      const afterBuilding = w.money;

      for (let day = 0; day < 365 * 2; day++) {
        if (day % 30 === 0) await new Promise((r) => setTimeout(r, 0));
        for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
      }

      // Running costs, upkeep, breakdowns and random events included, the line earns money.
      expect(w.delivered.coal ?? 0).toBeGreaterThan(0);
      expect(w.money).toBeGreaterThan(afterBuilding);
    });
  }
});
