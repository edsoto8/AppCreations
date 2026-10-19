import { Link } from 'react-router';
import { HeartPulse, Plus, Trash2 } from 'lucide-react';
import type { Household } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/form/Field';
import { IntegerInput, MoneyInput } from '@/components/form/inputs';
import { MoneyField, PercentField } from '@/components/form/fields';
import { errorAt, setter, type HouseholdControl, type HouseholdForm } from './formHelpers';

export const HEALTHCARE_NOTE = 'Early-retirement scenarios: healthcare costs before Medicare are user-entered only.';

function SpendingSteps({ form, values }: { form: HouseholdForm; values: Household }) {
  const set = setter(form);
  const steps = values.spending.steps;
  const primary = values.people[0];
  const listError = errorAt(form, 'spending.steps');
  return (
    <fieldset className="flex flex-col gap-3 sm:col-span-2">
      <legend className="mb-2 text-sm font-medium">Spending steps by age (optional)</legend>
      <p className="text-xs text-muted-foreground">
        Change retirement spending from an age of {primary?.name ?? 'the first person'} (the first person listed), for
        example less travel after 80. Each step replaces the amount above from that age, in today’s dollars.
      </p>
      {steps.map((step, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3">
          <Field label="From age" className="w-28" error={errorAt(form, `spending.steps.${i}.fromAge`)}>
            {(a) => (
              <IntegerInput {...a} value={step.fromAge} onChange={(age) => set(`spending.steps.${i}.fromAge`, age)} />
            )}
          </Field>
          <Field label="Spending per year" className="w-44" error={errorAt(form, `spending.steps.${i}.annualSpending`)}>
            {(a) => (
              <MoneyInput
                {...a}
                value={step.annualSpending}
                onChange={(cents) => set(`spending.steps.${i}.annualSpending`, cents)}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove the spending step at age ${step.fromAge}`}
            onClick={() =>
              set(
                'spending.steps',
                steps.filter((_, j) => j !== i),
              )
            }
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      {listError ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {listError}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={steps.length >= 10}
          onClick={() => {
            const last = steps.reduce((max, s) => Math.max(max, s.fromAge), (primary?.retirementAge ?? 65) + 5);
            set('spending.steps', [
              ...steps,
              { fromAge: last + 5, annualSpending: values.spending.retirementAnnualSpending },
            ]);
          }}
        >
          <Plus aria-hidden="true" /> Add a spending step
        </Button>
      </div>
    </fieldset>
  );
}

export function SpendingPlanSection({ form, values }: { form: HouseholdForm; values: Household }) {
  const control = form.control as HouseholdControl;
  const couple = values.people.length > 1;
  const hasHsa = values.accounts.some((a) => a.type === 'hsa');
  return (
    <Card aria-labelledby="spending-title">
      <CardHeader>
        <CardTitle id="spending-title">Spending plan</CardTitle>
        <CardDescription>
          What retirement costs each year after taxes, in today’s dollars. Current (working-years) spending is on the{' '}
          <Link to="/profile" className="font-medium text-foreground underline underline-offset-4">
            Profile
          </Link>{' '}
          page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            control={control}
            name="spending.retirementAnnualSpending"
            label="Retirement spending per year"
            tip="The after-tax amount you expect to spend each year in retirement, in today’s dollars. The same value as on the Profile page."
            example="Often 70–90% of current spending."
          />
          <PercentField
            control={control}
            name="spending.retirementRealGlide"
            label="Yearly change after inflation"
            tip="A gradual change in retirement spending beyond inflation, applied each year after the first retirement year. Negative values mean spending slowly falls in real terms."
            example="For example −1% (enter -1). Default 0%."
          />
          <SpendingSteps form={form} values={values} />
          <MoneyField
            control={control}
            name="spending.healthcareBeforeMedicare"
            label="Healthcare before Medicare (per year)"
            tip="Added to spending in each retirement year (everyone retired) while someone retired is under 65. It is the only way healthcare costs before Medicare enter the plan."
            example="For example $12,000 for one person."
          />
          {couple ? (
            <PercentField
              control={control}
              name="spending.survivorSpendingReduction"
              label="Spending reduction after a death"
              tip="Household spending falls by this share from the first year one person is no longer alive (the year after their planning age). A labeled assumption."
              example="Default 20%."
            />
          ) : null}
          {hasHsa ? (
            <MoneyField
              control={control}
              name="spending.hsaQualifiedMedicalExpenses"
              label="Medical expenses paid from the HSA (per year)"
              tip="Qualified medical expenses in retirement, in today’s dollars, paid tax-free from your HSA. They are part of the spending above, not added to it."
              example="Default $0."
            />
          ) : null}
        </div>
        <Alert variant="info">
          <HeartPulse aria-hidden="true" />
          <p>{HEALTHCARE_NOTE}</p>
        </Alert>
      </CardContent>
    </Card>
  );
}
