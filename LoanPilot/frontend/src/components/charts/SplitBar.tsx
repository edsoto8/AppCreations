import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface SplitSegment {
  key: string;
  label: string;
  value: number;
  /** Pre-formatted value for labels and tooltips. */
  display: string;
  color: string;
}

/**
 * Part-to-whole as one horizontal stacked bar (preferred over a 2-slice donut).
 * Segments are separated by a 2px surface gap; a legend with values sits below,
 * so nothing depends on hovering or on colour alone.
 */
export function SplitBar({ segments, className, height = 'h-3' }: { segments: SplitSegment[]; className?: string; height?: string }) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const share = (v: number) => (total > 0 ? (Math.max(0, v) / total) * 100 : 0);
  return (
    <div className={cn('grid gap-3', className)}>
      <div className={cn('flex w-full gap-[2px] overflow-hidden rounded-[4px]', height)} role="img" aria-label={segments.map((s) => `${s.label} ${s.display}`).join(', ')}>
        {segments.map((s) =>
          share(s.value) > 0 ? (
            <Tooltip key={s.key}>
              <TooltipTrigger asChild>
                <div
                  className="h-full transition-[filter] first:rounded-l-[4px] last:rounded-r-[4px] hover:brightness-110"
                  style={{ width: `${share(s.value)}%`, backgroundColor: s.color, minWidth: 2 }}
                />
              </TooltipTrigger>
              <TooltipContent>
                {s.label}: {s.display} ({share(s.value).toFixed(1)}%)
              </TooltipContent>
            </Tooltip>
          ) : null,
        )}
      </div>
      <dl className="grid gap-2">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
            <dt className="text-muted-foreground">{s.label}</dt>
            <dd className="ml-auto font-medium">
              {s.display}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{share(s.value).toFixed(1)}%</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
