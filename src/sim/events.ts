/**
 * Random events (GDD 12): breakdowns, living industries and short events.
 *
 * Rules that keep randomness fair:
 * - bad things are announced before they happen where possible,
 * - the player can do something about them (service, good service, spread risk),
 * - nothing bad happens during the first year (grace period).
 * All randomness comes from the world's seeded event RNG.
 */
import events from '../data/events.json' with { type: 'json' };
import { Occupant, Terrain, WaterKind, type IndustryType } from '../mapgen/types.ts';
import { TICKS_PER_DAY } from './constants.ts';
import { computeCatchment, industryInfo, newIndustryStats } from './economy.ts';
import type { NewsKind, Vehicle } from './types.ts';
import type { World } from './world.ts';

const R = events.reliability;
const I = events.industry;
const E = events.shortEvents;

export const DEPOT_CAPACITY = events.depotCapacity;
export const SERVICE_INTERVAL_DAYS = R.serviceIntervalDays;

export function inGracePeriod(world: World): boolean {
  return world.day < events.graceDays;
}

export function vehicleAgeYears(world: World, v: Vehicle): number {
  return (world.day - v.builtDay) / 365;
}

function news(world: World, text: string, kind: NewsKind, tile?: number, quiet = false): void {
  world.addNews(text, kind, tile, quiet);
}

/** "Coldholt Coal Mine": the type plus the nearest town, so news is unambiguous. */
export function industryName(world: World, id: number): string {
  const ind = world.map.industries[id]!;
  let best: { name: string; d: number } | null = null;
  for (const t of world.map.towns) {
    const d = Math.hypot(t.x - ind.x, t.y - ind.y);
    if (!best || d < best.d) best = { name: t.name, d };
  }
  const type = industryInfo(ind.type).name;
  return best ? `${best.name} ${type}` : type;
}

function industryTile(world: World, id: number): number {
  const ind = world.map.industries[id]!;
  return ind.y * world.map.width + ind.x;
}

// ---------------------------------------------------------------------------
// Daily: reliability and breakdowns

export function dailyVehicleEvents(world: World): void {
  const grace = inGracePeriod(world);
  for (const v of world.vehicles) {
    if (v.state === 'idle' || v.state === 'servicing') continue;
    const old = vehicleAgeYears(world, v) > R.lifespanYears;
    const decay = R.dailyDecay * (old ? R.oldAgeDecayMultiplier : 1);
    v.reliability = Math.max(R.floor, v.reliability - decay);
    if (grace || v.state !== 'driving' || v.brokenTicks > 0) continue;
    const risk = (1 - v.reliability) ** 2 * R.breakdownChanceAtZero;
    if (world.eventRng.next() < risk) {
      v.brokenTicks = world.eventRng.int(R.breakdownDaysMin, R.breakdownDaysMax) * TICKS_PER_DAY;
      v.breakdowns++;
      // The red warning sign on the vehicle is enough; no headline.
      news(world, `${v.name} has broken down`, 'bad', v.tile, true);
    }
  }
}

/** True when the vehicle should visit its depot before the next stop. */
export function needsService(world: World, v: Vehicle): boolean {
  if (!world.depots.has(v.depotId)) return false;
  return v.serviceRequested || world.day - v.lastServiceDay >= R.serviceIntervalDays;
}

/** Reliability after a service: old vehicles never get quite back to new. */
export function servicedReliability(world: World, v: Vehicle): number {
  return vehicleAgeYears(world, v) > R.lifespanYears ? R.oldAgeServicedReliability : 1;
}

export const SERVICE_TICKS = R.serviceDays * TICKS_PER_DAY;

// ---------------------------------------------------------------------------
// Monthly: industries and short events

export function monthlyEvents(world: World): void {
  const grace = inGracePeriod(world);
  industryMonth(world, grace);
  maybeOpenIndustry(world);
  tickModifiers(world);
  if (world.eventRng.next() < E.chancePerMonth) shortEvent(world, grace);
}

