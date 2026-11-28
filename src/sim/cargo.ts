/** Cargo types and the delivery payment formula (GDD 4.1 and 6.1). */
import cargoData from '../data/cargo.json' with { type: 'json' };
import economy from '../data/economy.json' with { type: 'json' };

export type CargoId = 'passengers' | 'mail' | 'food' | 'coal' | 'grain' | 'wood' | 'planks';
export type StopKind = 'bus' | 'truck';
export type Sensitivity = 'high' | 'medium' | 'low';

export interface CargoInfo {
  name: string;
  unit: string;
  baseRate: number;
  fastDays: number;
  sensitivity: Sensitivity;
  stop: StopKind;
  color: string;
}

export const CARGO_IDS = Object.keys(cargoData) as CargoId[];

export function cargoInfo(id: CargoId): CargoInfo {
  return (cargoData as Record<CargoId, CargoInfo>)[id];
}

/** Cargo that towns produce or accept. */
export const TOWN_ACCEPTS: readonly CargoId[] = ['passengers', 'mail', 'food', 'planks'];

/**
 * 1.0 up to the cargo's "fast" limit, then falling in a straight line to the
 * floor (0.25) at 3x / 4.5x / 6x the limit depending on how perishable it is.
 */
export function timeFactor(cargo: CargoId, days: number): number {
  const info = cargoInfo(cargo);
  if (days <= info.fastDays) return 1;
  const slowAt = info.fastDays * economy.slowdownFactor[info.sensitivity];
  const t = (days - info.fastDays) / (slowAt - info.fastDays);
  return Math.max(economy.minTimeFactor, 1 - t * (1 - economy.minTimeFactor));
}

/** Money paid for delivering `amount` of `cargo` over `distance` tiles after `days` in transit. */
export function deliveryPayment(cargo: CargoId, amount: number, distance: number, days: number): number {
  const info = cargoInfo(cargo);
  return Math.round(
    info.baseRate *
      amount *
      distance *
      timeFactor(cargo, days) *
      economy.paymentScale *
      economy.difficultyPaymentMultiplier,
  );
}
