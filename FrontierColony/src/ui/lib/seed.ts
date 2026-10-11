/** Friendly random seeds for the New Game form: "amber-ridge-42". */
const ADJECTIVES = [
  'amber', 'quiet', 'wild', 'golden', 'misty', 'hollow', 'broken', 'silver', 'lonely', 'verdant',
  'rugged', 'sunlit', 'windy', 'hidden', 'ancient', 'bright', 'stormy', 'gentle', 'crimson', 'frosty',
] as const;
const NOUNS = [
  'ridge', 'harbor', 'meadow', 'creek', 'pine', 'bluff', 'hollow', 'ford', 'crest', 'glen',
  'marsh', 'summit', 'orchard', 'cove', 'timber', 'prairie', 'canyon', 'bay', 'grove', 'vale',
] as const;

/** `random` returns [0, 1); injectable so tests are deterministic. */
export function randomSeed(random: () => number = Math.random): string {
  const pick = <T,>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  const n = Math.min(99, Math.floor(random() * 100));
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}