function industryMonth(world: World, grace: boolean): void {
  const rng = world.eventRng;
  world.map.industries.forEach((ind, id) => {
    const s = world.industryStats[id]!;
    if (s.closed) return;
    const info = industryInfo(ind.type);
    const base = info.productionPerMonth;

    // Strikes: a warning month, then the strike itself.
    if (s.strikeMonths > 0) {
      if (s.strikeWarned) {
        s.strikeWarned = false;
        news(world, `Workers at ${industryName(world, id)} have gone on strike`, 'bad', industryTile(world, id));
      } else if (--s.strikeMonths === 0) {
        news(world, `The strike at ${industryName(world, id)} is over`, 'good', industryTile(world, id), true);
      }
      return; // a strike month says nothing about the service
    }
    if (s.boostMonths > 0 && --s.boostMonths === 0) {
      s.boost = 1;
      news(world, `${industryName(world, id)}: the extra production has ended`, 'info', industryTile(world, id), true);
    }

    const served = s.transportedLastMonth > 0;
    s.unservedMonths = served ? 0 : s.unservedMonths + 1;
    const ratio = s.producedLastMonth > 0 ? s.transportedLastMonth / s.producedLastMonth : 0;

    // Production changes (sources only).
    if (base > 0 && s.producedLastMonth > 0) {
      if (ratio >= I.growTransported && rng.next() < I.growChance && s.production < base * I.maxFactor) {
        s.production = Math.min(base * I.maxFactor, Math.round(s.production * I.growFactor));
        news(world, `${industryName(world, id)} increases production to ${s.production} a month`, 'good', industryTile(world, id));
      } else if (
        !grace &&
        served &&
        ratio < I.shrinkTransported &&
        rng.next() < I.shrinkChance &&
        s.production > base * I.minFactor
      ) {
        // Only industries the player serves badly shrink; untouched ones are left alone.
        s.production = Math.max(Math.round(base * I.minFactor), Math.round(s.production * I.shrinkFactor));
        news(world, `${industryName(world, id)} cuts production to ${s.production} a month`, 'bad', industryTile(world, id));
      }
    }

    // Closing: announced, and called off if the player starts serving it.
    if (s.closingIn > 0) {
      if (served) {
        s.closingIn = 0;
        news(world, `${industryName(world, id)} will stay open after all`, 'good', industryTile(world, id));
      } else if (--s.closingIn === 0) {
        closeIndustry(world, id);
      }
      return;
    }
    if (
      !grace &&
      s.unservedMonths >= I.closeAfterUnservedMonths &&
      !isLastOfKind(world, ind.type) &&
      world.day - world.lastClosureWarningDay >= I.minDaysBetweenClosures &&
      rng.next() < I.closeChancePerMonth
    ) {
      s.closingIn = I.closeWarningMonths;
      world.lastClosureWarningDay = world.day;
      news(
        world,
        `${industryName(world, id)} announces it will close in ${I.closeWarningMonths} months unless it gets customers`,
        'bad',
        industryTile(world, id),
      );
    }
  });
}

/** Never close the last open industry of a type, so every cargo chain stays possible. */
function isLastOfKind(world: World, type: IndustryType): boolean {
  return world.map.industries.filter((ind, id) => ind.type === type && !world.industryStats[id]!.closed).length <= 1;
}

function closeIndustry(world: World, id: number): void {
  const { map } = world;
  const ind = map.industries[id]!;
  const s = world.industryStats[id]!;
  s.closed = true;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = (ind.y + dy) * map.width + ind.x + dx;
      map.occupant[i] = Occupant.None;
      map.occupantId[i] = -1;
      map.terrain[i] = Terrain.Rough;
      world.dirty.add(i);
    }
  }
  world.labelsDirty = true;
  news(world, `${industryName(world, id)} has closed down`, 'bad', ind.y * map.width + ind.x);
}

function maybeOpenIndustry(world: World): void {
  const month = Math.floor(world.day / 30.44);
  if (month < I.newIndustryFirstMonth) return;
  const open = world.industryStats.filter((s) => !s.closed).length;
  const extra = open < world.initialIndustryCount ? I.newIndustryExtraWhenFewer : 0;
  if (world.eventRng.next() >= I.newIndustryChancePerMonth + extra) return;
  const types: IndustryType[] = ['coal_mine', 'power_station', 'farm', 'food_factory', 'forest', 'sawmill'];
  // Prefer types that are rare on the map right now.
  types.sort(
    (a, b) =>
      world.map.industries.filter((x, id) => x.type === a && !world.industryStats[id]!.closed).length -
      world.map.industries.filter((x, id) => x.type === b && !world.industryStats[id]!.closed).length,
  );
  const type = world.eventRng.chance(0.6) ? types[0]! : world.eventRng.pick(types);
  const spot = findIndustrySpot(world);
  if (spot < 0) return;
  addIndustry(world, type, spot);
}

/** A free, flat 2x2 spot away from towns and roads, or -1. */
function findIndustrySpot(world: World): number {
  const { map } = world;
  const { width, height } = map;
  for (let attempt = 0; attempt < 400; attempt++) {
    const x = world.eventRng.int(2, width - 4);
    const y = world.eventRng.int(2, height - 4);
    let ok = true;
    let lo = 99;
    let hi = 0;
    for (let dy = -1; dy <= 2 && ok; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        const i = (y + dy) * width + x + dx;
        if (map.occupant[i] !== Occupant.None || world.roads[i] !== 0) {
          ok = false;
          break;
        }
        const inner = dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
        if (inner) {
          if (map.water[i] !== WaterKind.None || map.terrain[i] === Terrain.Rock) {
            ok = false;
            break;
          }
          lo = Math.min(lo, map.heights[i]!);
          hi = Math.max(hi, map.heights[i]!);
        }
      }
    }
    if (!ok || hi - lo > 1) continue;
    if (map.towns.some((t) => Math.hypot(t.x - x, t.y - y) < 5)) continue;
    return y * width + x;
  }
  return -1;
}

