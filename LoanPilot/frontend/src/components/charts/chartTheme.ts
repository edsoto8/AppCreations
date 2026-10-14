/**
 * Shared Recharts styling, following the dataviz method:
 * hairline solid grid/axes one step off the surface, muted tick text (never series colour),
 * 2px lines, ~10% area washes, >= 8px active dots with a 2px surface ring, 2px surface gaps
 * between touching bar segments. Colours are CSS variables so light/dark swap automatically.
 */
export const SERIES = {
  principal: 'var(--chart-1)',
  balance: 'var(--chart-1)',
  interest: 'var(--chart-2)',
  extra: 'var(--chart-3)',
} as const;

export const SURFACE = 'var(--card)';

export const gridProps = {
  stroke: 'var(--chart-grid)',
  strokeWidth: 1,
  vertical: false,
} as const;

export const axisTick = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;

export const xAxisProps = {
  tick: axisTick,
  tickLine: false,
  axisLine: { stroke: 'var(--chart-axis)' },
  tickMargin: 8,
  minTickGap: 28,
} as const;

export const yAxisProps = {
  tick: axisTick,
  tickLine: false,
  axisLine: false,
  tickMargin: 6,
  width: 56,
} as const;

export const lineCursor = { stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeOpacity: 0.5 } as const;
export const barCursor = { fill: 'var(--muted)', fillOpacity: 0.6 } as const;

export const activeDot = { r: 4, strokeWidth: 2, stroke: SURFACE } as const;
