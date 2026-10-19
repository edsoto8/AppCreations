/**
 * Monte Carlo page (brief §5.7): settings, capital-market assumptions, the run (in Web Workers),
 * results with their assumptions, the sequence-of-returns illustration and the methodology.
 */
import { useDeferredValue, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Link } from 'react-router';
import { AlertTriangle, HeartPulse } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import {
  isPositiveSemiDefinite,
  sequenceRiskIllustration,
  type Household,
  type MonteCarloConfig,
  type ProjectionResult,
} from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { DollarBasisToggle } from '@/components/DollarBasisToggle';
import { UnverifiedNotice } from '@/components/UnverifiedNotice';
import { Alert } from '@/components/ui/alert';
import { useEngineContext } from '@/hooks/useEngine';
import { useHouseholdForm } from '@/hooks/useHouseholdForm';
import { useProfileStore } from '@/state/profileStore';
import { beforeLimits as hasBeforeLimits, retirementBeforeTaxes } from '@/features/dashboard/viewModel';
import { CapitalMarketEditor } from './CapitalMarketEditor';
import { Methodology } from './Methodology';
import { ResultsPanel } from './ResultsPanel';
import { RunSettings } from './RunSettings';
import { SequenceRisk } from './SequenceRisk';
import { prewarmMonteCarlo, useMonteCarloStore } from './runStore';
import { useRunSettingsForm } from './settingsForm';
import { correlationMatrix, defaultConfig, sameConfig, sameHousehold } from './viewModel';

const LINK = 'font-medium text-foreground underline underline-offset-4';

function healthcareNotes(baseline: ProjectionResult | null): string[] {
  if (!baseline) return [];
  return [
    ...new Set(baseline.warnings.filter((w) => w.code === 'healthcarePreMedicareUserEntered').map((w) => w.message)),
  ];
}

