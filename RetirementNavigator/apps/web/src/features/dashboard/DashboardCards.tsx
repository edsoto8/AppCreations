import { useId } from 'react';
import { Link } from 'react-router';
import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import {
  monteCarloReadiness,
  type DashboardResult,
  type DollarBasis,
  type Household,
  type MonteCarloConfig,
  type MonteCarloResult,
} from '@rn/engine';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InfoTip } from '@/components/InfoTip';
import { formatCents, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BeforeLimitsBadge, BeforeTaxesBadge } from './badges';
import { formatOffset } from './viewModel';
import { REQUIRED_WORDING } from '@/features/monte-carlo/ResultsPanel';
import { inflationLabel } from '@/features/monte-carlo/sharedSettings';
import { formatCount } from '@/features/monte-carlo/viewModel';

interface StatCardProps {
  title: string;
  tip: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  badges?: React.ReactNode;
  dollars: string;
  taxes: string;
  year: string;
  className?: string;
}

/** One dashboard card: headline value, its dollar / tax / year basis, and a formula tip. */
function StatCard({ title, tip, value, detail, badges, dollars, taxes, year, className }: StatCardProps) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium text-muted-foreground">
          {title}
        </h3>
        <InfoTip term={title}>{tip}</InfoTip>
      </div>
      <div className="text-2xl font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
      {detail ? <div className="text-sm text-muted-foreground">{detail}</div> : null}
      {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t pt-2 text-xs text-muted-foreground">
        <dt className="font-medium">Dollars</dt>
        <dd>{dollars}</dd>
        <dt className="font-medium">Taxes</dt>
        <dd>{taxes}</dd>
        <dt className="font-medium">Year</dt>
        <dd>{year}</dd>
      </dl>
    </Card>
  );
}

function PerPerson({ items }: { items: { name: string; value: React.ReactNode }[] }) {
  if (items.length === 1) return <>{items[0]?.value}</>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.name} className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-normal text-muted-foreground">{item.name}</span>
          <span>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

const READINESS = {
  onTrack: { label: 'On track', icon: CircleCheck, className: 'text-positive' },
  borderline: { label: 'Borderline', icon: CircleAlert, className: 'text-attention' },
  atRisk: { label: 'At risk', icon: CircleX, className: 'text-destructive' },
} as const;

const LINK = 'font-medium text-foreground underline underline-offset-4';

/** The latest Monte Carlo run for this profile, as the dashboard sees it. */
export type DashboardMonteCarlo =
  | { kind: 'current'; result: MonteCarloResult; config: MonteCarloConfig }
  /** A full result exists for this profile, but the plan changed since. */
  | { kind: 'stale' }
  | { kind: 'none' };

/** The Monte Carlo success rate and its readiness band (engine `monteCarloReadiness`), with its assumptions. */
function MonteCarloReadiness({ mc }: { mc: DashboardMonteCarlo }) {
  const titleId = useId();
  if (mc.kind !== 'current') {
    return (
      <section aria-labelledby={titleId} className="flex flex-col gap-1 border-t pt-2">
        <h4 id={titleId} className="text-xs font-semibold text-foreground">
          Monte Carlo success rate
        </h4>
        <p className="text-xs">
          {mc.kind === 'stale'
            ? 'The plan changed since the last Monte Carlo run, so its success rate is not shown.'
            : 'No Monte Carlo result for this plan yet.'}{' '}
          <Link to="/monte-carlo" className={LINK}>
            Run Monte Carlo
          </Link>
        </p>
      </section>
    );
  }
  const band = READINESS[monteCarloReadiness(mc.result.successRate)];
  const BandIcon = band.icon;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1 border-t pt-2">
      <h4 id={titleId} className="text-xs font-semibold text-foreground">
        Monte Carlo success rate
      </h4>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {formatPercent(mc.result.successRate, 0)}
        </span>
        <span className={cn('inline-flex items-center gap-1', band.className)}>
          <BandIcon aria-hidden="true" className="size-4" />
          <span className="font-medium text-foreground">{band.label}</span>
        </span>
      </p>
      <p className="text-xs">
        Assumptions: {formatCount(mc.config.paths)} paths, seed {mc.config.seed}, inflation{' '}
        {inflationLabel(mc.config.inflation)}; lognormal annual returns from your capital-market assumptions.{' '}
        {REQUIRED_WORDING}{' '}
        <Link to="/monte-carlo" className={LINK}>
          See every assumption on the Monte Carlo page
        </Link>
      </p>
      <p className="text-xs">Monte Carlo bands: On track at 85% or more; Borderline 70% to 85%; At risk below 70%.</p>
    </section>
  );
}

