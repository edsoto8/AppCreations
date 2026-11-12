/** Pure formatting helpers for the dashboard (no DOM, unit-testable). */

/** Seconds → "mm:ss" (or "h:mm:ss" past an hour). Negative / non-finite → "--:--". */
export function fmtClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const tail = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return h > 0 ? `${h}:${tail}` : tail;
}

/** Fraction 0..1 → "42%". */
export function fmtPct(frac: number, digits = 0): string {
  if (!Number.isFinite(frac)) return '—';
  return `${(clamp01(frac) * 100).toFixed(digits)}%`;
}

/** Fixed-digit number with an optional unit; "—" for non-finite values. */
export function fmtNum(v: number, digits = 1, unit = ''): string {
  if (!Number.isFinite(v)) return '—';
  return unit ? `${v.toFixed(digits)} ${unit}` : v.toFixed(digits);
}

/** Distance in meters with a sensible unit. */
export function fmtDist(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(m < 10 ? 2 : 1)} m`;
}

/** Large integer counts as "12.3k" / "1.2M". */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Sensor distance (Infinity = nothing in range). */
export function fmtRange(m: number): string {
  if (!Number.isFinite(m)) return 'clear';
  return `${(m * 100).toFixed(0)} cm`;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** camelCase / snake → "Title case words". */
export function humanize(s: string): string {
  if (!s) return '';
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Battery severity for colouring. */
export function batteryLevel(soc: number): 'ok' | 'warn' | 'error' {
  if (soc <= 0.12) return 'error';
  if (soc <= 0.25) return 'warn';
  return 'ok';
}

/** Degrees from radians, normalised to (-180, 180]. */
export function toDeg(rad: number): number {
  let d = (rad * 180) / Math.PI;
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** Differential-drive inverse kinematics: wheel speeds from body (v, ω) and wheel base L. */
export function wheelSpeeds(v: number, w: number, wheelBase: number): { left: number; right: number } {
  return { left: v - (w * wheelBase) / 2, right: v + (w * wheelBase) / 2 };
}

/**
 * Manual-drive axes from the set of pressed keys (robot-centric: left = counter-clockwise = +turn,
 * matching the simulation's positive ω).
 */
export function manualAxes(keys: ReadonlySet<string>): { forward: number; turn: number } {
  const has = (...k: string[]) => k.some((x) => keys.has(x));
  const forward = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0);
  const turn = (has('a', 'arrowleft') ? 1 : 0) - (has('d', 'arrowright') ? 1 : 0);
  return { forward, turn };
}

/** True when a keyboard event target is a text-entry control (shortcuts must be ignored). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type);
  }
  return node.isContentEditable === true;
}
