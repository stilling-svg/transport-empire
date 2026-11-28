/**
 * Production, catchment areas, acceptance and delivery (GDD 4 and 6).
 *
 * Industries and towns put cargo into the stops around them that are served
 * by a vehicle carrying that cargo. Cargo has no fixed destination: it is
 * paid for at any stop that accepts it.
 */
import economy from '../data/economy.json' with { type: 'json' };
import industries from '../data/industries.json' with { type: 'json' };
import { Occupant, type GameMap, type IndustryType } from '../mapgen/types.ts';
import { TOWN_ACCEPTS, cargoInfo, deliveryPayment, type CargoId } from './cargo.ts';
import { TICKS_PER_DAY } from './constants.ts';
import type { IndustryStats, Stop, Vehicle } from './types.ts';
import type { World } from './world.ts';

interface IndustryInfo {
  name: string;
  produces: CargoId[];
  accepts: CargoId[];
  productionPerMonth: number;
}

export function industryInfo(type: IndustryType): IndustryInfo {
  return (industries as unknown as Record<IndustryType, IndustryInfo>)[type];
}

const DAYS_PER_MONTH = 30;

/** Finds industries and towns within the catchment radius of a stop tile. */
export function computeCatchment(map: GameMap, tile: number): { industries: number[]; towns: number[] } {
  const r = economy.catchmentRadius;
  const { width, height } = map;
  const x0 = tile % width;
  const y0 = (tile - x0) / width;
  const inds = new Set<number>();
  const towns = new Set<number>();
  for (let y = Math.max(0, y0 - r); y <= Math.min(height - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(width - 1, x0 + r); x++) {
      const i = y * width + x;
      if (map.occupant[i] === Occupant.Industry) inds.add(map.occupantId[i]!);
      if (map.occupant[i] === Occupant.Town) towns.add(map.occupantId[i]!);
    }
  }
  return { industries: [...inds].sort((a, b) => a - b), towns: [...towns].sort((a, b) => a - b) };
}

/** True if the stop takes deliveries of this cargo. */
export function stopAccepts(world: World, stop: Stop, cargo: CargoId): boolean {
  if (cargoInfo(cargo).stop !== stop.kind) return false;
  if (TOWN_ACCEPTS.includes(cargo) && stop.towns.length > 0) return true;
  return stop.industries.some(
    (id) => !isClosed(world, id) && industryInfo(world.map.industries[id]!.type).accepts.includes(cargo),
  );
}

export function isClosed(world: World, industryId: number): boolean {
  return world.industryStats[industryId]?.closed ?? true;
}

/** Cargo types that can be picked up at a stop (from industries/towns around it). */
export function stopSupplies(world: World, stop: Stop): CargoId[] {
  const out = new Set<CargoId>();
  for (const id of stop.industries) {
    if (isClosed(world, id)) continue;
    for (const c of industryInfo(world.map.industries[id]!.type).produces) out.add(c);
  }
  if (stop.towns.length > 0) {
    out.add('passengers');
    out.add('mail');
  }
  return [...out].filter((c) => cargoInfo(c).stop === stop.kind);
}

/** Stops served for each cargo: a vehicle carrying that cargo has the stop in its orders. */
function servedStops(world: World): Map<CargoId, Set<number>> {
  const served = new Map<CargoId, Set<number>>();
  for (const v of world.vehicles) {
    let set = served.get(v.cargo);
    if (!set) served.set(v.cargo, (set = new Set()));
    for (const o of v.orders) set.add(o.stopId);
  }
  return served;
}

/** Hands `amount` of cargo to the served stops around a source. Returns how much was taken. */
function distribute(
  world: World,
  served: Map<CargoId, Set<number>>,
  cargo: CargoId,
  amount: number,
  wants: (stop: Stop) => boolean,
): number {
  if (amount <= 0) return 0;
  const set = served.get(cargo);
  if (!set) return 0;
  const targets: Stop[] = [];
  for (const id of set) {
    const stop = world.stops.get(id);
    if (stop && stop.kind === cargoInfo(cargo).stop && wants(stop)) targets.push(stop);
  }
  if (targets.length === 0) return 0;
  targets.sort((a, b) => a.id - b.id);
  const share = Math.floor(amount / targets.length);
  let rest = amount - share * targets.length;
  let taken = 0;
  for (const stop of targets) {
    const add = share + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
    const now = stop.waiting[cargo] ?? 0;
    const room = Math.max(0, economy.maxWaitingPerCargo - now);
    const put = Math.min(add, room);
    stop.waiting[cargo] = now + put;
    taken += put;
  }
  return taken;
}

