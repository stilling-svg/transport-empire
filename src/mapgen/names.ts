import type { Rng } from './rng.ts';

const PREFIXES = [
  'Ash', 'Bar', 'Bel', 'Black', 'Bram', 'Bright', 'Brook', 'Cal', 'Cold', 'Crane',
  'Dun', 'East', 'Elm', 'Fair', 'Fern', 'Glen', 'Grey', 'Hart', 'Hazel', 'High',
  'Holm', 'Iron', 'Kings', 'Lark', 'Linden', 'Long', 'Marl', 'Mill', 'Moss', 'North',
  'Oak', 'Pen', 'Red', 'Ridge', 'Rose', 'Rush', 'Salt', 'Silver', 'South', 'Stan',
  'Stone', 'Thorn', 'West', 'White', 'Wil', 'Wind', 'Wolf', 'Wood', 'Wren', 'Yarrow',
];

const SUFFIXES = [
  'bury', 'by', 'combe', 'dale', 'den', 'field', 'ford', 'gate', 'ham', 'haven',
  'hill', 'holt', 'hurst', 'ley', 'mere', 'minster', 'mouth', 'port', 'stead', 'stow',
  'thorpe', 'ton', 'wick', 'worth',
];

/** Generates a list of unique fictional town names. */
export function generateTownNames(rng: Rng, count: number): string[] {
  const names = new Set<string>();
  let guard = 0;
  while (names.size < count && guard < count * 200) {
    guard++;
    names.add(rng.pick(PREFIXES) + rng.pick(SUFFIXES));
  }
  // Extremely unlikely fallback: number the rest.
  let n = 1;
  while (names.size < count) names.add(`Newtown ${n++}`);
  return [...names];
}
