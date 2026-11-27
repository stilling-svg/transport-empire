/**
 * The game world: the generated map plus everything the player builds, and
 * the fixed-step simulation. Pure TypeScript – no DOM, no rendering.
 */
import costs from '../data/costs.json' with { type: 'json' };
import vehicles from '../data/vehicles.json' with { type: 'json' };
import { Occupant, Terrain, WaterKind, type GameMap } from '../mapgen/types.ts';
import { DIRS, RoadOwner, TICKS_PER_DAY } from './constants.ts';
import { buildTownRoads, isStraightRoad, planRoad, type RoadPlan } from './roads.ts';
import { planToTarget, updateBus, type Bus } from './vehicles.ts';

export interface Stop {
  id: number;
  tile: number;
  name: string;
}

export interface Depot {
  id: number;
  tile: number;
}

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
  spent: number;
}

export const MAX_UNDO = 10;

export class World {
  readonly map: GameMap;
  readonly roads: Uint8Array;
  readonly roadOwner: Uint8Array;
  readonly stopAt: Int32Array;
  readonly depotAt: Int32Array;
  readonly stops = new Map<number, Stop>();
  readonly depots = new Map<number, Depot>();
  readonly buses: Bus[] = [];
  tick = 0;
  /** Money spent on construction (there is no budget until milestone 3). */
  spent = 0;
  /** Tiles whose look changed since the renderer last looked. */
  readonly dirty = new Set<number>();
  private undoStack: Snapshot[] = [];
  private nextStopId = 0;
  private nextDepotId = 0;
  private nextBusId = 0;

  constructor(map: GameMap) {
    this.map = map;
    const n = map.width * map.height;
    this.roads = new Uint8Array(n);
    this.roadOwner = new Uint8Array(n);
    this.stopAt = new Int32Array(n).fill(-1);
    this.depotAt = new Int32Array(n).fill(-1);
    buildTownRoads(this);
  }

