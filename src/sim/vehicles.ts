/**
 * Road vehicle behaviour: drive to the next stop in the orders, unload and
 * load there, repeat. Vehicles queue behind each other in their lane and wait
 * when the stop they are heading for is full.
 */
import economy from '../data/economy.json' with { type: 'json' };
import vehicleData from '../data/vehicles.json' with { type: 'json' };
import type { CargoId } from './cargo.ts';
import { TICKS_PER_DAY, dirBetween } from './constants.ts';
import { loadMore, unloadAndLoad } from './economy.ts';
import { findRoadPath } from './pathfinding.ts';
import type { ModelId, Vehicle } from './types.ts';
import type { World } from './world.ts';

export interface ModelInfo {
  name: string;
  speedKmh: number;
  capacity: number;
  price: number;
  runningCost: number;
  cargo: CargoId[];
  stop: 'bus' | 'truck';
}

export const MODELS = vehicleData.models as Record<ModelId, ModelInfo>;

export function tilesPerDay(model: ModelId): number {
  return MODELS[model].speedKmh * vehicleData.kmhToTilesPerDay;
}

const LOADING_TICKS = vehicleData.loadingDays * TICKS_PER_DAY;
const RETRY_TICKS = vehicleData.lostRetryDays * TICKS_PER_DAY;
/** Minimum distance (in tiles) between two vehicles in the same lane. */
export const VEHICLE_GAP = 0.5;

function linked(world: World, a: number, b: number): boolean {
  const w = world.map.width;
  const d = dirBetween(w, a, b);
  const back = dirBetween(w, b, a);
  return d !== 0 && (world.roads[a]! & d) !== 0 && (world.roads[b]! & back) !== 0;
}

function targetStop(world: World, v: Vehicle) {
  const order = v.orders[v.orderIndex];
  return order ? world.stops.get(order.stopId) : undefined;
}

/** Plans a path to the stop the vehicle is heading for. */
export function planToTarget(world: World, v: Vehicle): void {
  v.orders = v.orders.filter((o) => world.stops.has(o.stopId));
  if (v.orders.length < 2) {
    v.state = 'idle';
    v.path = [v.tile];
    v.pathIndex = 0;
    v.progress = 0;
    return;
  }
  v.orderIndex %= v.orders.length;
  const stop = targetStop(world, v)!;
  const path = findRoadPath(world.roads, world.map.width, world.map.height, v.tile, stop.tile);
  v.progress = 0;
  v.pathIndex = 0;
  if (!path) {
    v.state = 'lost';
    v.path = [v.tile];
    v.waitTicks = RETRY_TICKS;
    return;
  }
  v.path = path;
  if (path.length === 1) {
    if (world.loadersAt(stop.id) < economy.maxLoadersPerStop) arrive(world, v);
    else {
      // Already at the stop but it is full: try again shortly.
      v.state = 'lost';
      v.waitTicks = TICKS_PER_DAY / 2;
    }
  } else v.state = 'driving';
}

function arrive(world: World, v: Vehicle): void {
  const stop = targetStop(world, v)!;
  v.state = 'loading';
  v.loadingAt = stop.id;
  v.waitTicks = LOADING_TICKS;
  v.arrivals++;
  v.lastStopId = stop.id;
  v.progress = 0;
  unloadAndLoad(world, v, stop);
}

function depart(world: World, v: Vehicle): void {
  v.loadingAt = -1;
  v.orderIndex = (v.orderIndex + 1) % Math.max(1, v.orders.length);
  planToTarget(world, v);
}

/** A vehicle in a lane: its progress along the edge and its id (to break ties). */
type LaneEntry = { progress: number; id: number };

/** Lane occupancy for one tick: key = tile * 16 + direction bit -> vehicles on that edge. */
export type Occupancy = Map<number, LaneEntry[]>;

export function buildOccupancy(world: World): Occupancy {
  const occ: Occupancy = new Map();
  const w = world.map.width;
  for (const v of world.vehicles) {
    if (v.state !== 'driving') continue;
    const next = v.path[v.pathIndex + 1];
    if (next === undefined) continue;
    const key = v.tile * 16 + dirBetween(w, v.tile, next);
    const entry = { progress: v.progress, id: v.id };
    const list = occ.get(key);
    if (list) list.push(entry);
    else occ.set(key, [entry]);
  }
  return occ;
}

/** How far (in tiles) the vehicle may move before reaching the vehicle in front of it. */
function roomAhead(world: World, occ: Occupancy, v: Vehicle): number {
  const w = world.map.width;
  const a = v.tile;
  const b = v.path[v.pathIndex + 1]!;
  let room = Infinity;
  for (const q of occ.get(a * 16 + dirBetween(w, a, b)) ?? []) {
    // Vehicles side by side (e.g. leaving a depot together) queue up by id.
    const ahead = q.progress > v.progress || (q.progress === v.progress && q.id < v.id);
    if (ahead) room = Math.min(room, q.progress - v.progress);
  }
  // Vehicles that have already moved on from the next tile (not coming back towards us).
  const bx = b % w;
  const by = (b - bx) / w;
  for (const bit of [1, 2, 4, 8]) {
    const dx = bit === 2 ? 1 : bit === 8 ? -1 : 0;
    const dy = bit === 4 ? 1 : bit === 1 ? -1 : 0;
    const c = (by + dy) * w + (bx + dx);
    if (c === a) continue;
    for (const q of occ.get(b * 16 + bit) ?? []) room = Math.min(room, 1 - v.progress + q.progress);
  }
  return room - VEHICLE_GAP;
}

/** Advances one vehicle by one simulation tick. */
export function updateVehicle(world: World, v: Vehicle, occ: Occupancy): void {
  switch (v.state) {
    case 'idle':
      return;
    case 'loading': {
      if (--v.waitTicks > 0) return;
      const order = v.orders[v.orderIndex];
      const stop = targetStop(world, v);
      if (order && stop && order.fullLoad && v.load < v.capacity) {
        loadMore(world, v, stop);
        if (v.load < v.capacity) {
          v.waitTicks = TICKS_PER_DAY; // check again tomorrow
          return;
        }
      }
      depart(world, v);
      return;
    }
    case 'lost':
      if (--v.waitTicks <= 0) planToTarget(world, v);
      return;
    case 'driving': {
      const next = v.path[v.pathIndex + 1];
      if (next === undefined || !linked(world, v.tile, next)) {
        planToTarget(world, v);
        return;
      }
      let step = tilesPerDay(v.model) / TICKS_PER_DAY;
      step = Math.min(step, roomAhead(world, occ, v));
      // Wait in front of a full stop.
      const stop = targetStop(world, v);
      const lastEdge = v.pathIndex === v.path.length - 2;
      if (stop && lastEdge && world.loadersAt(stop.id) >= economy.maxLoadersPerStop) {
        step = Math.min(step, 1 - VEHICLE_GAP - v.progress);
      }
      if (step <= 0) return;
      v.progress += step;
      while (v.progress >= 1) {
        v.progress -= 1;
        v.pathIndex++;
        v.tile = v.path[v.pathIndex]!;
        if (v.pathIndex >= v.path.length - 1) {
          arrive(world, v);
          return;
        }
        const after = v.path[v.pathIndex + 1]!;
        if (!linked(world, v.tile, after)) {
          planToTarget(world, v);
          return;
        }
      }
      return;
    }
  }
}