export function addIndustry(world: World, type: IndustryType, tile: number): number {
  const { map } = world;
  const x = tile % map.width;
  const y = (tile - x) / map.width;
  const id = map.industries.length;
  map.industries.push({ id, type, x, y });
  world.industryStats.push(newIndustryStats(industryInfo(type).productionPerMonth));
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = (y + dy) * map.width + x + dx;
      map.occupant[i] = Occupant.Industry;
      map.occupantId[i] = id;
      map.terrain[i] = Terrain.Grass;
      world.dirty.add(i);
    }
  }
  // Stops nearby now see the new industry.
  for (const stop of world.stops.values()) {
    const c = computeCatchment(map, stop.tile);
    stop.industries = c.industries;
    stop.towns = c.towns;
  }
  world.labelsDirty = true;
  news(world, `A new ${industryName(world, id)} has opened`, 'good', tile);
  return id;
}

function tickModifiers(world: World): void {
  const m = world.modifiers;
  if (m.paymentMonths > 0 && --m.paymentMonths === 0) {
    m.payment = 1;
    news(world, 'The economy has recovered: payments are back to normal', 'good');
  }
  if (m.runningMonths > 0 && --m.runningMonths === 0) {
    m.running = 1;
    news(world, 'Fuel prices are back to normal', 'info');
  }
  for (const [town, months] of [...m.festivals]) {
    if (months <= 1) m.festivals.delete(town);
    else m.festivals.set(town, months - 1);
  }
}

type ShortEvent = keyof typeof E.weights;

function shortEvent(world: World, grace: boolean): void {
  const rng = world.eventRng;
  const bad: ShortEvent[] = ['strike', 'recession'];
  const options = (Object.keys(E.weights) as ShortEvent[]).filter((k) => !(grace && bad.includes(k)));
  const total = options.reduce((s, k) => s + E.weights[k], 0);
  let roll = rng.next() * total;
  let pick = options[0]!;
  for (const k of options) {
    roll -= E.weights[k];
    if (roll < 0) {
      pick = k;
      break;
    }
  }
  const { map } = world;
  const openIds = map.industries.map((_, id) => id).filter((id) => !world.industryStats[id]!.closed);

  switch (pick) {
    case 'boom': {
      const sources = openIds.filter((id) => industryInfo(map.industries[id]!.type).productionPerMonth > 0);
      if (sources.length === 0) return;
      // Usually somewhere the player is already working, so it matters.
      const served = sources.filter((id) => world.industryStats[id]!.transportedLastMonth > 0);
      const id = served.length > 0 && rng.chance(0.7) ? rng.pick(served) : rng.pick(sources);
      const s = world.industryStats[id]!;
      s.boost = E.boomMultiplier;
      s.boostMonths = rng.int(E.boomMonthsMin, E.boomMonthsMax);
      const what = map.industries[id]!.type === 'farm' ? 'A record harvest' : map.industries[id]!.type === 'coal_mine' ? 'A rich new coal seam' : 'A stand of fine timber';
      news(world, `${what} at ${industryName(world, id)}: double production for ${s.boostMonths} months`, 'good', industryTile(world, id));
      return;
    }
    case 'strike': {
      // Strikes hit industries the player serves, so they matter; one month's warning.
      const served = openIds.filter((id) => world.industryStats[id]!.transportedLastMonth > 0 && world.industryStats[id]!.strikeMonths === 0);
      if (served.length === 0) return;
      const id = rng.pick(served);
      const s = world.industryStats[id]!;
      s.strikeMonths = E.strikeMonths;
      s.strikeWarned = true;
      news(world, `Workers at ${industryName(world, id)} threaten to strike next month`, 'bad', industryTile(world, id));
      return;
    }
    case 'festival': {
      if (map.towns.length === 0) return;
      const town = rng.pick(map.towns);
      world.modifiers.festivals.set(town.id, 1);
      news(world, `${town.name} holds a festival: twice as many passengers this month`, 'good', town.y * map.width + town.x);
      return;
    }
    case 'recession': {
      if (world.modifiers.paymentMonths > 0) return;
      world.modifiers.payment = E.recessionPaymentMultiplier;
      world.modifiers.paymentMonths = E.recessionMonths;
      news(world, `Recession: deliveries pay ${Math.round((1 - E.recessionPaymentMultiplier) * 100)} % less for ${E.recessionMonths} months`, 'bad');
      return;
    }
    case 'fuel': {
      if (world.modifiers.runningMonths > 0) return;
      const up = rng.chance(0.5);
      if (up && grace) return;
      world.modifiers.running = up ? 1 + E.fuelChange : 1 - E.fuelChange;
      world.modifiers.runningMonths = E.fuelMonths;
      news(
        world,
        `Fuel prices ${up ? 'rise' : 'fall'}: running costs ${up ? '+' : '-'}${Math.round(E.fuelChange * 100)} % for a year`,
        up ? 'bad' : 'good',
      );
      return;
    }
  }
}
