/**
 * Runs `fn` and records its duration as a User Timing measure named `name` (visible in DevTools and
 * read by the `@perf` browser benchmark). Falls back to a plain call where User Timing is missing.
 */
export function timed<T>(name: string, fn: () => T): T {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return fn();
  const start = performance.now();
  const value = fn();
  performance.measure(name, { start, end: performance.now() });
  return value;
}
