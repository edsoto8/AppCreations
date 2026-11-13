/** Score formatting helpers (for places where a string is needed; renderers use drawNumber). */

/** Zero-pads a non-negative integer to `digits` characters, clamping to the largest that fits. */
export function formatScore(score: number, digits = 6): string {
  const max = Math.pow(10, digits) - 1;
  const value = Math.min(max, Math.max(0, Math.floor(score)));
  return value.toString().padStart(digits, '0');
}

/** Clamps a score to what a fixed-width counter of `digits` digits can display. */
export function clampScore(score: number, digits = 6): number {
  return Math.min(Math.pow(10, digits) - 1, Math.max(0, Math.floor(score)));
}