function MonteCarloBody({ household }: { household: Household }) {
  const profileId = household.id;
  const ctx = useEngineContext();
  const basis = useProfileStore((s) => s.dollarBasis);
  const deferred = useDeferredValue(household);
  // Everything except progress: progress updates re-render only the progress bar.
  const run = useMonteCarloStore(
    useShallow((s) => ({
      status: s.status,
      profileId: s.profileId,
      config: s.config,
      household: s.household,
      quick: s.quick,
      full: s.full,
      executors: s.executors,
      failure: s.failure,
      start: s.start,
      cancel: s.cancel,
    })),
  );
  useEffect(() => prewarmMonteCarlo(household, ctx), [household, ctx]);
  const ownRun = run.profileId === profileId;

  const householdForm = useHouseholdForm(household);
  const settingsForm = useRunSettingsForm(ownRun && run.config ? run.config : defaultConfig());
  const inflation = useWatch({ control: settingsForm.control, name: 'inflation' }) as
    MonteCarloConfig['inflation'] | undefined;
  const watchedSettings = useWatch({ control: settingsForm.control });

  const illustration = useMemo(() => sequenceRiskIllustration(deferred, ctx), [deferred, ctx]);
  const baseline = illustration.status === 'ok' ? illustration.value.baseline : null;
  const limits = baseline ? hasBeforeLimits(baseline) : false;
  const taxes = baseline ? retirementBeforeTaxes(baseline) : false;

  // Correlation checks (engine `isPositiveSemiDefinite` on the matrix the engine factors).
  const cma = household.assumptions.capitalMarket;
  const assetsPsd = isPositiveSemiDefinite(correlationMatrix(cma, null));
  const fullPsd = isPositiveSemiDefinite(correlationMatrix(cma, inflation ?? null));

  const cmaErrors = householdForm.formState.errors.assumptions?.capitalMarket;
  const blockers: string[] = [];
  if (!assetsPsd) {
    blockers.push(
      'The capital-market correlations are not positive semi-definite (see Capital-market assumptions), so no set of returns can have them.',
    );
  } else if (!fullPsd) {
    blockers.push(
      'With these inflation correlations the combined correlation matrix (stocks, bonds, cash and inflation) is not positive semi-definite, so no set of returns can have them. Bring the inflation correlations closer to 0 or make them consistent with the asset correlations.',
    );
  }
  if (cmaErrors) blockers.push('Fix the highlighted capital-market assumptions first.');
  if (illustration.status !== 'ok') blockers.push('The plan cannot be projected yet; fix the issues above first.');

  const shown = ownRun ? (run.full ?? run.quick) : null;
  const ranWith = ownRun ? run.household : null;
  const stale = useMemo(
    () =>
      shown !== null &&
      ranWith !== null &&
      run.config !== null &&
      (!sameHousehold(ranWith, household) ||
        !sameConfig(run.config, watchedSettings as Partial<MonteCarloConfig> | undefined)),
    [shown, ranWith, run.config, household, watchedSettings],
  );
  const cmaCurrent = ranWith !== null && JSON.stringify(ranWith.assumptions.capitalMarket) === JSON.stringify(cma);

  const notes = healthcareNotes(baseline);

  return (
    <div className="flex flex-col gap-6">
      {notes.length > 0 ? (
        <Alert variant="attention" aria-label="Healthcare before Medicare">
          <HeartPulse aria-hidden="true" />
          <ul className="flex flex-col gap-1">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {illustration.status === 'invalid' ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">The plan cannot be simulated with this profile yet</p>
            <ul className="list-disc pl-5">
              {illustration.issues.slice(0, 8).map((issue, i) => (
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
      ) : null}
      {illustration.status === 'unverified' ? (
        <UnverifiedNotice missing={illustration.missing} feature="the Monte Carlo simulation" />
      ) : null}

      <div className="flex flex-col gap-6">
        <RunSettings
          form={settingsForm}
          planInflation={household.assumptions.inflation}
          running={ownRun && run.status === 'running'}
          blockers={blockers}
          onRun={(config) => run.start({ profileId, household, ctx, config })}
          onCancel={run.cancel}
        />
        <CapitalMarketEditor
          form={householdForm}
          result={shown?.result ?? null}
          resultIsCurrent={cmaCurrent}
          psd={assetsPsd}
        />
      </div>

      <div aria-live="polite" className="sr-only">
        {ownRun && run.status === 'running' && run.quick ? 'Quick result ready; refining.' : ''}
        {ownRun && run.status === 'done' ? 'Simulation complete.' : ''}
        {ownRun && run.status === 'cancelled' ? 'Simulation cancelled.' : ''}
      </div>

      {ownRun && run.status === 'failed' && run.failure ? (
        <Alert variant="destructive" aria-label="Simulation failed">
          <AlertTriangle aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">The simulation could not run</p>
            {'message' in run.failure ? (
              <p>{run.failure.message}</p>
            ) : run.failure.result.status === 'invalid' ? (
              <ul className="list-disc pl-5">
                {run.failure.result.issues.slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    {issue.path.length > 0 ? `${issue.path.join(' › ')}: ` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>It depends on rule values that are not verified yet.</p>
            )}
          </div>
        </Alert>
      ) : null}

      <ResultsPanel
        quick={ownRun ? run.quick : null}
        full={ownRun ? run.full : null}
        plannedPaths={ownRun && run.config ? run.config.paths : 0}
        running={ownRun && run.status === 'running'}
        cancelled={ownRun && run.status === 'cancelled'}
        stale={stale}
        executors={run.executors}
        basis={basis}
        baseline={baseline}
        household={deferred}
        beforeLimits={limits}
        beforeTaxes={taxes}
      />

      {illustration.status === 'ok' ? (
        <SequenceRisk
          illustration={illustration.value}
          household={deferred}
          basis={basis}
          beforeLimits={limits}
          beforeTaxes={taxes}
        />
      ) : null}

      <Methodology result={shown?.result ?? null} baseline={baseline} beforeLimits={limits} beforeTaxes={taxes} />
    </div>
  );
}

export function MonteCarloPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monte Carlo"
        description="The range of outcomes for your plan when market returns vary from year to year. Model-dependent estimates, not guarantees."
        actions={<DollarBasisToggle />}
      />
      <RequireProfile>{(household) => <MonteCarloBody key={household.id} household={household} />}</RequireProfile>
    </div>
  );
}
