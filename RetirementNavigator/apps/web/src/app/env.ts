/**
 * The current calendar year, read once from the clock in the UI layer and injected into the engine
 * (the engine never reads the clock). Overridable in tests and E2E via `?year=` for reproducibility.
 */
function readYear(): number {
  try {
    const param = new URLSearchParams(window.location.search).get('year');
    const parsed = param ? Number(param) : NaN;
    if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
  } catch {
    // ignore
  }
  return new Date().getFullYear();
}

export const CURRENT_YEAR = readYear();
