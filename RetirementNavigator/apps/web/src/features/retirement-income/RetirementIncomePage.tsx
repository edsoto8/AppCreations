import { useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { projectHousehold, type Household } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { DollarBasisToggle } from '@/components/DollarBasisToggle';
import { UnverifiedNotice } from '@/components/UnverifiedNotice';
import { Alert } from '@/components/ui/alert';
import { useHouseholdForm } from '@/hooks/useHouseholdForm';
import { useEngineContext } from '@/hooks/useEngine';
import { useProfileStore } from '@/state/profileStore';
import { GrossToNet } from './GrossToNet';
import { OneTimeEventsSection } from './OneTimeEventsSection';
import { OtherIncomeSection } from './OtherIncomeSection';
import { PensionsSection } from './PensionsSection';
import { SocialSecuritySection } from './SocialSecuritySection';
import { SpendingPlanSection } from './SpendingPlanSection';

function RetirementIncomeForm({ household }: { household: Household }) {
  const form = useHouseholdForm(household);
  const values = form.watch() as Household;
  const ctx = useEngineContext();
  const basis = useProfileStore((s) => s.dollarBasis);
  // The forecast uses the last VALID household (from the store); deferring keeps typing responsive.
  const deferred = useDeferredValue(household);
  const result = useMemo(() => projectHousehold(deferred, ctx), [deferred, ctx]);
  const projection = result.status === 'ok' ? result.value : null;

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => e.preventDefault()} noValidate>
      <SocialSecuritySection
        form={form}
        household={household}
        values={values}
        projection={projection}
        basis={basis}
        rules={ctx.rules}
      />
      <PensionsSection form={form} values={values} />
      <OtherIncomeSection form={form} values={values} />
      <OneTimeEventsSection form={form} values={values} />
      <SpendingPlanSection form={form} values={values} />
      {result.status === 'ok' ? (
        <GrossToNet result={result.value} household={deferred} basis={basis} />
      ) : result.status === 'unverified' ? (
        <UnverifiedNotice missing={result.missing} feature="the retirement income forecast" />
      ) : (
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
          </div>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        The withdrawal order and other forecast settings are on the{' '}
        <Link to="/profile" className="font-medium text-foreground underline underline-offset-4">
          Profile
        </Link>{' '}
        page. Results are estimates from this model, not advice.
      </p>
    </form>
  );
}

export function RetirementIncomePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Retirement Income"
        description="Social Security, pensions, other income, one-time events and your spending plan, with each retirement year from gross income to net."
        actions={<DollarBasisToggle />}
      />
      <RequireProfile>
        {(household) => <RetirementIncomeForm key={household.id} household={household} />}
      </RequireProfile>
    </div>
  );
}
