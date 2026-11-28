/**
 * The game world: the generated map plus everything the player builds and
 * runs, the money, and the fixed-step simulation. Pure TypeScript – no DOM.
 */
import costs from '../data/costs.json' with { type: 'json' };
import economy from '../data/economy.json' with { type: 'json' };
import events from '../data/events.json' with { type: 'json' };
import { Rng } from '../mapgen/rng.ts';
import { Occupant, Terrain, WaterKind, type GameMap } from '../mapgen/types.ts';
import { monthIndex } from './calendar.ts';
import type { CargoId, StopKind } from './cargo.ts';
import { DIRS, RoadOwner, TICKS_PER_DAY } from './constants.ts';
import { computeCatchment, industryInfo, newIndustryStats, produceDaily } from './economy.ts';
import { DEPOT_CAPACITY, dailyVehicleEvents, monthlyEvents } from './events.ts';
import { Finance } from './finance.ts';
import { buildTownRoads, isStraightRoad, planRoad, type RoadPlan } from './roads.ts';
import type { Depot, IndustryStats, Modifiers, ModelId, NewsItem, NewsKind, Order, Stop, Vehicle } from './types.ts';
import { MODELS, buildOccupancy, planToTarget, sendForService, updateVehicle } from './vehicles.ts';

export type { Depot, NewsItem, Order, Stop, Vehicle };

export interface ActionResult {
  ok: boolean;
  cost: number;
  reason?: string;
}

interface Snapshot {
  roads: Uint8Array;
  roadOwner: Uint8Array;
  terrain: Uint8Array;
  stopAt: Int32Array;
  depotAt: Int32Array;
  stops: Stop[];
  depots: Depot[];
  /** What the action cost, refunded by undo. */
  cost: number;
}

export const MAX_UNDO = 10;
const NOT_ENOUGH_MONEY = 'Not enough money';

export class World {
  readonly map: GameMap;
  readonly roads: Uint8Array;
  readonly roadOwner: Uint8Array;
  readonly stopAt: Int32Array;
  readonly depotAt: Int32Array;
  readonly stops = new Map<number, Stop>();
  readonly depots = new Map<number, Depot>();
  readonly vehicles: Vehicle[] = [];
  readonly finance = new Finance();
  readonly industryStats: IndustryStats[];
  readonly townCarry: Array<{ passengers: number; mail: number }>;
  /** Total amount delivered per cargo since the start (statistics and tests). */
  readonly delivered: Partial<Record<CargoId, number>> = {};
  /** Seeded source of all random events, so a seed replays the same way. */
  readonly eventRng: Rng;
  readonly modifiers: Modifiers = { payment: 1, paymentMonths: 0, running: 1, runningMonths: 0, festivals: new Map() };
  readonly festivalMultiplier: number = events.shortEvents.festivalMultiplier;
  /** Newest last. `newsCount` grows forever so the UI can spot new items. */
  readonly news: NewsItem[] = [];
  newsCount = 0;
  /** Set when industries open or close, so labels are rebuilt. */
  labelsDirty = false;
  readonly initialIndustryCount: number;
  tick = 0;
  /** Tiles whose look changed since the renderer last looked. */
  readonly dirty = new Set<number>();
  private currentMonth = 0;
  private undoStack: Snapshot[] = [];
  private nextStopId = 0;
  private nextDepotId = 0;
  private nextVehicleId = 0;

  constructor(map: GameMap) {
    this.map = map;
    const n = map.width * map.height;
    this.roads = new Uint8Array(n);
    this.roadOwner = new Uint8Array(n);
    this.stopAt = new Int32Array(n).fill(-1);
    this.depotAt = new Int32Array(n).fill(-1);
    this.industryStats = map.industries.map((ind) => newIndustryStats(industryInfo(ind.type).productionPerMonth));
    this.initialIndustryCount = map.industries.length;
    this.eventRng = new Rng(`${map.usedSeed}#events`);
    this.townCarry = map.towns.map(() => ({ passengers: 0, mail: 0 }));
    buildTownRoads(this);
  }

  /** Days since 1 January 1930. */
  get day(): number {
    return this.tick / TICKS_PER_DAY;
  }

