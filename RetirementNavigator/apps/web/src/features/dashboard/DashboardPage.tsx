import { useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Info } from 'lucide-react';
import { computeDashboard, type DashboardResult, type Household } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { DollarBasisToggle } from '@/components/DollarBasisToggle';
import { UnverifiedNotice } from '@/components/UnverifiedNotice';
import { Alert } from '@/components/ui/alert';
import { useEngineContext } from '@/hooks/useEngine';
import { useProfileStore } from '@/state/profileStore';
import { AllocationCharts } from './AllocationCharts';
import { DashboardCards } from './DashboardCards';
import { ForecastChart } from './ForecastChart';
import { ForecastDetails } from './ForecastDetails';
import { beforeLimits, excludedFeatureLabel, forecastNotes, notModeledMessages } from './viewModel';

const LINK = 'font-medium text-foreground underline underline-offset-4';

/** The persistent "what this forecast leaves out" banner (docs §1.7): calm, specific, linked to sources. */
function ForecastScopeBanner({ dashboard }: { dashboard: DashboardResult }) {
  const excluded = dashboard.baseline.excludedFeatures;
  const later = notModeledMessages(dashboard.baseline);
  if (excluded.length === 0 && later.length === 0) return null;
  return (
    <Alert variant={excluded.length > 0 ? 'attention' : 'info'} aria-labelledby="forecast-scope-title">
      <Info aria-hidden="true" />
      <div className="flex flex-col gap-2">
        <p id="forecast-scope-title" className="font-medium">
          {excluded.length > 0
            ? 'This forecast leaves out steps whose rule values are not verified yet'
            : 'What this forecast does not include yet'}
        </p>
        {excluded.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">
              The app never fills in unverified values, so these steps are skipped. Affected figures are labeled “Before
              plan limits (unverified)” or “Before taxes”, and take-home pay is not shown:
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {excluded.map((f) => (
                <li key={f}>{excludedFeatureLabel(f)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {later.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">Modeled in a later milestone (figures are labeled “Before taxes”):</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {later.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-muted-foreground">
          <Link to="/rules" className={LINK}>
            See Rules &amp; Sources
          </Link>{' '}
          for each value’s verification status.
        </p>
      </div>
    </Alert>
  );
}

function ForecastNotes({ dashboard }: { dashboard: DashboardResult }) {
  const notes = forecastNotes(dashboard.baseline);
  if (notes.length === 0) return null;
  return (
    <Alert variant="attention" aria-label="Forecast notes">
      <AlertTriangle aria-hidden="true" />
      <ul className="flex flex-col gap-1">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Alert>
  );
}

function DashboardBody({ household }: { household: Household }) {
  const ctx = useEngineContext();
  const basis = useProfileStore((s) => s.dollarBasis);
  // Typing on another page commits often; deferring keeps the dashboard responsive while it recomputes.
  const deferred = useDeferredValue(household);
  const result = useMemo(() => computeDashboard(deferred, ctx), [deferred, ctx]);

  if (result.status === 'invalid') {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">The forecast cannot run with this profile yet</p>
          <ul className="list-disc pl-5">
            {result.issues.slice(0, 8).map((issue, i) => (
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
  if (result.status === 'unverified') return <UnverifiedNotice missing={result.missing} feature="the forecast" />;

  const dashboard = result.value;
  const limits = beforeLimits(dashboard.baseline);
  return (
    <div className="flex flex-col gap-6">
      <ForecastScopeBanner dashboard={dashboard} />
      <DashboardCards
        dashboard={dashboard}
        household={deferred}
        basis={basis}
        currentYear={ctx.currentYear}
        beforeLimits={limits}
      />
      <ForecastNotes dashboard={dashboard} />
      <ForecastChart dashboard={dashboard} household={deferred} basis={basis} beforeLimits={limits} />
      <AllocationCharts dashboard={dashboard} household={deferred} basis={basis} beforeLimits={limits} />
      <ForecastDetails result={dashboard.baseline} household={deferred} basis={basis} beforeLimits={limits} />
      <p className="text-xs text-muted-foreground">
        Forecast settings (withdrawal timing and strategy, return offsets, minimum ending balance) are on the{' '}
        <Link to="/profile" className={LINK}>
          Profile
        </Link>{' '}
        page.
      </p>
    </div>
  );
}

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Your retirement outlook at a glance: savings, income, spending and how long the portfolio lasts in this model."
        actions={<DollarBasisToggle />}
      />
      <RequireProfile>{(household) => <DashboardBody key={household.id} household={household} />}</RequireProfile>
    </div>
  );
}
