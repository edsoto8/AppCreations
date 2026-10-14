import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRightIcon,
  CalculatorIcon,
  CalendarRangeIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  InfoIcon,
  LightbulbIcon,
  PiggyBankIcon,
  PlusIcon,
  RefreshCcwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Disclaimer } from '@/components/Disclaimer';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import type { Insight, InsightCategory, InsightTone } from '@/api/types';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { formatMetric } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useInsights } from './queries';

interface CategoryMeta {
  title: string;
  description: string;
  Icon: LucideIcon;
  action?: (loanId: number) => { to: string; label: string };
}

/** Display order: warnings first, then progress, projection, savings, refinance, scenarios. */
export const CATEGORY_ORDER: readonly InsightCategory[] = ['warning', 'progress', 'projection', 'savings', 'refinance', 'scenario'];

const CATEGORY: Record<InsightCategory, CategoryMeta> = {
  warning: {
    title: 'Needs attention',
    description: 'Something in your numbers is worth a closer look.',
    Icon: TriangleAlertIcon,
    action: (id) => ({ to: `/loans/${id}/edit`, label: 'Review loan details' }),
  },
  progress: { title: 'Your progress', description: 'How much of the loan you have already paid down.', Icon: TrendingUpIcon },
  projection: {
    title: 'Where you are headed',
    description: 'What the current payment plan leads to.',
    Icon: CalendarRangeIcon,
    action: () => ({ to: '/schedule', label: 'See the schedule' }),
  },
  savings: {
    title: 'Ways to save',
    description: 'What extra payments could do. Extras go to principal and never replace a scheduled payment.',
    Icon: PiggyBankIcon,
    action: () => ({ to: '/simulator', label: 'Try it in the simulator' }),
  },
  refinance: {
    title: 'Rate and refinancing',
    description: 'How much your interest rate matters.',
    Icon: RefreshCcwIcon,
    action: () => ({ to: '/refinance', label: 'Explore refinancing' }),
  },
  scenario: {
    title: 'Your scenarios',
    description: 'What your saved payoff plans achieve.',
    Icon: SlidersHorizontalIcon,
    action: () => ({ to: '/compare', label: 'Compare scenarios' }),
  },
};

const TONE: Record<InsightTone, { label: string; Icon: LucideIcon; badge: 'positive' | 'secondary' | 'warning'; tile: string; accent: string }> = {
  positive: { label: 'Good news', Icon: SparklesIcon, badge: 'positive', tile: 'bg-positive/10 text-positive', accent: 'before:bg-positive' },
  neutral: { label: 'For your information', Icon: InfoIcon, badge: 'secondary', tile: 'bg-primary/10 text-primary', accent: 'before:bg-primary/60' },
  warning: { label: 'Watch out', Icon: TriangleAlertIcon, badge: 'warning', tile: 'bg-warning/10 text-warning', accent: 'before:bg-warning' },
};

export function groupInsights(insights: Insight[]): { category: InsightCategory; items: Insight[] }[] {
  return CATEGORY_ORDER.map((category) => ({ category, items: insights.filter((i) => i.category === category) })).filter((g) => g.items.length > 0);
}

