/**
 * Categorical series colours for charts with many strategies (scenario comparison).
 *
 * Slots 1–5 are the app's validated `--chart-1..5` tokens. Slots 6–8 extend them with the
 * dataviz reference palette's green, blue and red, stepped per mode. The full 8-slot order was run
 * through the dataviz validator against the card surface in both modes:
 *   light (#ffffff): band/chroma PASS, worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6,
 *                    contrast WARN on slots 3–5 (relief: legend + table view always present)
 *   dark  (#18181b): all checks PASS, worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3
 * Colour follows the entity (assigned by the row's position in the server's stable order), never
 * its rank, and a 9th series is never generated — callers fold extra series out of the chart.
 *
 * The baseline is always the neutral de-emphasis ink, drawn dashed, so it reads as "reference".
 */

export const BASELINE_SERIES_COLOR = 'var(--muted-foreground)';

/** CSS variables for slots 6–8, light and dark. Render <SeriesPaletteStyle /> once near the chart. */
const EXTRA_SLOTS = {
  light: ['#008300', '#2a78d6', '#e34948'],
  dark: ['#008300', '#3987e5', '#e66767'],
} as const;

export const CATEGORICAL_SERIES: readonly string[] = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

export const MAX_CATEGORICAL_SERIES = CATEGORICAL_SERIES.length;

const css = `
:root{${EXTRA_SLOTS.light.map((c, i) => `--series-${i + 6}:${c};`).join('')}}
.dark{${EXTRA_SLOTS.dark.map((c, i) => `--series-${i + 6}:${c};`).join('')}}
`;

/** Defines --series-6..8 for both themes (idempotent; duplicates are harmless). */
export function SeriesPaletteStyle() {
  return <style>{css}</style>;
}

/** Colour for the n-th non-baseline series (0-based), or null once the palette is exhausted. */
export function categoricalColor(index: number): string | null {
  return index >= 0 && index < CATEGORICAL_SERIES.length ? CATEGORICAL_SERIES[index] : null;
}

/** Legend/tooltip swatch: a short line, dashed for the baseline, a rect for filled marks. */
export function SeriesSwatch({ color, dashed = false, shape = 'line' }: { color: string; dashed?: boolean; shape?: 'line' | 'rect' }) {
  if (shape === 'rect') {
    return <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />;
  }
  return (
    <svg aria-hidden width="16" height="4" viewBox="0 0 16 4" className="shrink-0 overflow-visible">
      <line
        x1="1"
        y1="2"
        x2="15"
        y2="2"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dashed ? '3 3' : undefined}
      />
    </svg>
  );
}
