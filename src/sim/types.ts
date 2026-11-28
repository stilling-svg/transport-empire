/** Plain data types for things the player builds and runs. */
import type { CargoId, StopKind } from './cargo.ts';

export type { CargoId, StopKind };

export interface Stop {
  id: number;
  tile: number;
  name: string;
  kind: StopKind;
  /** Cargo waiting to be picked up. */
  waiting: Partial<Record<CargoId, number>>;
  /** Industries (ids) and towns (ids) inside the catchment area. */
  industries: number[];
  towns: number[];
}

export interface Depot {
  id: number;
  tile: number;
}

export type ModelId = 'bus' | 'van' | 'truck';

export interface Order {
  stopId: number;
  /** Wait at this stop until the vehicle is full. */
  fullLoad: boolean;
}

export type VehicleState = 'idle' | 'driving' | 'loading' | 'lost';

export interface Vehicle {
  id: number;
  name: string;
  model: ModelId;
  cargo: CargoId;
  capacity: number;
  depotId: number;
  orders: Order[];
  /** Index into `orders` of the stop the vehicle is heading for (or loading at). */
  orderIndex: number;
  state: VehicleState;
  /** Current tile index. */
  tile: number;
  /** Planned tiles from the current tile to the target stop. */
  path: number[];
  pathIndex: number;
  /** 0..1 progress from path[pathIndex] towards path[pathIndex + 1]. */
  progress: number;
  /** Ticks left of loading or before retrying a lost route. */
  waitTicks: number;
  /** Stop the vehicle is loading at, or -1. */
  loadingAt: number;
  arrivals: number;
  lastStopId: number;
  /** Cargo on board, where it was loaded (tile) and when (tick). */
  load: number;
  loadFrom: number;
  loadTick: number;
  price: number;
  profitThisYear: number;
  profitLastYear: number;
}

/** Runtime numbers for an industry. */
export interface IndustryStats {
  /** Input waiting to be processed (food factory, sawmill). */
  stock: number;
  /** Fractional production carried over between days. */
  carry: number;
  producedThisMonth: number;
  transportedThisMonth: number;
  producedLastMonth: number;
  transportedLastMonth: number;
}