export function InsightsPage() {
  const { loans, isLoading, isError, error, selectedLoanId, selectedLoan } = useLoanContext();
  const insights = useInsights(selectedLoanId);
  const currency = useCurrency();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupInsights(insights.data ?? []), [insights.data]);
  const all = insights.data ?? [];
  const allOpen = all.length > 0 && all.every((i) => openIds.has(i.id));

  if (isLoading) return <InsightsSkeleton />;
  if (isError) return <QueryError error={error} title="Could not load your loans" />;
  if (loans.length === 0 || selectedLoanId === null || !selectedLoan) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Insights" description="Plain-language observations about your loan, each with the numbers and method behind it." />
        <EmptyState
          icon={<LightbulbIcon />}
          title={loans.length === 0 ? 'Add a loan to get insights' : 'Select a loan to see insights'}
          description="LoanPilot checks your loan's progress, projected payoff, interest and savings opportunities, and explains each finding."
          action={
            loans.length === 0 ? (
              <Button asChild>
                <Link to="/loans/new">
                  <PlusIcon /> Add a loan
                </Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const toggle = (id: string, open: boolean) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const counts = { warning: 0, positive: 0, neutral: 0 } as Record<InsightTone, number>;
  for (const i of all) counts[i.tone] += 1;

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={selectedLoan.loan.name}
        title="Insights"
        description="Plain-language observations about your loan, each with the numbers and method behind it."
        actions={
          all.length > 0 && (
            <Button variant="outline" onClick={() => setOpenIds(allOpen ? new Set() : new Set(all.map((i) => i.id)))}>
              {allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
              {allOpen ? 'Hide all calculations' : 'Show all calculations'}
            </Button>
          )
        }
      />

      <Card className="flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalculatorIcon className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Computed from your loan&apos;s own numbers</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Each insight is a rule LoanPilot runs on this loan with the same payment engine as the rest of the app. There is no AI service involved
              and nothing leaves your computer. Open “How this was calculated” on any card to see the inputs and the method.
            </p>
          </div>
        </div>
        {all.length > 0 && (
          <ul className="flex flex-wrap gap-2 sm:max-w-56 sm:justify-end" aria-label="Insights by tone">
            {(['warning', 'positive', 'neutral'] as const)
              .filter((t) => counts[t] > 0)
              .map((t) => {
                const { Icon, label, badge } = TONE[t];
                return (
                  <li key={t}>
                    <Badge variant={badge} className="gap-1.5 px-2 py-1">
                      <Icon aria-hidden />
                      {counts[t]} {label.toLowerCase()}
                    </Badge>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>

      {insights.isPending ? (
        <InsightsBodySkeleton />
      ) : insights.isError ? (
        <QueryError error={insights.error} onRetry={() => void insights.refetch()} title="Could not load insights" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<LightbulbIcon />}
          title="No insights for this loan yet"
          description="Insights appear when there is something to say about progress, interest or savings. A paid-off loan, for example, has nothing left to optimise."
        />
      ) : (
        <div className={cn('grid gap-10 transition-opacity', insights.isFetching && 'opacity-60')}>
          {groups.map(({ category, items }) => {
            const meta = CATEGORY[category];
            const action = meta.action?.(selectedLoanId);
            return (
              <section key={category} aria-labelledby={`insights-${category}`} data-category={category} className="grid gap-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg [&_svg]:size-[18px]',
                        category === 'warning' ? 'bg-warning/10 text-warning' : 'bg-muted text-foreground',
                      )}
                    >
                      <meta.Icon aria-hidden />
                    </span>
                    <div>
                      <h2 id={`insights-${category}`} className="flex items-center gap-2 text-base font-semibold tracking-tight">
                        {meta.title}
                        <span className="num rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
                      </h2>
                      <p className="text-sm text-muted-foreground">{meta.description}</p>
                    </div>
                  </div>
                  {action && (
                    <Button variant="link" size="sm" asChild className="px-0">
                      <Link to={action.to}>
                        {action.label} <ArrowRightIcon />
                      </Link>
                    </Button>
                  )}
                </div>
                <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((insight) => (
                    <InsightPanel
                      key={insight.id}
                      insight={insight}
                      currency={currency}
                      open={openIds.has(insight.id)}
                      onOpenChange={(o) => toggle(insight.id, o)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

/**
 * Insight card for the full page: a visible tone label (icon + words, never colour alone), the
 * metric formatted per its declared format, and a controlled "How this was calculated" section.
 */
function InsightPanel({
  insight,
  currency,
  open,
  onOpenChange,
}: {
  insight: Insight;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tone = TONE[insight.tone];
  return (
    <Card
      data-tone={insight.tone}
      data-testid={`insight-${insight.id}`}
      className={cn(
        'relative gap-4 overflow-hidden px-5 py-5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[""]',
        tone.accent,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tone.tile)}>
          <tone.Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Badge variant={tone.badge} className="mb-1.5">
            {tone.label}
          </Badge>
          <h3 className="text-[15px] leading-snug font-semibold">{insight.title}</h3>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{insight.message}</p>
      {insight.metric && (
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/60 px-3.5 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">{insight.metric.label}</span>
          <span className="text-lg font-semibold tracking-tight" data-testid="insight-metric">
            {formatMetric(insight.metric, currency)}
          </span>
        </div>
      )}
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <CalculatorIcon className="size-3.5" aria-hidden />
          How this was calculated
          <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <p className="mt-2.5 rounded-lg border bg-background px-3 py-2.5 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
            {insight.explanation}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function InsightsBodySkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading insights">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-48 rounded-xl" />
      ))}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading insights">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-24 rounded-xl" />
      <InsightsBodySkeleton />
    </div>
  );
}
