import type { ReactNode } from 'react';

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color?: string;
  /** Rows without a key line (e.g. totals) render as a muted summary. */
  emphasis?: 'total';
}

/** Tooltip card: header, then rows where the value leads and a short line key carries identity. */
export function ChartTooltipCard({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="num min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-medium text-muted-foreground">{title}</div>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div
            key={row.key}
            className={row.emphasis === 'total' ? 'mt-0.5 flex items-center gap-2 border-t pt-1.5' : 'flex items-center gap-2'}
          >
            {row.color ? (
              <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            ) : (
              <span aria-hidden className="w-3 shrink-0" />
            )}
            <span className="font-semibold text-foreground">{row.value}</span>
            <span className="ml-auto pl-3 text-muted-foreground">{row.label}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Legend item: the swatch mirrors the mark (rect for bars/areas, line for lines). Text stays in text tokens. */
export function LegendItem({ color, label, shape = 'rect' }: { color: string; label: ReactNode; shape?: 'rect' | 'line' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={shape === 'line' ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-[3px]'}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