  get money(): number {
    return this.finance.money;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  // -------------------------------------------------------------------------
  // Simulation

  step(): void {
    this.tick++;
    if (this.tick % TICKS_PER_DAY === 0) this.daily();
    const occ = buildOccupancy(this);
    for (const v of this.vehicles) updateVehicle(this, v, occ);
  }

  private daily(): void {
    produceDaily(this);
    dailyVehicleEvents(this);
    const month = monthIndex(this.day);
    if (month !== this.currentMonth) {
      this.monthly(month % 12 === 0);
      this.currentMonth = month;
    }
  }

  /** Month end: running costs, upkeep and interest; statistics roll over. */
  private monthly(newYear: boolean): void {
    const f = this.finance;
    for (const v of this.vehicles) {
      const cost = Math.round((MODELS[v.model].runningCost * this.modifiers.running) / 12);
      f.spend('running', cost);
      v.profitThisYear -= cost;
    }
    f.spend('maintenance', Math.round((this.infrastructureValue() * economy.maintenanceRate) / 12));
    f.chargeInterest();
    f.rollMonth(newYear);
    for (const s of this.industryStats) {
      s.producedLastMonth = s.producedThisMonth;
      s.transportedLastMonth = s.transportedThisMonth;
      s.producedThisMonth = 0;
      s.transportedThisMonth = 0;
    }
    if (newYear) {
      for (const v of this.vehicles) {
        v.profitLastYear = v.profitThisYear;
        v.profitThisYear = 0;
      }
    }
    monthlyEvents(this);
  }

  addNews(text: string, kind: NewsKind, tile?: number): void {
    this.news.push({ day: Math.floor(this.day), text, kind, tile });
    this.newsCount++;
    if (this.news.length > events.maxNews) this.news.shift();
  }

  /** What the player's roads, bridges, stops and depots would cost to build again. */
  infrastructureValue(): number {
    let value = 0;
    for (let i = 0; i < this.roads.length; i++) {
      if (this.roadOwner[i] !== RoadOwner.Player || this.depotAt[i]! >= 0) continue;
      value += this.map.water[i] === WaterKind.River ? costs.bridgePerTile : costs.roadPerTile;
    }
    for (const s of this.stops.values()) value += s.kind === 'bus' ? costs.busStop : costs.truckStop;
    value += this.depots.size * costs.depot;
    return value;
  }

  /** Number of vehicles currently loading at a stop. */
  loadersAt(stopId: number): number {
    let n = 0;
    for (const v of this.vehicles) if (v.loadingAt === stopId) n++;
    return n;
  }

  // -------------------------------------------------------------------------
  // Money

  borrow(): ActionResult {
    return this.finance.borrow()
      ? { ok: true, cost: 0 }
      : { ok: false, cost: 0, reason: 'You cannot borrow more' };
  }

  repay(): ActionResult {
    return this.finance.repay()
      ? { ok: true, cost: 0 }
      : { ok: false, cost: 0, reason: this.finance.loan === 0 ? 'You have no loan' : NOT_ENOUGH_MONEY };
  }

  // -------------------------------------------------------------------------
  // Construction

  planRoad(path: readonly number[]): RoadPlan {
    return planRoad(this, path);
  }

  buildRoad(path: readonly number[]): ActionResult {
    const plan = this.planRoad(path);
    if (!plan.ok) return { ok: false, cost: 0, reason: plan.reason };
    if (plan.links.length === 0) return { ok: false, cost: 0, reason: 'The road is already there' };
    if (!this.finance.canAfford(plan.cost)) return { ok: false, cost: plan.cost, reason: NOT_ENOUGH_MONEY };
    this.saveUndo(plan.cost);
    for (const [i, bit] of plan.links) {
      this.roads[i] = this.roads[i]! | bit;
      if (this.roadOwner[i] === RoadOwner.None) this.roadOwner[i] = RoadOwner.Player;
      this.dirty.add(i);
    }
    for (const t of plan.tiles) {
      // Building a road clears trees and fields.
      if (this.map.water[t.index] === WaterKind.None) this.map.terrain[t.index] = Terrain.Grass;
      this.dirty.add(t.index);
    }
    this.finance.spend('construction', plan.cost);
    return { ok: true, cost: plan.cost };
  }

  /** Removes the player's roads, stops and depots on the given tiles. */
  demolish(tiles: readonly number[]): ActionResult {
    const snapshot = this.snapshot(0);
    let removed = 0;
    let reason: string | undefined;
    const busy = new Set<number>();
    for (const v of this.vehicles) {
      busy.add(v.tile);
      const next = v.path[v.pathIndex + 1];
      if (v.state === 'driving' && next !== undefined) busy.add(next);
    }

    for (const i of new Set(tiles)) {
      if (i < 0 || i >= this.roads.length) continue;
      if (busy.has(i) && (this.roads[i] !== 0 || this.depotAt[i]! >= 0)) {
        reason ??= 'A vehicle is in the way';
        continue;
      }
      if (this.depotAt[i]! >= 0) {
        const id = this.depotAt[i]!;
        if (this.vehicles.some((v) => v.depotId === id)) {
          reason ??= 'Sell or move this depot’s vehicles first';
          continue;
        }
        this.depots.delete(id);
        this.depotAt[i] = -1;
        this.clearRoadTile(i);
        removed++;
        continue;
      }
      if (this.stopAt[i]! >= 0) {
        this.removeStop(i);
        removed++;
      }
      if (this.roadOwner[i] === RoadOwner.Player) {
        this.clearRoadTile(i);
        removed++;
      } else if (this.roadOwner[i] === RoadOwner.Town && this.stopAt[i]! < 0) {
        reason ??= 'Town roads cannot be demolished';
      }
    }

    if (removed === 0) return { ok: false, cost: 0, reason: reason ?? 'Nothing to demolish here' };
    this.pushUndo(snapshot);
    for (const v of this.vehicles) {
      if (v.orders.some((o) => !this.stops.has(o.stopId))) {
        if (v.loadingAt >= 0 && !this.stops.has(v.loadingAt)) v.loadingAt = -1;
        planToTarget(this, v);
      }
    }
    return { ok: true, cost: 0, reason };
  }

  placeStop(i: number, kind: StopKind = 'bus'): ActionResult {
    if (i < 0 || i >= this.roads.length) return { ok: false, cost: 0, reason: 'Outside the map' };
    if (this.stopAt[i]! >= 0) return { ok: false, cost: 0, reason: 'There is already a stop here' };
    if (this.roads[i] === 0 || this.depotAt[i]! >= 0) {
      return { ok: false, cost: 0, reason: 'Stops must be placed on a road' };
    }
    if (this.map.water[i] !== WaterKind.None) return { ok: false, cost: 0, reason: 'Not on a bridge' };
    if (!isStraightRoad(this.roads[i]!)) {
      return { ok: false, cost: 0, reason: 'Stops need a straight piece of road' };
    }
    const cost = kind === 'bus' ? costs.busStop : costs.truckStop;
    if (!this.finance.canAfford(cost)) return { ok: false, cost, reason: NOT_ENOUGH_MONEY };
    this.saveUndo(cost);
    const id = this.nextStopId++;
    const catchment = computeCatchment(this.map, i);
    this.stops.set(id, {
      id,
      tile: i,
      kind,
      name: this.stopName(i, kind, catchment.industries),
      waiting: {},
      ...catchment,
    });
    this.stopAt[i] = id;
    this.dirty.add(i);
    this.finance.spend('construction', cost);
    return { ok: true, cost };
  }

  placeDepot(i: number): ActionResult {
    const { map } = this;
    const { width, height } = map;
    if (i < 0 || i >= this.roads.length) return { ok: false, cost: 0, reason: 'Outside the map' };
    if (map.water[i] !== WaterKind.None) return { ok: false, cost: 0, reason: 'Cannot build on water' };
    if (map.occupant[i] !== Occupant.None || this.roads[i] !== 0 || this.depotAt[i]! >= 0) {
      return { ok: false, cost: 0, reason: 'Something is in the way' };
    }
    const x = i % width;
    const y = (i - x) / width;
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (this.roads[n] === 0 || this.depotAt[n]! >= 0) continue;
      if (map.water[n] !== WaterKind.None) continue;
      if (Math.abs(map.heights[n]! - map.heights[i]!) > costs.maxRoadClimb) continue;
      if (!this.finance.canAfford(costs.depot)) {
        return { ok: false, cost: costs.depot, reason: NOT_ENOUGH_MONEY };
      }
      this.saveUndo(costs.depot);
      this.roads[i] = d.bit;
      this.roads[n] = this.roads[n]! | d.opposite;
      this.roadOwner[i] = RoadOwner.Player;
      const id = this.nextDepotId++;
      this.depots.set(id, { id, tile: i });
      this.depotAt[i] = id;
      map.terrain[i] = Terrain.Grass;
      this.dirty.add(i);
      this.dirty.add(n);
      this.finance.spend('construction', costs.depot);
      return { ok: true, cost: costs.depot };
    }
    return { ok: false, cost: 0, reason: 'Depots must be next to a road' };
  }