/** One day of production at all industries and towns. */
export function produceDaily(world: World): void {
  const { map } = world;
  const served = servedStops(world);

  map.industries.forEach((ind, id) => {
    const info = industryInfo(ind.type);
    const stats = world.industryStats[id]!;
    if (stats.closed) return;
    const striking = stats.strikeMonths > 0 && !stats.strikeWarned;
    let made = 0;
    if (striking) {
      made = 0; // nothing is made during a strike; deliveries pile up
    } else if (info.accepts.length > 0) {
      // Processing industries turn delivered input into output 1:1.
      made = stats.stock;
      stats.stock = 0;
    } else {
      const boost = stats.boostMonths > 0 ? stats.boost : 1;
      stats.carry += (stats.production * boost) / DAYS_PER_MONTH;
      made = Math.floor(stats.carry);
      stats.carry -= made;
    }
    if (made <= 0) return;
    for (const cargo of info.produces) {
      stats.producedThisMonth += made;
      stats.transportedThisMonth += distribute(world, served, cargo, made, (s) => s.industries.includes(id));
    }
  });

  map.towns.forEach((town, id) => {
    const carry = world.townCarry[id]!;
    const festival = world.modifiers.festivals.has(id) ? world.festivalMultiplier : 1;
    carry.passengers += (town.population * economy.townPassengersPerPopulation * festival) / DAYS_PER_MONTH;
    carry.mail += (town.population * economy.townMailPerPopulation) / DAYS_PER_MONTH;
    for (const cargo of ['passengers', 'mail'] as const) {
      const made = Math.floor(carry[cargo]);
      carry[cargo] -= made;
      distribute(world, served, cargo, made, (s) => s.towns.includes(id));
    }
  });
}

export function newIndustryStats(production: number): IndustryStats {
  return {
    stock: 0,
    carry: 0,
    producedThisMonth: 0,
    transportedThisMonth: 0,
    producedLastMonth: 0,
    transportedLastMonth: 0,
    production,
    unservedMonths: 0,
    closingIn: 0,
    closed: false,
    boost: 1,
    boostMonths: 0,
    strikeMonths: 0,
    strikeWarned: false,
  };
}

/**
 * A vehicle has arrived at a stop in its orders: deliver what the stop accepts,
 * then load what is waiting. Returns the payment made.
 */
export function unloadAndLoad(world: World, v: Vehicle, stop: Stop): number {
  let paid = 0;
  if (v.load > 0 && v.loadFrom !== stop.tile && stopAccepts(world, stop, v.cargo)) {
    const w = world.map.width;
    const fx = v.loadFrom % w;
    const fy = (v.loadFrom - fx) / w;
    const tx = stop.tile % w;
    const ty = (stop.tile - tx) / w;
    const distance = Math.abs(fx - tx) + Math.abs(fy - ty);
    const days = (world.tick - v.loadTick) / TICKS_PER_DAY;
    paid = Math.round(deliveryPayment(v.cargo, v.load, distance, days) * world.modifiers.payment);
    world.finance.earn(paid);
    v.profitThisYear += paid;
    // Processing industries in the catchment receive the delivered input.
    const factory = stop.industries.find(
      (id) => !isClosed(world, id) && industryInfo(world.map.industries[id]!.type).accepts.includes(v.cargo),
    );
    if (factory !== undefined) world.industryStats[factory]!.stock += v.load;
    world.delivered[v.cargo] = (world.delivered[v.cargo] ?? 0) + v.load;
    v.load = 0;
  }
  loadMore(world, v, stop);
  return paid;
}

/** Moves waiting cargo onto the vehicle, as much as fits. */
export function loadMore(world: World, v: Vehicle, stop: Stop): void {
  const waiting = stop.waiting[v.cargo] ?? 0;
  const take = Math.min(v.capacity - v.load, waiting);
  if (take <= 0) return;
  if (v.load === 0) {
    v.loadFrom = stop.tile;
    v.loadTick = world.tick;
  }
  v.load += take;
  stop.waiting[v.cargo] = waiting - take;
}