export function DashboardCards({
  dashboard,
  household,
  basis,
  currentYear,
  beforeLimits,
  monteCarlo,
}: {
  dashboard: DashboardResult;
  household: Household;
  basis: DollarBasis;
  currentYear: number;
  beforeLimits: boolean;
  /**
   * The latest Monte Carlo run for this plan (the dashboard). Omitted, the Monte Carlo part of the
   * Readiness card is not rendered (the link-free print summary).
   */
  monteCarlo?: DashboardMonteCarlo;
}) {
  const { cards } = dashboard;
  const key = basis === 'todays' ? 'real' : 'nominal';
  const retireYear = cards.firstRetirementYear;
  const alreadyRetired = retireYear <= currentYear;
  const retireYearText = alreadyRetired
    ? `This year (${retireYear}), already retired`
    : `First retirement year (${retireYear})`;
  const toggled = basis === 'todays' ? 'Today’s dollars' : `Future dollars (${retireYear})`;
  const beforeTaxes = cards.monthlyRetirementIncome.taxBasis === 'beforeTaxes';
  const incomeTaxText = beforeTaxes ? 'Before taxes' : 'After estimated taxes';
  const limitsBadge = beforeLimits ? <BeforeLimitsBadge /> : null;
  const taxesBadge = beforeTaxes ? <BeforeTaxesBadge /> : null;
  const primary = household.people[0];
  const multi = household.people.length > 1;
  const longevity = cards.longevity;
  const depletionName =
    longevity.kind === 'depletes'
      ? (household.people.find((p) => p.id === longevity.personId)?.name ?? primary?.name)
      : primary?.name;
  const offsets = household.assumptions.deterministicOffsets;
  const surplus = cards.monthlySurplus[key];
  const readiness = READINESS[cards.readiness.status];
  const ReadinessIcon = readiness.icon;
  const outcome = (ok: boolean) => (ok ? 'lasts' : 'falls short');

  return (
    <section aria-labelledby="dashboard-glance" className="flex flex-col gap-3">
      <h2 id="dashboard-glance" className="text-lg font-semibold tracking-tight">
        At a glance
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <StatCard
          title="Current age"
          tip="This calendar year minus the birth year (no months). Everyone is treated as that age for the whole year."
          value={<PerPerson items={cards.people.map((p) => ({ name: p.name, value: p.currentAge }))} />}
          dollars="—"
          taxes="—"
          year={`This year (${currentYear})`}
        />
        <StatCard
          title="Retirement age"
          tip="Your input on the Profile page. Retirement takes effect January 1 of the year you reach this age, and there is no salary that year."
          value={
            <PerPerson
              items={household.people.map((p) => ({
                name: p.name,
                value: p.retirementAge,
              }))}
            />
          }
          detail={household.people
            .map((p) => `${multi ? `${p.name}: ` : ''}January 1, ${p.birthYear + p.retirementAge}`)
            .join(' · ')}
          dollars="—"
          taxes="—"
          year="Takes effect January 1 of that year"
        />
        <StatCard
          title="Years to retirement"
          tip="Retirement age minus current age, never below zero."
          value={
            <PerPerson
              items={cards.people.map((p) => ({
                name: p.name,
                value: p.yearsToRetirement === 0 ? 'Retired' : p.yearsToRetirement,
              }))}
            />
          }
          dollars="—"
          taxes="—"
          year={`Counted from ${currentYear}`}
        />
        <StatCard
          title="Current savings"
          tip="The sum of every account balance you entered, before any tax due when the money is withdrawn."
          value={formatCents(cards.currentSavings)}
          detail={`${household.accounts.length} account${household.accounts.length === 1 ? '' : 's'}`}
          dollars="Today’s dollars (the same as future dollars this year)"
          taxes="Gross: pre-tax balances"
          year={`Start of ${currentYear}`}
        />
        <StatCard
          title="Projected savings at retirement"
          tip={
            <>
              The baseline forecast’s portfolio value on January 1 of the first year in which everyone is retired:
              today’s balances plus contributions and investment growth after fees. In today’s dollars it is divided by
              the cumulative inflation to that year.
            </>
          }
          value={formatCents(cards.savingsAtRetirement[key])}
          badges={limitsBadge}
          dollars={toggled}
          taxes="Gross: pre-tax balances"
          year={
            alreadyRetired
              ? `Start of ${retireYear} (already retired)`
              : `Start of the first retirement year (${retireYear})`
          }
        />
        <StatCard
          title="Projected monthly retirement income"
          tip={
            beforeTaxes ? (
              <>
                Income in the first retirement year divided by 12: withdrawals that fund spending plus any part-time or
                other income. Taxes are not subtracted yet; retirement taxes are modeled in a later milestone (M4).
              </>
            ) : (
              <>Income in the first retirement year after estimated taxes, divided by 12.</>
            )
          }
          value={formatCents(cards.monthlyRetirementIncome[key])}
          detail="Per month"
          badges={taxesBadge}
          dollars={toggled}
          taxes={incomeTaxText}
          year={retireYearText}
        />
        <StatCard
          title="Estimated monthly retirement spending"
          tip="Your retirement spending (entered in today’s dollars) grown with inflation to the first retirement year, divided by 12. It is an after-tax need."
          value={formatCents(cards.monthlyRetirementSpending[key])}
          detail="Per month"
          dollars={toggled}
          taxes="After-tax need"
          year={retireYearText}
        />
        <StatCard
          title="Surplus / shortfall"
          tip={
            <>
              Monthly retirement income minus monthly spending in the first retirement year.
              {beforeTaxes ? ' Income is before taxes, so taxes would lower this figure.' : ''} Withdrawals are sized to
              cover spending, so the figure is $0 unless the portfolio cannot fund the year.
            </>
          }
          value={surplus > 0 ? `+${formatCents(surplus)}` : surplus < 0 ? `−${formatCents(-surplus)}` : formatCents(0)}
          detail={
            surplus > 0 ? 'Surplus per month' : surplus < 0 ? 'Shortfall per month' : 'Per month: spending is covered'
          }
          badges={taxesBadge}
          dollars={toggled}
          taxes={beforeTaxes ? 'Before taxes (income), after-tax need (spending)' : 'After estimated taxes'}
          year={retireYearText}
        />
        <StatCard
          title="Portfolio longevity"
          tip={
            <>
              The first year the baseline forecast cannot fully fund spending, and{' '}
              {multi ? 'the age that year of the first listed person still living' : 'your age in that year'} (calendar
              year minus birth year). If that never happens, the money lasts through the planning age.
            </>
          }
          value={
            cards.longevity.kind === 'depletes'
              ? `Runs out at age ${cards.longevity.age}`
              : `Lasts through planning age ${cards.longevity.planningAge}`
          }
          detail={
            cards.longevity.kind === 'depletes'
              ? `In ${cards.longevity.year}${multi ? `, at ${depletionName}’s age` : ''}. Baseline forecast.`
              : `Money remains through ${dashboard.baseline.summary.lastYear}, the end of the plan. Baseline forecast.`
          }
          badges={limitsBadge}
          dollars="—"
          taxes={beforeTaxes ? 'Withdrawals before taxes' : 'After estimated taxes'}
          year={cards.longevity.kind === 'depletes' ? String(cards.longevity.year) : 'Whole plan'}
        />
        <StatCard
          title="Readiness"
          tip={
            <>
              A labeled heuristic from the deterministic forecasts. A run “lasts” when it never runs out and ends with
              at least your minimum ending balance. On track: baseline and pessimistic runs both last. Borderline: only
              the baseline lasts. At risk: the baseline runs out. After a Monte Carlo run of this plan, its success rate
              is shown alongside, with its own band: On track at 85% or more, Borderline from 70% to 85%, At risk below
              70%.
            </>
          }
          value={
            <span className={cn('inline-flex items-center gap-2', readiness.className)}>
              <ReadinessIcon aria-hidden="true" className="size-6" />
              <span className="text-foreground">{readiness.label}</span>
            </span>
          }
          detail={
            <div className="flex flex-col gap-1">
              <p>
                Baseline run {outcome(cards.readiness.baselineSuccess)}; pessimistic run (
                {formatOffset(offsets.pessimistic)} points of return) {outcome(cards.readiness.pessimisticSuccess)}.
              </p>
              <p className="text-xs">
                On track: baseline and pessimistic runs both last; Borderline: only the baseline lasts; At risk: the
                baseline runs out.
              </p>
              {monteCarlo ? <MonteCarloReadiness mc={monteCarlo} /> : null}
            </div>
          }
          badges={
            <>
              <Badge variant="outline">Heuristic</Badge>
              {limitsBadge}
            </>
          }
          dollars="—"
          taxes={beforeTaxes ? 'Withdrawals before taxes' : 'After estimated taxes'}
          year="Whole plan"
        />
      </div>
    </section>
  );
}