  // -------------------------------------------------------------------------
  // Vehicles

  /** Vehicles that belong to a depot. */
  vehiclesIn(depotId: number): Vehicle[] {
    return this.vehicles.filter((v) => v.depotId === depotId);
  }

  /** Why a vehicle cannot be bought here, or null if it can. */
  buyProblem(depotId: number, model: ModelId): string | null {
    if (!this.depots.has(depotId)) return 'No such depot';
    if (this.vehiclesIn(depotId).length >= DEPOT_CAPACITY) {
      return `This depot is full (${DEPOT_CAPACITY} vehicles) – build another depot`;
    }
    if (!this.finance.canAfford(MODELS[model].price)) return NOT_ENOUGH_MONEY;
    return null;
  }

  /** Buys a vehicle in a depot. Trucks need the cargo they will carry. */
  buyVehicle(depotId: number, model: ModelId = 'bus', cargo?: CargoId): Vehicle | null {
    const depot = this.depots.get(depotId);
    const info = MODELS[model];
    if (!depot || this.buyProblem(depotId, model)) return null;
    const carried = cargo && info.cargo.includes(cargo) ? cargo : info.cargo[0]!;
    const id = this.nextVehicleId++;
    const sameKind = this.vehicles.filter((v) => v.model === model).length;
    const v: Vehicle = {
      id,
      name: `${info.name} ${sameKind + 1}`,
      model,
      cargo: carried,
      capacity: info.capacity,
      depotId,
      orders: [],
      orderIndex: 0,
      state: 'idle',
      tile: depot.tile,
      path: [depot.tile],
      pathIndex: 0,
      progress: 0,
      waitTicks: 0,
      loadingAt: -1,
      arrivals: 0,
      lastStopId: -1,
      load: 0,
      loadFrom: -1,
      loadTick: 0,
      price: info.price,
      profitThisYear: 0,
      profitLastYear: 0,
      builtDay: this.day,
      reliability: 1,
      lastServiceDay: this.day,
      brokenTicks: 0,
      breakdowns: 0,
      goingToDepot: false,
      serviceRequested: false,
    };
    this.vehicles.push(v);
    this.finance.spend('purchases', info.price);
    return v;
  }

