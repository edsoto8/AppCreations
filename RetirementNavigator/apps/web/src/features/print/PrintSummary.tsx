/**
 * Printable summary (BRIEF §5.10): the active profile's dashboard cards with their basis labels, a
 * compact forecast table (every five years), key assumptions, what the forecast leaves out, and the
 * full disclaimers. The print stylesheet (index.css, `@media print`) hides the app chrome and buttons
 * and prints black on white. No financial formulas: every figure comes from `computeDashboard`.
 */
import { useMemo } from 'react';
import { AlertTriangle, Printer } from 'lucide-react';
import { computeDashboard, type DashboardResult, type DollarBasis, type Household } from '@rn/engine';
import { RequireProfile } from '@/components/RequireProfile';
import { DollarBasisToggle } from '@/components/DollarBasisToggle';
import { UnverifiedNotice } from '@/components/UnverifiedNotice';
import { DISCLAIMER_TEXT } from '@/components/Disclaimer';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEngineContext } from '@/hooks/useEngine';
import { useProfileStore } from '@/state/profileStore';
import { formatCents, formatPercent } from '@/lib/format';
import { DashboardCards } from '@/features/dashboard/DashboardCards';
import {
  agesLabel,
  basisName,
  beforeLimits,
  excludedFeatureLabel,
  forecastNotes,
  formatOffset,
  inBasis,
  notModeledMessages,
  phaseLabel,
  startInBasis,
} from '@/features/dashboard/viewModel';
import { WITHDRAWAL_STRATEGY_LABELS } from '@/features/scenarios/scenarioModel';
import { HEALTHCARE_NOTE } from '@/features/retirement-income/SpendingPlanSection';

/** Rows shown in the compact table: every fifth year from year 1, plus the last year. */
export const SUMMARY_ROW_STEP = 5;

const SECTION = 'print-avoid-break flex flex-col gap-2';
const H2 = 'text-base font-semibold tracking-tight';

function preparedOn(): string {
  return new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
}

