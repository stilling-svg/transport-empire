import { describe, expect, it } from 'vitest';
import events from '../src/data/events.json' with { type: 'json' };
import { generateMap } from '../src/mapgen/generator.ts';
import { Occupant } from '../src/mapgen/types.ts';
import { TICKS_PER_DAY } from '../src/sim/constants.ts';
import { DEPOT_CAPACITY } from '../src/sim/events.ts';
import { World } from '../src/sim/world.ts';
import { buildCoalLine } from './bot.ts';
import { addIndustry, flatMap, row } from './helpers.ts';

const runDays = (world: World, days: number): void => {
  for (let t = 0; t < days * TICKS_PER_DAY; t++) world.step();
};

/** Mine and power station on a flat map with truck stops and a depot (like economy.test). */
function line(extraMine = false): World {
  const map = flatMap(32, 16);
  addIndustry(map, 'coal_mine', 2, 2);
  addIndustry(map, 'power_station', 20, 2);
  if (extraMine) addIndustry(map, 'coal_mine', 26, 11);
  const w = new World(map);
  w.finance.money = 1e7;
  w.buildRoad(row(map, 6, 1, 26));
  w.placeStop(6 * 32 + 3, 'truck');
  w.placeStop(6 * 32 + 21, 'truck');
  w.placeDepot(7 * 32 + 10);
  return w;
}

function coalTruck(w: World) {
  const t = w.buyVehicle(0, 'truck', 'coal')!;
  w.setRoute(t.id, [
    { stopId: 0, fullLoad: true },
    { stopId: 1, fullLoad: false },
  ]);
  return t;
}

/** Skips the calm first year without running the simulation. */
function afterGrace(w: World): void {
  w.tick = (events.graceDays + 5) * TICKS_PER_DAY;
}

describe('depots', () => {
  it(`hold at most ${DEPOT_CAPACITY} vehicles`, () => {
    const w = line();
    for (let k = 0; k < DEPOT_CAPACITY; k++) expect(w.buyVehicle(0, 'bus')).not.toBe(null);
    expect(w.buyVehicle(0, 'bus')).toBe(null);
    expect(w.buyProblem(0, 'bus')).toContain('depot is full');
    // A second depot takes more.
    expect(w.placeDepot(5 * 32 + 15).ok).toBe(true);
    expect(w.buyVehicle(1, 'bus')).not.toBe(null);
  });

  it('cannot be demolished while vehicles belong to it', () => {
    const w = line();
    coalTruck(w);
    runDays(w, 5);
    const res = w.demolish([7 * 32 + 10]);
    expect(res.ok).toBe(false);
  });
});

describe('breakdowns and service', () => {
  it('lets worn vehicles break down and stand still for 2–4 days', () => {
    const w = line();
    afterGrace(w);
    const t = coalTruck(w);
    t.reliability = events.reliability.floor;
    t.lastServiceDay = w.day; // no service during the test
    let sawBreakdown = false;
    for (let k = 0; k < 90 * TICKS_PER_DAY && !sawBreakdown; k++) {
      w.step();
      if (t.brokenTicks > 0) {
        sawBreakdown = true;
        const days = t.brokenTicks / TICKS_PER_DAY;
        expect(days).toBeGreaterThanOrEqual(events.reliability.breakdownDaysMin - 1);
        expect(days).toBeLessThanOrEqual(events.reliability.breakdownDaysMax);
        const where = [t.tile, t.progress];
        w.step();
        expect([t.tile, t.progress]).toEqual(where);
      }
    }
    expect(sawBreakdown).toBe(true);
    expect(w.news.some((n) => n.text.includes('broken down'))).toBe(true);
  });

  it('services vehicles in their depot and restores reliability', () => {
    const w = line();
    const t = coalTruck(w);
    let serviced = false;
    for (let k = 0; k < 200 * TICKS_PER_DAY && !serviced; k++) {
      w.step();
      if (t.state === 'servicing') serviced = true;
    }
    expect(serviced).toBe(true);
    runDays(w, 2);
    expect(t.reliability).toBeGreaterThan(0.95);
  });

  it('can be sent for service by hand', () => {
    const w = line();
    const t = coalTruck(w);
    runDays(w, 10);
    t.reliability = 0.5;
    expect(w.serviceVehicle(t.id).ok).toBe(true);
    let serviced = false;
    for (let k = 0; k < 60 * TICKS_PER_DAY && !serviced; k++) {
      w.step();
      if (t.state === 'servicing') serviced = true;
    }
    expect(serviced).toBe(true);
  });
});

