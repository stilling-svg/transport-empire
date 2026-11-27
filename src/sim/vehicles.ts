/** Bus behaviour: drive the route stop by stop, wait at each stop, repeat. */
import vehicles from '../data/vehicles.json' with { type: 'json' };
import { TICKS_PER_DAY, dirBetween } from './constants.ts';
import { findRoadPath } from './pathfinding.ts';

export type BusState = 'idle' | 'driving' | 'loading' | 'lost';

export interface Bus {
  id: number;
  name: string;
  depotId: number;
  /** Stop ids in driving order. The bus loops through them. */
  route: number[];
  /** Index into `route` of the stop the bus is heading for (or waiting at). */
  routeIndex: number;
  state: BusState;
  /** Current tile index. */
  tile: number;
  /** Planned tiles from the current tile to the target stop. */
  path: number[];
  pathIndex: number;
  /** 0..1 progress from path[pathIndex] towards path[pathIndex + 1]. */
  progress: number;
  /** Ticks left of loading or before retrying a lost route. */
  waitTicks: number;
  /** Number of stop arrivals so far (handy for tests and statistics). */
  arrivals: number;
  lastStopId: number;
}

/** What the bus logic needs from the world. */
export interface BusWorld {
  roads: Uint8Array;
  map: { width: number; height: number };
  stops: Map<number, { id: number; tile: number }>;
}

export const BUS_TILES_PER_DAY = vehicles.bus.speedKmh * vehicles.kmhToTilesPerDay;
const STEP = BUS_TILES_PER_DAY / TICKS_PER_DAY;
const LOADING_TICKS = vehicles.loadingDays * TICKS_PER_DAY;
const RETRY_TICKS = vehicles.lostRetryDays * TICKS_PER_DAY;

function linked(world: BusWorld, a: number, b: number): boolean {
  const w = world.map.width;
  const d = dirBetween(w, a, b);
  const back = dirBetween(w, b, a);
  return d !== 0 && (world.roads[a]! & d) !== 0 && (world.roads[b]! & back) !== 0;
}

/** Plans a path to the stop the bus is heading for. */
export function planToTarget(world: BusWorld, bus: Bus): void {
  bus.route = bus.route.filter((id) => world.stops.has(id));
  if (bus.route.length < 2) {
    bus.state = 'idle';
    bus.path = [bus.tile];
    bus.pathIndex = 0;
    bus.progress = 0;
    return;
  }
  bus.routeIndex %= bus.route.length;
  const stop = world.stops.get(bus.route[bus.routeIndex]!)!;
  const path = findRoadPath(world.roads, world.map.width, world.map.height, bus.tile, stop.tile);
  bus.progress = 0;
  bus.pathIndex = 0;
  if (!path) {
    bus.state = 'lost';
    bus.path = [bus.tile];
    bus.waitTicks = RETRY_TICKS;
    return;
  }
  bus.path = path;
  if (path.length === 1) arrive(bus, stop.id);
  else bus.state = 'driving';
}

function arrive(bus: Bus, stopId: number): void {
  bus.state = 'loading';
  bus.waitTicks = LOADING_TICKS;
  bus.arrivals++;
  bus.lastStopId = stopId;
  bus.progress = 0;
}

/** Advances one bus by one simulation tick. */
export function updateBus(world: BusWorld, bus: Bus): void {
  switch (bus.state) {
    case 'idle':
      return;
    case 'loading':
      if (--bus.waitTicks <= 0) {
        bus.routeIndex = (bus.routeIndex + 1) % Math.max(1, bus.route.length);
        planToTarget(world, bus);
      }
      return;
    case 'lost':
      if (--bus.waitTicks <= 0) planToTarget(world, bus);
      return;
    case 'driving': {
      const next = bus.path[bus.pathIndex + 1];
      if (next === undefined || !linked(world, bus.tile, next)) {
        planToTarget(world, bus);
        return;
      }
      bus.progress += STEP;
      while (bus.progress >= 1) {
        bus.progress -= 1;
        bus.pathIndex++;
        bus.tile = bus.path[bus.pathIndex]!;
        if (bus.pathIndex >= bus.path.length - 1) {
          arrive(bus, bus.route[bus.routeIndex] ?? -1);
          return;
        }
        const after = bus.path[bus.pathIndex + 1]!;
        if (!linked(world, bus.tile, after)) {
          planToTarget(world, bus);
          return;
        }
      }
      return;
    }
  }
}