  /** Buys a bus (shorthand used by tests). */
  buyBus(depotId: number): Vehicle | null {
    return this.buyVehicle(depotId, 'bus');
  }

  /** Sends a vehicle to its depot for service. */
  serviceVehicle(vehicleId: number): ActionResult {
    const v = this.vehicles.find((x) => x.id === vehicleId);
    if (!v) return { ok: false, cost: 0, reason: 'No such vehicle' };
    return sendForService(this, v)
      ? { ok: true, cost: 0 }
      : { ok: false, cost: 0, reason: 'This vehicle has no depot' };
  }

  /** Sells a vehicle for part of its price. */
  sellVehicle(vehicleId: number): ActionResult {
    const k = this.vehicles.findIndex((v) => v.id === vehicleId);
    if (k < 0) return { ok: false, cost: 0, reason: 'No such vehicle' };
    const v = this.vehicles[k]!;
    const value = Math.round(v.price * economy.sellValueFraction);
    this.vehicles.splice(k, 1);
    this.finance.spend('purchases', -value);
    return { ok: true, cost: -value };
  }

  /**
   * Gives a vehicle its orders and sends it on its way. Accepts stop ids
   * (no full load) or orders. Stops must be of the kind the vehicle uses.
   */
  setRoute(vehicleId: number, route: readonly (number | Order)[]): ActionResult {
    const v = this.vehicles.find((x) => x.id === vehicleId);
    if (!v) return { ok: false, cost: 0, reason: 'No such vehicle' };
    const kind = MODELS[v.model].stop;
    const orders = route
      .map((r) => (typeof r === 'number' ? { stopId: r, fullLoad: false } : { ...r }))
      .filter((o) => this.stops.get(o.stopId)?.kind === kind);
    if (orders.length < 2) return { ok: false, cost: 0, reason: 'Choose at least two stops' };
    v.orders = orders;
    v.orderIndex = 0;
    v.loadingAt = -1;
    if (v.state === 'servicing') return { ok: true, cost: 0 }; // continues after the service
    if (v.brokenTicks === 0) v.goingToDepot = v.serviceRequested && v.goingToDepot;
    planToTarget(this, v);
    return { ok: true, cost: 0 };
  }