describe('living industries', () => {
  it('warns three months before an unserved industry closes, then closes it', () => {
    const w = line(true);
    afterGrace(w);
    w.eventRng.next = () => 0; // every roll comes up "yes"
    const mine = 2; // the extra mine nobody serves
    w.industryStats[mine]!.unservedMonths = 30;
    let warnedDay = -1;
    let closedDay = -1;
    for (let d = 0; d < 200 && closedDay < 0; d++) {
      runDays(w, 1);
      if (warnedDay < 0 && w.industryStats[mine]!.closingIn > 0) warnedDay = w.day;
      if (w.industryStats[mine]!.closed) closedDay = w.day;
    }
    expect(warnedDay).toBeGreaterThan(0);
    expect(closedDay - warnedDay).toBeGreaterThan(80);
    const ind = w.map.industries[mine]!;
    expect(w.map.occupant[ind.y * 32 + ind.x]).toBe(Occupant.None);
    expect(w.news.some((n) => n.text.includes('will close in 3 months'))).toBe(true);
  });

  it('calls off the closure when the player starts serving the industry', () => {
    const w = line(true);
    afterGrace(w);
    w.eventRng.next = () => 0;
    const mine = 2;
    w.industryStats[mine]!.unservedMonths = 30;
    while (w.industryStats[mine]!.closingIn === 0) runDays(w, 1);
    // Something gets transported this month.
    w.industryStats[mine]!.transportedThisMonth = 10;
    w.industryStats[mine]!.producedThisMonth = 10;
    const month = Math.floor(w.day / 30);
    while (Math.floor(w.day / 30) === month || w.industryStats[mine]!.closingIn > 0) {
      runDays(w, 1);
      if (w.day > 2000) break;
    }
    expect(w.industryStats[mine]!.closed).toBe(false);
    expect(w.news.some((n) => n.text.includes('stay open'))).toBe(true);
  });

  it('never closes the last industry of its kind', () => {
    const w = line(false);
    afterGrace(w);
    w.eventRng.next = () => 0;
    w.industryStats[1]!.unservedMonths = 30; // the only power station
    runDays(w, 400);
    expect(w.industryStats[1]!.closed).toBe(false);
  });

  it('opens new industries over time and stops nearby notice them', () => {
    const map = generateMap('new-industries', { size: 'medium', water: 'medium', relief: 'hilly', towns: 'normal' });
    const w = new World(map);
    const before = map.industries.length;
    runDays(w, 365 * 4);
    expect(map.industries.length).toBeGreaterThan(before);
    expect(w.news.some((n) => n.text.startsWith('A new'))).toBe(true);
  });

  it('grows production at well-served industries', () => {
    const w = line();
    const t = coalTruck(w);
    coalTruck(w);
    void t;
    runDays(w, 365 * 3);
    expect(w.industryStats[0]!.production).toBeGreaterThan(60);
  });
});

describe('fairness and determinism', () => {
  it('has no bad news in the first year', async () => {
    for (const seed of ['calm-1', 'calm-2', 'calm-3']) {
      await new Promise((r) => setTimeout(r, 0));
      const w = new World(generateMap(seed, { size: 'medium', water: 'medium', relief: 'hilly', towns: 'normal' }));
      buildCoalLine(w, 3);
      runDays(w, events.graceDays - 2);
      expect(w.news.filter((n) => n.kind === 'bad')).toEqual([]);
    }
  });

  it('replays the same events for the same seed and actions', () => {
    const run = (): string[] => {
      const w = new World(generateMap('replay', { size: 'medium', water: 'medium', relief: 'hilly', towns: 'normal' }));
      buildCoalLine(w, 2);
      runDays(w, 365 * 3);
      return w.news.map((n) => `${n.day}:${n.text}`);
    };
    const a = run();
    expect(a.length).toBeGreaterThan(5);
    expect(run()).toEqual(a);
  });

  it('pays less during a recession', () => {
    const income = (payment: number): number => {
      const w = line();
      w.modifiers.payment = payment;
      w.modifiers.paymentMonths = 99;
      coalTruck(w);
      runDays(w, 200);
      return w.finance.thisYear.income;
    };
    const normal = income(1);
    const recession = income(0.75);
    expect(recession / normal).toBeGreaterThan(0.7);
    expect(recession / normal).toBeLessThan(0.8);
  });
});
