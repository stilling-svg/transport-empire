import { describe, expect, it } from 'vitest';
import economy from '../src/data/economy.json' with { type: 'json' };
import { CARGO_IDS, cargoInfo, deliveryPayment, timeFactor, type CargoId } from '../src/sim/cargo.ts';
import { TICKS_PER_DAY, dirBetween } from '../src/sim/constants.ts';
import { stopAccepts } from '../src/sim/economy.ts';
import { Finance } from '../src/sim/finance.ts';
import { VEHICLE_GAP } from '../src/sim/vehicles.ts';
import { World } from '../src/sim/world.ts';
import { addIndustry, addTown, col, flatMap, row } from './helpers.ts';

const runDays = (world: World, days: number): void => {
  for (let t = 0; t < days * TICKS_PER_DAY; t++) world.step();
};

const SLOW: Record<string, number> = economy.slowdownFactor;

describe('delivery payment', () => {
  it('follows base rate x amount x distance x scale when on time', () => {
    for (const c of CARGO_IDS) {
      const info = cargoInfo(c);
      expect(deliveryPayment(c, 20, 30, 1)).toBe(
        Math.round(info.baseRate * 20 * 30 * economy.paymentScale * economy.difficultyPaymentMultiplier),
      );
    }
  });

  it('pays less for slow deliveries, down to a floor', () => {
    for (const c of CARGO_IDS) {
      const info = cargoInfo(c);
      const floorAt = info.fastDays * SLOW[info.sensitivity]!;
      expect(timeFactor(c, 0)).toBe(1);
      expect(timeFactor(c, info.fastDays)).toBe(1);
      expect(timeFactor(c, floorAt)).toBeCloseTo(economy.minTimeFactor, 6);
      expect(timeFactor(c, floorAt * 3)).toBe(economy.minTimeFactor);
      const mid = timeFactor(c, (info.fastDays + floorAt) / 2);
      expect(mid).toBeGreaterThan(economy.minTimeFactor);
      expect(mid).toBeLessThan(1);
    }
  });

  it('punishes slow passengers harder than slow coal', () => {
    expect(timeFactor('passengers', 25)).toBeLessThan(timeFactor('coal', 25));
  });
});

describe('money and loans', () => {
  it('borrows and repays in steps up to the maximum', () => {
    const f = new Finance();
    const start = f.money;
    let n = 0;
    while (f.borrow()) n++;
    expect(n * f.loanStep).toBe(f.maxLoan);
    expect(f.money).toBe(start + f.maxLoan);
    expect(f.repay()).toBe(true);
    expect(f.loan).toBe(f.maxLoan - f.loanStep);
  });

  it('charges monthly interest', () => {
    const f = new Finance();
    while (f.borrow());
    const before = f.money;
    f.chargeInterest();
    expect(before - f.money).toBe(Math.round((f.maxLoan * economy.interestRate) / 12));
  });

  it('refuses to build without money', () => {
    const w = new World(flatMap());
    w.finance.money = 50;
    const res = w.buildRoad(row(w.map, 5, 2, 6));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Not enough money');
  });

  it('takes running costs and upkeep every month', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 12));
    w.placeDepot(6 * 16 + 5);
    w.buyVehicle(0, 'bus');
    const before = w.money;
    runDays(w, 32); // past 1 February
    expect(w.money).toBeLessThan(before);
    expect(w.finance.lastMonth.running).toBe(100);
    expect(w.finance.lastMonth.maintenance).toBeGreaterThan(0);
  });

  it('sells vehicles for 75 % of the price', () => {
    const w = new World(flatMap());
    w.buildRoad(row(w.map, 5, 2, 12));
    w.placeDepot(6 * 16 + 5);
    const v = w.buyVehicle(0, 'truck', 'coal')!;
    const before = w.money;
    expect(w.sellVehicle(v.id).ok).toBe(true);
    expect(w.money - before).toBe(Math.round(15000 * economy.sellValueFraction));
    expect(w.vehicles.length).toBe(0);
  });
});

/** A straight two-industry freight line on a flat map. */
function freightLine(
  source: 'coal_mine' | 'farm' | 'forest',
  target: 'power_station' | 'food_factory' | 'sawmill',
): { w: World; from: number; to: number } {
  const map = flatMap(32, 16);
  addIndustry(map, source, 2, 2);
  addIndustry(map, target, 20, 2);
  const w = new World(map);
  w.buildRoad(row(map, 6, 1, 26));
  w.placeStop(6 * 32 + 3, 'truck');
  w.placeStop(6 * 32 + 21, 'truck');
  w.placeDepot(7 * 32 + 10);
  return { w, from: 0, to: 1 };
}

