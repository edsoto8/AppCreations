/**
 * Calculators (brief §5.8, M7a). `/calculators` lists the 15 calculators; `/calculators?c=<id>`
 * opens one (deep-linkable); `&prefill=plan&person=<id>` opens it filled from that person's plan.
 */
import { useId } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { CalculatorId } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useActiveProfile } from '@/state/profileStore';
import { CALCULATOR_GROUPS, CALCULATOR_META, calculatorHref, calculatorMeta, type CalculatorMeta } from './registry';
import type { CalculatorProps } from './useCalculator';
import {
  CompoundInterestCalculator,
  FeeImpactCalculator,
  InflationCalculator,
  LumpSumCalculator,
} from './calcs/growth';
import { Contribution401kCalculator, MatchOptimizerCalculator, RothVsTraditionalCalculator } from './calcs/workplace';
import {
  BaristaFireCalculator,
  CoastFireCalculator,
  RetirementAgeCalculator,
  SavingsGapCalculator,
} from './calcs/plan';
import { FiNumberCalculator, SpendingPlannerCalculator, WithdrawalCalculator } from './calcs/drawdown';
import { SsClaimingCalculator } from './calcs/socialSecurity';

const COMPONENTS: Record<CalculatorId, (props: CalculatorProps) => React.ReactElement> = {
  compoundInterest: CompoundInterestCalculator,
  feeImpact: FeeImpactCalculator,
  lumpSumVsRecurring: LumpSumCalculator,
  inflationPurchasingPower: InflationCalculator,
  contribution401k: Contribution401kCalculator,
  matchOptimizer: MatchOptimizerCalculator,
  rothVsTraditional: RothVsTraditionalCalculator,
  retirementAge: RetirementAgeCalculator,
  savingsGap: SavingsGapCalculator,
  coastFire: CoastFireCalculator,
  baristaFire: BaristaFireCalculator,
  fiNumber: FiNumberCalculator,
  withdrawal: WithdrawalCalculator,
  spendingPlanner: SpendingPlannerCalculator,
  ssClaimingComparison: SsClaimingCalculator,
};

export function CalculatorsPage() {
  const [params] = useSearchParams();
  const meta = calculatorMeta(params.get('c'));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Calculators"
        description="Standalone calculators on the same engine as your plan. Each opens with example values; your plan’s values can be filled in where they fit."
      />
      {meta ? (
        <CalculatorView meta={meta} prefillPersonId={params.get('prefill') === 'plan' ? params.get('person') : null} />
      ) : (
        <CalculatorIndex unknown={params.get('c')} />
      )}
    </div>
  );
}

function CalculatorIndex({ unknown }: { unknown: string | null }) {
  return (
    <div className="flex flex-col gap-8">
      {unknown ? (
        <p role="status" className="text-sm text-muted-foreground">
          There is no calculator called “{unknown}”. Choose one below.
        </p>
      ) : null}
      {CALCULATOR_GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-3" aria-labelledby={`calc-group-${group}`}>
          <h2 id={`calc-group-${group}`} className="text-base font-semibold">
            {group}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CALCULATOR_META.filter((m) => m.group === group).map((m) => (
              <li key={m.id}>
                <Link
                  to={calculatorHref(m.id)}
                  className="group flex h-full flex-col gap-1.5 rounded-lg border bg-card p-4 shadow-xs transition-colors hover:bg-muted/50"
                >
                  <span className="flex items-center justify-between gap-2 font-medium">
                    {m.title}
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">{m.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CalculatorView({ meta, prefillPersonId }: { meta: CalculatorMeta; prefillPersonId: string | null }) {
  const navigate = useNavigate();
  const selectId = useId();
  const profile = useActiveProfile();
  const household = profile?.household ?? null;
  const Component = COMPONENTS[meta.id];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Link
          to="/calculators"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All calculators
        </Link>
        <div className="flex flex-col gap-1.5 sm:w-72">
          <Label htmlFor={selectId}>Calculator</Label>
          <NativeSelect
            id={selectId}
            value={meta.id}
            onChange={(e) => navigate(calculatorHref(e.target.value as CalculatorId))}
          >
            {CALCULATOR_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {CALCULATOR_META.filter((m) => m.group === group).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>
      </div>
      <section aria-labelledby={`${selectId}-title`} className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={`${selectId}-title`} className="text-xl font-semibold tracking-tight">
            {meta.title}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{meta.summary}</p>
        </div>
        <Component
          key={`${meta.id}:${prefillPersonId ?? ''}`}
          household={household}
          prefillPersonId={prefillPersonId}
          autoPrefill={prefillPersonId !== null}
        />
      </section>
    </div>
  );
}
