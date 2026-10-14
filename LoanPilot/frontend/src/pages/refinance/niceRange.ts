/**
 * Round axis ticks for a value range that should not start at zero (e.g. two cost lines that sit
 * between $21K and $24K): the smallest 1/2/2.5/5 × 10^k step that covers [min, max] in at most
 * `maxIntervals` steps, with both ends snapped outward to that step.
 */
export function niceRangeTicks(min: number, max: number, maxIntervals = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max < min) [min, max] = [max, min];
  if (max === min) {
    const pad = Math.max(1, Math.abs(max) * 0.05);
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const magnitude = 10 ** Math.floor(Math.log10(span / maxIntervals));
  const steps = [1, 2, 2.5, 5, 10, 20, 25, 50].map((m) => m * magnitude);
  for (const step of steps) {
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    if (Math.round((hi - lo) / step) <= maxIntervals) {
      const count = Math.round((hi - lo) / step);
      return Array.from({ length: count + 1 }, (_, i) => Number((lo + i * step).toPrecision(12)));
    }
  }
  return [min, max];
}