describe('cargo chains', () => {
  it('only accepts cargo where an industry or town wants it', () => {
    const { w } = freightLine('coal_mine', 'power_station');
    const plant = w.stops.get(1)!;
    expect(stopAccepts(w, plant, 'coal')).toBe(true);
    expect(stopAccepts(w, plant, 'grain')).toBe(false);
    expect(stopAccepts(w, w.stops.get(0)!, 'coal')).toBe(false);
  });

  it('runs coal from the mine to the power station and earns money', () => {
    const { w, from, to } = freightLine('coal_mine', 'power_station');
    const truck = w.buyVehicle(0, 'truck', 'coal')!;
    w.setRoute(truck.id, [
      { stopId: from, fullLoad: true },
      { stopId: to, fullLoad: false },
    ]);
    runDays(w, 120);
    expect(w.delivered.coal ?? 0).toBeGreaterThanOrEqual(40);
    expect(w.finance.thisYear.income).toBeGreaterThan(0);
    expect(truck.profitThisYear).toBeGreaterThan(0);
  });

  it('waits for a full load when told to', () => {
    const { w, from, to } = freightLine('coal_mine', 'power_station');
    const truck = w.buyVehicle(0, 'truck', 'coal')!;
    w.setRoute(truck.id, [
      { stopId: from, fullLoad: true },
      { stopId: to, fullLoad: false },
    ]);
    let leftWith = -1;
    for (let t = 0; t < 120 * TICKS_PER_DAY && leftWith < 0; t++) {
      const wasLoading = truck.state === 'loading' && truck.loadingAt === from;
      w.step();
      if (wasLoading && truck.loadingAt !== from) leftWith = truck.load;
    }
    expect(leftWith).toBe(truck.capacity);
  });

  const processing: Array<[source: 'farm' | 'forest', factory: 'food_factory' | 'sawmill', input: CargoId, output: CargoId]> = [
    ['farm', 'food_factory', 'grain', 'food'],
    ['forest', 'sawmill', 'wood', 'planks'],
  ];
  for (const [source, factory, input, output] of processing) {
    it(`turns ${input} into ${output} and delivers it to a town`, () => {
      const map = flatMap(32, 24);
      addIndustry(map, source, 2, 10);
      addIndustry(map, factory, 20, 10);
      addTown(map, 20, 19); // streets run x 18..22 on y 19 and y 17..21 on x 20
      const w = new World(map);
      w.buildRoad(row(map, 14, 1, 26));
      w.buildRoad(col(map, 20, 14, 17));
      expect(w.placeStop(14 * 32 + 3, 'truck').ok).toBe(true); // source
      expect(w.placeStop(14 * 32 + 22, 'truck').ok).toBe(true); // factory
      expect(w.placeStop(16 * 32 + 20, 'truck').ok).toBe(true); // town edge
      w.placeDepot(15 * 32 + 10);
      const a = w.buyVehicle(0, 'truck', input)!;
      const b = w.buyVehicle(0, 'truck', output)!;
      w.setRoute(a.id, [{ stopId: 0, fullLoad: true }, { stopId: 1, fullLoad: false }]);
      w.setRoute(b.id, [{ stopId: 1, fullLoad: false }, { stopId: 2, fullLoad: false }]);
      runDays(w, 240);
      expect(w.delivered[input] ?? 0).toBeGreaterThan(0);
      expect(w.delivered[output] ?? 0).toBeGreaterThan(0);
    });
  }

  for (const [model, cargo] of [['bus', 'passengers'], ['van', 'mail']] as const) {
    it(`carries ${cargo} between two towns`, () => {
      const map = flatMap(32, 16);
      addTown(map, 6, 6);
      addTown(map, 24, 6);
      const w = new World(map);
      w.buildRoad(row(map, 6, 8, 22));
      expect(w.placeStop(6 * 32 + 5, 'bus').ok).toBe(true);
      expect(w.placeStop(6 * 32 + 25, 'bus').ok).toBe(true);
      w.placeDepot(7 * 32 + 14);
      const v = w.buyVehicle(0, model)!;
      expect(v.cargo).toBe(cargo);
      w.setRoute(v.id, [0, 1]);
      runDays(w, 120);
      expect(w.delivered[cargo] ?? 0).toBeGreaterThan(0);
      expect(v.profitThisYear).toBeGreaterThan(0);
    });
  }

  it('does not let a truck use bus stops', () => {
    const { w } = freightLine('coal_mine', 'power_station');
    const truck = w.buyVehicle(0, 'truck', 'coal')!;
    w.placeStop(6 * 32 + 15, 'bus');
    expect(w.setRoute(truck.id, [0, 2]).ok).toBe(false);
  });
});

describe('traffic', () => {
  it('keeps vehicles in the same lane apart', () => {
    const map = flatMap(32, 16);
    addTown(map, 6, 6);
    addTown(map, 24, 6);
    const w = new World(map);
    w.finance.money = 1e7;
    w.buildRoad(row(map, 6, 8, 22));
    w.placeStop(6 * 32 + 5, 'bus');
    w.placeStop(6 * 32 + 25, 'bus');
    w.placeDepot(7 * 32 + 14);
    for (let k = 0; k < 6; k++) w.setRoute(w.buyVehicle(0, 'bus')!.id, [0, 1]);
    let closest = Infinity;
    for (let t = 0; t < 90 * TICKS_PER_DAY; t++) {
      w.step();
      const lanes = new Map<number, number[]>();
      for (const v of w.vehicles) {
        // Vehicles just pulling out of a stop or depot start side by side at progress 0.
        if (v.state !== 'driving' || v.progress === 0) continue;
        const next = v.path[v.pathIndex + 1]!;
        const key = v.tile * 16 + dirBetween(32, v.tile, next);
        lanes.set(key, [...(lanes.get(key) ?? []), v.progress]);
      }
      for (const list of lanes.values()) {
        list.sort((a, b) => a - b);
        for (let k = 1; k < list.length; k++) closest = Math.min(closest, list[k]! - list[k - 1]!);
      }
    }
    expect(closest).toBeGreaterThanOrEqual(VEHICLE_GAP - 0.1);
  });

  it('lets at most two vehicles load at a stop', () => {
    const { w, from, to } = freightLine('coal_mine', 'power_station');
    w.finance.money = 1e7;
    for (let k = 0; k < 5; k++) {
      const t = w.buyVehicle(0, 'truck', 'coal')!;
      w.setRoute(t.id, [{ stopId: from, fullLoad: true }, { stopId: to, fullLoad: false }]);
    }
    let most = 0;
    for (let t = 0; t < 60 * TICKS_PER_DAY; t++) {
      w.step();
      most = Math.max(most, w.loadersAt(from));
    }
    expect(most).toBeLessThanOrEqual(economy.maxLoadersPerStop);
  });
});
