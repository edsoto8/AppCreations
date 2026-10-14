import { useState } from 'react';
import { AlertTriangleIcon, ChevronDownIcon, LightbulbIcon, SparklesIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Insight, InsightTone } from '@/api/types';
import { formatMetric } from '@/lib/format';
import { cn } from '@/lib/utils';

const toneStyle: Record<InsightTone, { Icon: typeof SparklesIcon; className: string; label: string }> = {
  positive: { Icon: SparklesIcon, className: 'bg-positive/10 text-positive', label: 'Good news' },
  neutral: { Icon: LightbulbIcon, className: 'bg-primary/10 text-primary', label: 'Insight' },
  warning: { Icon: AlertTriangleIcon, className: 'bg-warning/10 text-warning', label: 'Watch out' },
};

/** Rule-based insight with an expandable "How this was calculated" explanation. */
export function InsightCard({ insight, currency, className }: { insight: Insight; currency: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { Icon, className: toneClass, label } = toneStyle[insight.tone];
  return (
    <Card className={cn('gap-3 px-5 py-4', className)} data-tone={insight.tone}>
      <div className="flex items-start gap-3">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', toneClass)}>
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{label}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-snug font-semibold">{insight.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{insight.message}</p>
        </div>
      </div>
      {insight.metric && (
        <div className="flex items-baseline justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">{insight.metric.label}</span>
          <span className="text-base font-semibold">{formatMetric(insight.metric, currency)}</span>
        </div>
      )}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          How this was calculated
          <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <p className="mt-2 rounded-lg border bg-background px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
            {insight.explanation}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