  /** Whether a stop is the right kind for a vehicle model. */
  stopFits(stopId: number, model: ModelId): boolean {
    return this.stops.get(stopId)?.kind === MODELS[model].stop;
  }

  // -------------------------------------------------------------------------
  // Undo

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    const changed = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) this.dirty.add(i);
    };
    changed(this.roads, s.roads);
    changed(this.map.terrain, s.terrain);
    changed(this.stopAt, s.stopAt);
    changed(this.depotAt, s.depotAt);
    this.roads.set(s.roads);
    this.roadOwner.set(s.roadOwner);
    this.map.terrain.set(s.terrain);
    this.stopAt.set(s.stopAt);
    this.depotAt.set(s.depotAt);
    // Stops that still exist keep the cargo waiting there now.
    const current = new Map(this.stops);
    this.stops.clear();
    for (const st of s.stops) {
      const now = current.get(st.id);
      this.stops.set(st.id, { ...st, waiting: now ? now.waiting : { ...st.waiting } });
    }
    this.depots.clear();
    for (const d of s.depots) this.depots.set(d.id, { ...d });
    if (s.cost > 0) this.finance.spend('construction', -s.cost);
    // Vehicles left without a road under them are sold; the rest re-plan.
    for (let k = this.vehicles.length - 1; k >= 0; k--) {
      const v = this.vehicles[k]!;
      if (this.roads[v.tile] === 0) this.sellVehicle(v.id);
      else if (v.state !== 'idle') {
        if (v.loadingAt >= 0 && !this.stops.has(v.loadingAt)) v.loadingAt = -1;
        if (v.state !== 'loading' || v.loadingAt < 0) planToTarget(this, v);
      }
    }
    return true;
  }

  private snapshot(cost: number): Snapshot {
    return {
      roads: this.roads.slice(),
      roadOwner: this.roadOwner.slice(),
      terrain: this.map.terrain.slice(),
      stopAt: this.stopAt.slice(),
      depotAt: this.depotAt.slice(),
      stops: [...this.stops.values()].map((s) => ({ ...s, waiting: { ...s.waiting } })),
      depots: [...this.depots.values()].map((d) => ({ ...d })),
      cost,
    };
  }

  private pushUndo(s: Snapshot): void {
    this.undoStack.push(s);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private saveUndo(cost: number): void {
    this.pushUndo(this.snapshot(cost));
  }

  // -------------------------------------------------------------------------
  // Helpers

  private removeStop(i: number): void {
    const id = this.stopAt[i]!;
    this.stops.delete(id);
    this.stopAt[i] = -1;
    for (const v of this.vehicles) if (v.loadingAt === id) v.loadingAt = -1;
    this.dirty.add(i);
  }

  /** Removes all road links of a tile, including the matching bits on neighbours. */
  private clearRoadTile(i: number): void {
    const { width, height } = this.map;
    const x = i % width;
    const y = (i - x) / width;
    for (const d of DIRS) {
      if ((this.roads[i]! & d.bit) === 0) continue;
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      this.roads[n] = this.roads[n]! & ~d.opposite;
      if (this.roads[n] === 0 && this.roadOwner[n] === RoadOwner.Player) this.roadOwner[n] = RoadOwner.None;
      if (this.roads[n] === 0 && this.stopAt[n]! >= 0) this.removeStop(n);
      this.dirty.add(n);
    }
    this.roads[i] = 0;
    this.roadOwner[i] = RoadOwner.None;
    this.dirty.add(i);
  }

  private stopName(i: number, kind: StopKind, industries: number[]): string {
    const { width } = this.map;
    const x = i % width;
    const y = (i - x) / width;
    let best: { name: string; d: number } | null = null;
    for (const t of this.map.towns) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (!best || d < best.d) best = { name: t.name, d };
    }
    const town = best && best.d <= 24 ? best.name : 'Countryside';
    let base = town;
    if (kind === 'truck') {
      const ind = industries[0] !== undefined ? this.map.industries[industries[0]] : undefined;
      base = ind ? `${town} ${industryInfo(ind.type).name}` : `${town} Freight`;
    }
    const taken = [...this.stops.values()].filter(
      (s) => s.name === base || s.name.startsWith(`${base} `),
    ).length;
    return taken === 0 ? base : `${base} ${taken + 1}`;
  }
}
