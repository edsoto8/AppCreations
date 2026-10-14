/**
 * Clean axis ticks from zero: the smallest step of 1, 2, 2.5 or 5 × 10^k that covers `max` in at
 * most `maxIntervals` steps (e.g. 0 / 5K / 10K / 15K / 20K / 25K), so labels are round numbers.
 */
export function niceTicks(max: number, maxIntervals = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const magnitude = 10 ** Math.floor(Math.log10(max / maxIntervals));
  const steps = [1, 2, 2.5, 5, 10, 20].map((m) => m * magnitude);
  const step = steps.find((s) => Math.ceil(max / s) <= maxIntervals) ?? steps[steps.length - 1];
  const count = Math.ceil(max / step);
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}
