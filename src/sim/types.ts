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

export type VehicleState = 'idle' | 'driving' | 'loading' | 'lost' | 'servicing';

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
  /** Day the vehicle was bought. */
  builtDay: number;
  /** 0..1 – the lower, the more likely a breakdown. */
  reliability: number;
  lastServiceDay: number;
  /** Ticks left standing still after a breakdown (0 = running). */
  brokenTicks: number;
  breakdowns: number;
  /** On the way to its depot for service. */
  goingToDepot: boolean;
  serviceRequested: boolean;
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
  /** Current monthly production (sources only); changes over time. */
  production: number;
  /** Months in a row with nothing transported. */
  unservedMonths: number;
  /** Months until closing (0 = not closing). */
  closingIn: number;
  closed: boolean;
  /** Temporary production multiplier and months left (booms). */
  boost: number;
  boostMonths: number;
  /** Strike: months left with no production (and a warning month before). */
  strikeMonths: number;
  strikeWarned: boolean;
}

export type NewsKind = 'good' | 'bad' | 'info';

export interface NewsItem {
  day: number;
  text: string;
  kind: NewsKind;
  /** Tile to jump to when the player taps the news, if any. */
  tile?: number;
  /** Small news: kept in the archive but not shown as a headline. */
  quiet?: boolean;
}

/** Temporary world-wide effects from economic events. */
export interface Modifiers {
  payment: number;
  paymentMonths: number;
  running: number;
  runningMonths: number;
  /** Town id -> [passenger multiplier, months left]. */
  festivals: Map<number, number>;
}
