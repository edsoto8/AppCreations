import { useDeferredValue, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, HeartPulse, Loader2, Save } from 'lucide-react';
import { computeInsights, projectHousehold, type Household, type Insight, type Scenario } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { UnverifiedNotice } from '@/components/UnverifiedNotice';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEngineContext } from '@/hooks/useEngine';
import { useScenarioStore } from '@/state/scenarioStore';
import { newId } from '@/lib/ids';
import { cn } from '@/lib/utils';
import { BeforeLimitsBadge, BeforeTaxesBadge } from '@/features/dashboard/badges';
import { beforeLimits, retirementBeforeTaxes } from '@/features/dashboard/viewModel';
import { describeInsightOp, metricView } from './insightModel';

const LINK = 'font-medium text-foreground underline underline-offset-4';
const NAME_MAX = 80;

interface CardFlags {
  limits: boolean;
  taxes: boolean;
}

function InsightCard({ insight, household, flags }: { insight: Insight; household: Household; flags: CardFlags }) {
  const titleId = useId();
  const createScenario = useScenarioStore((s) => s.createScenario);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const metric = metricView(insight);
  const attention = insight.tone === 'attention';

  const onSave = async () => {
    setSaving(true);
    try {
      const name = `Insight: ${insight.title}`.slice(0, NAME_MAX);
      await createScenario({
        id: newId('scenario') as Scenario['id'],
        name,
        // A profile's id is its household's id.
        baseProfileId: household.id,
        preset: null,
        presetParams: {},
        ops: structuredClone(insight.whatIfOps),
      });
      setSaved(name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      aria-labelledby={titleId}
      className={cn('flex flex-col', attention && 'border-attention/60 bg-attention/5')}
      data-tone={insight.tone}
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle id={titleId}>{insight.title}</CardTitle>
          {attention ? (
            <Badge variant="attention">
              <AlertTriangle aria-hidden="true" className="size-3" />
              Attention
            </Badge>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed">{insight.body}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {metric.label} · {metric.basis}
          </p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums">
            <div>
              <dt className="text-xs text-muted-foreground">Baseline</dt>
              <dd className="font-medium">{metric.baseline}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">What-if</dt>
              <dd className="font-medium">{metric.whatIf}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Change</dt>
              <dd className="font-medium">{metric.delta}</dd>
            </div>
          </dl>
        </div>
        {flags.limits || flags.taxes ? (
          <div className="flex flex-wrap gap-1.5">
            {flags.limits ? <BeforeLimitsBadge /> : null}
            {flags.taxes ? <BeforeTaxesBadge /> : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">What was changed</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {insight.whatIfOps.map((op, i) => (
              <li key={i}>{describeInsightOp(op, household)}</li>
            ))}
          </ul>
        </div>
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Assumptions</summary>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {insight.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
        <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onSave()}
            disabled={saving}
            aria-describedby={titleId}
          >
            <Save aria-hidden="true" /> Save as scenario
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {saved ? (
              <>
                Saved as “{saved}”.{' '}
                <Link to="/scenarios" className={LINK}>
                  Open Scenarios
                </Link>
              </>
            ) : null}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function InsightsBody({ household }: { household: Household }) {
  const ctx = useEngineContext();
  // computeInsights re-runs the projection about 10–40 times: render the page first (initial value
  // null), then compute in a background render, and keep showing the last result while it updates.
  const deferred = useDeferredValue<Household | null>(household, null);
  const computed = useMemo(
    () =>
      deferred
        ? { household: deferred, baseline: projectHousehold(deferred, ctx), insights: computeInsights(deferred, ctx) }
        : null,
    [deferred, ctx],
  );

  if (!computed) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Computing insights…
      </p>
    );
  }
  const { insights, baseline } = computed;
  if (insights.status === 'invalid') {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Insights cannot run with this profile yet</p>
          <ul className="list-disc pl-5">
            {insights.issues.slice(0, 8).map((issue, i) => (
              <li key={i}>
                {issue.path.length > 0 ? `${issue.path.join(' › ')}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Fix these on the{' '}
            <Link to="/profile" className={LINK}>
              Profile
            </Link>{' '}
            or{' '}
            <Link to="/accounts" className={LINK}>
              Accounts
            </Link>{' '}
            page.
          </p>
        </div>
      </Alert>
    );
  }
  if (insights.status === 'unverified') return <UnverifiedNotice missing={insights.missing} feature="insights" />;

  const base = baseline.status === 'ok' ? baseline.value : null;
  const flags: CardFlags = {
    limits: base ? beforeLimits(base) : false,
    taxes: base ? retirementBeforeTaxes(base) : false,
  };
  const healthcare = base
    ? [...new Set(base.warnings.filter((w) => w.code === 'healthcarePreMedicareUserEntered').map((w) => w.message))]
    : [];
  const updating = computed.household !== household;

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-sm text-muted-foreground">
        {updating ? 'Updating insights for your latest changes…' : ''}
      </p>
      {healthcare.length > 0 ? (
        <Alert variant="attention" aria-label="Healthcare before Medicare">
          <HeartPulse aria-hidden="true" />
          <ul className="flex flex-col gap-1">
            {healthcare.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {insights.value.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No insights apply to this plan</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each insight needs something to change, for example a person not yet retired, an account with fees or
              Social Security income.
            </p>
          </CardHeader>
        </Card>
      ) : (
        <div className={cn('grid gap-4 lg:grid-cols-2', updating && 'opacity-70')}>
          {insights.value.map((insight) => (
            <InsightCard key={insight.kind} insight={insight} household={computed.household} flags={flags} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InsightsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        description="Each insight changes one thing in a copy of your plan, re-runs the forecast and describes the difference in this model. They are observations, not recommendations."
      />
      <RequireProfile>{(household) => <InsightsBody key={household.id} household={household} />}</RequireProfile>
    </div>
  );
}