  /** Days since 1 January 1930. */
  get day(): number {
    return this.tick / TICKS_PER_DAY;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  // -------------------------------------------------------------------------
  // Simulation

  step(): void {
    this.tick++;
    for (const bus of this.buses) updateBus(this, bus);
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
    this.saveUndo();
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
    this.spent += plan.cost;
    return { ok: true, cost: plan.cost };
  }

  /** Removes the player's roads, stops and depots on the given tiles. */
  demolish(tiles: readonly number[]): ActionResult {
    const snapshot = this.snapshot();
    let removed = 0;
    let reason: string | undefined;
    const busTiles = new Set<number>();
    for (const b of this.buses) {
      busTiles.add(b.tile);
      const next = b.path[b.pathIndex + 1];
      if (b.state === 'driving' && next !== undefined) busTiles.add(next);
    }

    for (const i of new Set(tiles)) {
      if (i < 0 || i >= this.roads.length) continue;
      if (busTiles.has(i) && (this.roads[i] !== 0 || this.depotAt[i]! >= 0)) {
        reason ??= 'A bus is in the way';
        continue;
      }
      if (this.depotAt[i]! >= 0) {
        this.depots.delete(this.depotAt[i]!);
        this.depotAt[i] = -1;
        this.clearRoadTile(i);
        removed++;
        continue;
      }
      if (this.stopAt[i]! >= 0) {
        this.stops.delete(this.stopAt[i]!);
        this.stopAt[i] = -1;
        this.dirty.add(i);
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
    for (const bus of this.buses) {
      if (bus.route.some((id) => !this.stops.has(id))) planToTarget(this, bus);
    }
    return { ok: true, cost: 0, reason };
  }

  placeStop(i: number): ActionResult {
    if (i < 0 || i >= this.roads.length) return { ok: false, cost: 0, reason: 'Outside the map' };
    if (this.stopAt[i]! >= 0) return { ok: false, cost: 0, reason: 'There is already a stop here' };
    if (this.roads[i] === 0 || this.depotAt[i]! >= 0) {
      return { ok: false, cost: 0, reason: 'Stops must be placed on a road' };
    }
    if (this.map.water[i] !== WaterKind.None) return { ok: false, cost: 0, reason: 'Not on a bridge' };
    if (!isStraightRoad(this.roads[i]!)) {
      return { ok: false, cost: 0, reason: 'Stops need a straight piece of road' };
    }
    this.saveUndo();
    const id = this.nextStopId++;
    this.stops.set(id, { id, tile: i, name: this.stopName(i) });
    this.stopAt[i] = id;
    this.dirty.add(i);
    this.spent += costs.busStop;
    return { ok: true, cost: costs.busStop };
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
      this.saveUndo();
      this.roads[i] = d.bit;
      this.roads[n] = this.roads[n]! | d.opposite;
      this.roadOwner[i] = RoadOwner.Player;
      // A stop on the neighbour is no longer on a straight road; keep it anyway.
      const id = this.nextDepotId++;
      this.depots.set(id, { id, tile: i });
      this.depotAt[i] = id;
      map.terrain[i] = Terrain.Grass;
      this.dirty.add(i);
      this.dirty.add(n);
      this.spent += costs.depot;
      return { ok: true, cost: costs.depot };
    }
    return { ok: false, cost: 0, reason: 'Depots must be next to a road' };
  }

  buyBus(depotId: number): Bus | null {
    const depot = this.depots.get(depotId);
    if (!depot) return null;
    const id = this.nextBusId++;
    const bus: Bus = {
      id,
      name: `${vehicles.bus.name} ${id + 1}`,
      depotId,
      route: [],
      routeIndex: 0,
      state: 'idle',
      tile: depot.tile,
      path: [depot.tile],
      pathIndex: 0,
      progress: 0,
      waitTicks: 0,
      arrivals: 0,
      lastStopId: -1,
    };
    this.buses.push(bus);
    this.spent += vehicles.bus.price;
    return bus;
  }

  /** Gives a bus its stops (in order) and sends it on its way. */
  setRoute(busId: number, stopIds: readonly number[]): ActionResult {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return { ok: false, cost: 0, reason: 'No such bus' };
    const route = stopIds.filter((id) => this.stops.has(id));
    if (route.length < 2) return { ok: false, cost: 0, reason: 'Choose at least two stops' };
    bus.route = [...route];
    bus.routeIndex = 0;
    planToTarget(this, bus);
    return { ok: true, cost: 0 };
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
    this.stops.clear();
    for (const st of s.stops) this.stops.set(st.id, { ...st });
    this.depots.clear();
    for (const d of s.depots) this.depots.set(d.id, { ...d });
    this.spent = s.spent;
    // Buses left without a road under them are removed; the rest re-plan.
    for (let k = this.buses.length - 1; k >= 0; k--) {
      const bus = this.buses[k]!;
      if (this.roads[bus.tile] === 0) this.buses.splice(k, 1);
      else if (bus.state !== 'idle') planToTarget(this, bus);
    }
    return true;
  }

  private snapshot(): Snapshot {
    return {
      roads: this.roads.slice(),
      roadOwner: this.roadOwner.slice(),
      terrain: this.map.terrain.slice(),
      stopAt: this.stopAt.slice(),
      depotAt: this.depotAt.slice(),
      stops: [...this.stops.values()].map((s) => ({ ...s })),
      depots: [...this.depots.values()].map((d) => ({ ...d })),
      spent: this.spent,
    };
  }

  private pushUndo(s: Snapshot): void {
    this.undoStack.push(s);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private saveUndo(): void {
    this.pushUndo(this.snapshot());
  }

  // -------------------------------------------------------------------------
  // Helpers

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
      if (this.roads[n] === 0 && this.stopAt[n]! >= 0) {
        this.stops.delete(this.stopAt[n]!);
        this.stopAt[n] = -1;
      }
      this.dirty.add(n);
    }
    this.roads[i] = 0;
    this.roadOwner[i] = RoadOwner.None;
    this.dirty.add(i);
  }

  private stopName(i: number): string {
    const { width } = this.map;
    const x = i % width;
    const y = (i - x) / width;
    let best: { name: string; d: number } | null = null;
    for (const t of this.map.towns) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= 16 && (!best || d < best.d)) best = { name: t.name, d };
    }
    const base = best ? best.name : 'Countryside';
    const taken = [...this.stops.values()].filter((s) => s.name.startsWith(base)).length;
    return taken === 0 ? base : `${base} ${taken + 1}`;
  }
}