function ForecastTable({
  dashboard,
  household,
  basis,
  limits,
}: {
  dashboard: DashboardResult;
  household: Household;
  basis: DollarBasis;
  limits: boolean;
}) {
  const rows = dashboard.baseline.rows;
  const picked = rows.flatMap((row, i) => (i % SUMMARY_ROW_STEP === 0 || i === rows.length - 1 ? [{ row, i }] : []));
  const unit = basisName(basis);
  return (
    <section aria-labelledby="print-forecast" className={SECTION}>
      <h2 id="print-forecast" className={H2}>
        Forecast every {SUMMARY_ROW_STEP} years
      </h2>
      <p className="text-xs text-muted-foreground">
        Baseline forecast (fixed returns), in {unit}. Portfolio start is January 1; flows are for the whole year.
      </p>
      <Table label={`Forecast every ${SUMMARY_ROW_STEP} years, ${unit}`} className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Year</TableHead>
            <TableHead>Age</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead className="text-right">Portfolio start</TableHead>
            <TableHead className="text-right">Contributions{limits ? '*' : ''}</TableHead>
            <TableHead className="text-right">Withdrawals</TableHead>
            <TableHead className="text-right">Spending need</TableHead>
            <TableHead className="text-right">Shortfall</TableHead>
            <TableHead className="text-right">Portfolio end</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {picked.map(({ row, i }) => {
            const money = (cents: number) => formatCents(inBasis(cents, row, basis));
            return (
              <TableRow key={row.year}>
                <TableCell>{row.year}</TableCell>
                <TableCell>{agesLabel(row, household)}</TableCell>
                <TableCell>{phaseLabel(row.phase)}</TableCell>
                <TableCell className="text-right">
                  {formatCents(startInBasis(row.totals.portfolioStart, rows, i, basis))}
                </TableCell>
                <TableCell className="text-right">{money(row.flows.contributions)}</TableCell>
                <TableCell className="text-right">{money(row.flows.withdrawals)}</TableCell>
                <TableCell className="text-right">{money(row.flows.spendingNeed)}</TableCell>
                <TableCell className="text-right">{money(row.flows.shortfall)}</TableCell>
                <TableCell className="text-right font-medium">{money(row.totals.portfolioEnd)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {limits ? (
        <p className="text-xs text-muted-foreground">
          * Contributions are as elected, before plan limits (the limit rules are unverified).
        </p>
      ) : null}
    </section>
  );
}

function Assumptions({ household }: { household: Household }) {
  const a = household.assumptions;
  const s = household.spending;
  const items: [string, string][] = [
    ['Inflation', `${formatPercent(a.inflation, 2)} a year`],
    ['Return before retirement', `${formatPercent(a.returnPreRetirement, 2)} a year (nominal)`],
    ['Return in retirement', `${formatPercent(a.returnPostRetirement, 2)} a year (nominal)`],
    [
      'Capital-market returns',
      `Stocks ${formatPercent(a.capitalMarket.stocks.geometricReturn, 2)}, bonds ${formatPercent(a.capitalMarket.bonds.geometricReturn, 2)}, cash ${formatPercent(a.capitalMarket.cash.geometricReturn, 2)} (geometric, nominal; used for accounts with an allocation)`,
    ],
    [
      'Optimistic / pessimistic lines',
      `${formatOffset(a.deterministicOffsets.optimistic)} / ${formatOffset(a.deterministicOffsets.pessimistic)} percentage points of return (fixed offsets, not confidence intervals)`,
    ],
    ['Withdrawal timing', a.withdrawalTiming === 'startOfYear' ? 'Start of year (conservative)' : 'Mid-year'],
    ['Withdrawal strategy', WITHDRAWAL_STRATEGY_LABELS[a.withdrawalStrategy]],
    ['Calculation', a.granularity === 'monthly' ? 'Month by month' : 'Year by year'],
    ['Current spending', `${formatCents(s.currentAnnualSpending)} a year (today’s dollars)`],
    ['Retirement spending', `${formatCents(s.retirementAnnualSpending)} a year (today’s dollars, after-tax need)`],
    ...s.steps.map((step): [string, string] => [
      `Spending from age ${step.fromAge}`,
      `${formatCents(step.annualSpending)} a year`,
    ]),
    ...(s.retirementRealGlide !== 0
      ? [
          ['Spending change in retirement', `${formatPercent(s.retirementRealGlide, 2)} a year after inflation`] as [
            string,
            string,
          ],
        ]
      : []),
    ['Healthcare before Medicare', `${formatCents(s.healthcareBeforeMedicare)} a year (user-entered, today’s dollars)`],
    ['Spending after a first death', `${formatPercent(s.survivorSpendingReduction)} lower`],
    ['State income tax', `${formatPercent(a.stateTaxRate, 2)} flat (user-entered)`],
    ['Minimum ending balance', `${formatCents(a.minimumEndingBalance)} (today’s dollars)`],
    [
      'Rule values',
      `Published values through ${a.rules.anchorYear}; later years ${a.rules.indexing.mode === 'inflation' ? 'indexed with inflation' : `indexed at ${formatPercent(a.rules.indexing.rate, 2)}`}`,
    ],
  ];
  return (
    <section aria-labelledby="print-assumptions" className={SECTION}>
      <h2 id="print-assumptions" className={H2}>
        Key assumptions
      </h2>
      <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-1 text-xs">
        {items.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="font-medium">{term}</dt>
            <dd className="text-muted-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-2 text-sm font-medium">People</h3>
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {household.people.map((p) => (
          <li key={p.id}>
            <span className="font-medium text-foreground">{p.name}</span>: born {p.birthYear}, retires at{' '}
            {p.retirementAge} (January 1, {p.birthYear + p.retirementAge}), plan through age {p.planningAge}
            {p.socialSecurity.source.kind !== 'none'
              ? `, Social Security claimed at ${p.socialSecurity.claimAge.years}${p.socialSecurity.claimAge.months ? ` and ${p.socialSecurity.claimAge.months} months` : ''}`
              : ', no Social Security in the plan'}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LeftOut({ dashboard }: { dashboard: DashboardResult }) {
  const excluded = dashboard.baseline.excludedFeatures;
  const later = notModeledMessages(dashboard.baseline);
  const notes = forecastNotes(dashboard.baseline);
  return (
    <section aria-labelledby="print-left-out" className={SECTION}>
      <h2 id="print-left-out" className={H2}>
        What this forecast leaves out
      </h2>
      {excluded.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            Steps skipped because their rule values are not verified (the app never fills in unverified values):
          </p>
          <ul className="list-disc pl-5 text-xs">
            {excluded.map((f) => (
              <li key={f}>{excludedFeatureLabel(f)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Every rule value this forecast uses is verified.</p>
      )}
      {later.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">Not modeled in this version:</p>
          <ul className="list-disc pl-5 text-xs">
            {later.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
      {notes.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">Forecast notes:</p>
          <ul className="list-disc pl-5 text-xs">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Disclaimers() {
  return (
    <section aria-labelledby="print-disclaimers" className={SECTION}>
      <h2 id="print-disclaimers" className={H2}>
        Disclaimers
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-xs">
        <li>{DISCLAIMER_TEXT}</li>
        <li>{HEALTHCARE_NOTE}</li>
        <li>
          Readiness is a labeled heuristic from the deterministic runs: on track when the baseline and pessimistic runs
          both last, borderline when only the baseline lasts, at risk when the baseline runs out.
        </li>
        <li>
          The baseline uses fixed returns every year. Real markets vary; the optimistic and pessimistic lines are fixed
          return offsets, not confidence intervals.
        </li>
        <li>
          Rule values come from IRS and SSA publications. A value that is not verified is left out, never assumed, and
          the figures it affects are labeled.
        </li>
        <li>This summary was produced on this device. Your plan data is stored unencrypted in this browser.</li>
      </ul>
    </section>
  );
}

function SummaryBody({ household }: { household: Household }) {
  const ctx = useEngineContext();
  const basis = useProfileStore((s) => s.dollarBasis);
  const result = useMemo(() => computeDashboard(household, ctx), [household, ctx]);

  if (result.status === 'invalid') {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">The forecast cannot run with this profile yet, so there is no summary to print</p>
          <ul className="list-disc pl-5">
            {result.issues.slice(0, 8).map((issue, i) => (
              <li key={i}>
                {issue.path.length > 0 ? `${issue.path.join(' › ')}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      </Alert>
    );
  }
  if (result.status === 'unverified') return <UnverifiedNotice missing={result.missing} feature="the summary" />;

  const dashboard = result.value;
  const limits = beforeLimits(dashboard.baseline);
  const { summary } = dashboard.baseline;
  return (
    <article aria-labelledby="print-title" className="print-summary flex flex-col gap-6">
      <header className="flex flex-col gap-1 border-b pb-3">
        <h1 id="print-title" className="text-2xl font-semibold tracking-tight">
          Retirement summary: {household.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Prepared {preparedOn()} with Retirement Navigator ·{' '}
          {basis === 'todays' ? 'Today’s dollars' : 'Future dollars'} · Baseline forecast {summary.firstYear}–
          {summary.lastYear}
        </p>
      </header>
      <div className="print-cards">
        <DashboardCards
          dashboard={dashboard}
          household={household}
          basis={basis}
          currentYear={ctx.currentYear}
          beforeLimits={limits}
        />
      </div>
      <ForecastTable dashboard={dashboard} household={household} basis={basis} limits={limits} />
      <Assumptions household={household} />
      <LeftOut dashboard={dashboard} />
      <Disclaimers />
    </article>
  );
}

export function PrintSummaryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Printable summary</p>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A one- to two-page summary of the active profile. Use Print, then choose a printer or “Save as PDF”.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DollarBasisToggle />
          <Button onClick={() => window.print()}>
            <Printer aria-hidden="true" /> Print
          </Button>
        </div>
      </div>
      <RequireProfile>{(household) => <SummaryBody key={household.id} household={household} />}</RequireProfile>
    </div>
  );
}
