/** Chart helpers (no components exported): line dashes, axis ticks, forecast markers and their labels. */
import type { Household, ProjectionResult } from '@rn/engine';

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'area';

export const DASH: Record<LineStyle, string | undefined> = {
  solid: undefined,
  area: undefined,
  dashed: '6 4',
  dotted: '2 3',
};

export interface Marker {
  year: number;
  /** Short in-chart label. */
  label: string;
  /** Full wording for the text list under the chart. */
  description: string;
}

/** Retirement, first death (couples) and depletion markers from the baseline summary. */
export function forecastMarkers(result: ProjectionResult, household: Household): Marker[] {
  const s = result.summary;
  const markers: Marker[] = [];
  if (s.retirementYear > s.firstYear)
    markers.push({ year: s.retirementYear, label: 'Retirement', description: 'retirement' });
  if (household.people.length > 1 && s.firstDeathYear !== null && s.firstDeathYear <= s.lastYear) {
    markers.push({
      year: s.firstDeathYear,
      label: 'First death',
      description: 'first death (the first planning age is passed)',
    });
  }
  if (s.depletionYear !== null)
    markers.push({ year: s.depletionYear, label: 'Runs out', description: 'the portfolio runs out' });
  return markers;
}

/**
 * Label renderer for a vertical reference line: text sits beside the line (right of it in the
 * first half of the range, left of it in the second) and each marker gets its own row.
 */
export function markerLabel(text: string, row: number, flip: boolean) {
  return function MarkerLabel(props: { viewBox?: unknown }) {
    const box = props.viewBox as { x?: number; y?: number } | undefined;
    const x = (box?.x ?? 0) + (flip ? -4 : 4);
    const y = (box?.y ?? 0) + 12 + row * 14;
    return (
      <text x={x} y={y} textAnchor={flip ? 'end' : 'start'} fontSize={11} fill="var(--foreground)">
        {text}
      </text>
    );
  };
}

export const AXIS_TICK = { fill: 'var(--chart-axis)', fontSize: 11 } as const;
