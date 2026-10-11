/** Chart data for the Statistics panel. Pure. */
import type { ResourceType } from '../../sim';

export interface HistorySample {
  tick: number;
  day: number;
  timeOfDay: number;
  stock: Record<ResourceType, number>;
  population: number;
}

export type SeriesKey = ResourceType | 'population';

export interface Series {
  key: SeriesKey;
  values: number[];
  min: number;
  max: number;
  last: number;
  /** Change from the first to the last sample. */
  delta: number;
}

export function seriesFor(history: readonly HistorySample[], key: SeriesKey): Series {
  const values = history.map((h) => (key === 'population' ? h.population : (h.stock[key] ?? 0)));
  const last = values.length ? values[values.length - 1]! : 0;
  return {
    key,
    values,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    last,
    delta: values.length ? last - values[0]! : 0,
  };
}

/** SVG polyline points for a series in a `w`x`h` box. A flat series is drawn at mid height. */
export function sparklinePoints(values: readonly number[], w: number, h: number, pad = 2, floorZero = true): string {
  if (values.length === 0) return '';
  const lo = floorZero ? Math.min(0, ...values) : Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = span === 0 ? h / 2 : pad + (1 - (v - lo) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** "Last 3 days" style caption from the sample count (one sample per in-game hour). */
export function spanLabel(samples: number): string {
  if (samples < 2) return 'Not enough data yet';
  const hours = samples - 1;
  return hours < 24 ? `Last ${hours} h` : `Last ${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)} days`;
}
