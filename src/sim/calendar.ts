/** Game calendar: day 0 is 1 January 1930. */

const START = Date.UTC(1930, 0, 1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dateOf(day: number): { year: number; month: number; date: number } {
  const d = new Date(START + Math.floor(day) * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
}

/** Months since January 1930. */
export function monthIndex(day: number): number {
  const { year, month } = dateOf(day);
  return (year - 1930) * 12 + month;
}

/** "1 Jan 1930". */
export function formatDate(day: number): string {
  const { year, month, date } = dateOf(day);
  return `${date} ${MONTHS[month]} ${year}`;
}

export function monthName(index: number): string {
  return `${MONTHS[((index % 12) + 12) % 12]} ${1930 + Math.floor(index / 12)}`;
}
