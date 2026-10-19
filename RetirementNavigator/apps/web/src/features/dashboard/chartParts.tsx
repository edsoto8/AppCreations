/** Shared chart pieces: HTML legend (text in text tokens, line style as a second channel), tooltip shell, markers. */
import { formatCents } from '@/lib/format';
import { DASH, type LineStyle } from './chartUtils';

export interface LegendItem {
  label: string;
  color: string;
  style: LineStyle;
}

/** Legend in HTML so it wraps at phone width; the swatch repeats the line pattern. */
export function SeriesLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="22" height="10" viewBox="0 0 22 10" className="shrink-0">
            {item.style === 'area' ? (
              <rect x="1" y="1" width="20" height="8" rx="2" fill={item.color} fillOpacity={0.3} stroke={item.color} />
            ) : (
              <line
                x1="1"
                y1="5"
                x2="21"
                y2="5"
                stroke={item.color}
                strokeWidth={2}
                strokeDasharray={DASH[item.style]}
                strokeLinecap="round"
              />
            )}
          </svg>
          <span className="text-foreground">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tooltip card: a heading and label/value rows. */
export function TooltipCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: { label: string; value: number; color?: string; strong?: boolean }[];
}) {
  return (
    <div className="min-w-48 rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="font-semibold">{title}</p>
      {subtitle ? <p className="mb-1.5 text-muted-foreground">{subtitle}</p> : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              {r.color ? (
                <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: r.color }} />
              ) : null}
              {r.label}
            </dt>
            <dd className={r.strong ? 'text-right font-semibold' : 'text-right'}>{formatCents(r.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
