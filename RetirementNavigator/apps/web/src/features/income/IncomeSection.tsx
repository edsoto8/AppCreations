import { Plus, Trash2 } from 'lucide-react';
import type { Control, UseFormReturn } from 'react-hook-form';
import { impliedRaise, type Household, type HouseholdInput } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { IntegerField, MoneyField, PercentField, SwitchField } from '@/components/form/fields';
import { IntegerInput, PercentInput } from '@/components/form/inputs';
import { CURRENT_YEAR } from '@/app/env';
import { formatPercent } from '@/lib/format';

type Form = UseFormReturn<HouseholdInput, unknown, Household>;
type Person = Household['people'][number];
type Employment = NonNullable<Person['employment']>;

const DEFAULT_EMPLOYMENT: Employment = {
  baseSalary: 6_000_000 as Employment['baseSalary'],
  bonus: { kind: 'none' },
  bonusGrowth: { mode: 'withSalary' },
  bonusCountsForDeferrals: true,
  bonusCountsForMatch: true,
  raise: { mode: 'nominal', rate: 0.03 as never },
  raiseOverrides: [],
  stopAge: null,
  partTime: null,
  priorYearFicaWages: null,
};

export function IncomeSection({
  form,
  index,
  person,
  inflation,
}: {
  form: Form;
  index: number;
  person: Person;
  inflation: number;
}) {
  const control = form.control as Control<HouseholdInput, unknown, Household>;
  const base = `people.${index}.employment` as const;
  const employment = person.employment;
  const set = (path: string, value: unknown) =>
    form.setValue(path as never, value as never, { shouldDirty: true, shouldValidate: true });

  if (!employment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Income</CardTitle>
          <CardDescription>{person.name} has no employment income in this plan.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => set(base, DEFAULT_EMPLOYMENT)}>
            <Plus aria-hidden="true" /> Add employment income
          </Button>
        </CardContent>
      </Card>
    );
  }

  const raise = employment.raise;
  const { nominal: impliedNominal, real: impliedReal } = impliedRaise(raise, inflation);
  const overrides = employment.raiseOverrides;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Income</CardTitle>
        <CardDescription>
          Gross pay before taxes and deductions. Salary stops when {person.name} retires.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            control={control}
            name={`${base}.baseSalary`}
            label="Annual base salary"
            tip="Current gross annual base pay, before taxes and before workplace-plan contributions."
            example="For example $85,000."
          />
          <Field
            label="Bonus"
            tip="A bonus paid once a year, as a percent of salary or a fixed amount."
            example="For example 10% of salary."
          >
            {(a) => (
              <NativeSelect
                {...a}
                value={employment.bonus.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  set(
                    `${base}.bonus`,
                    kind === 'percentOfSalary'
                      ? { kind, pct: 0.1 }
                      : kind === 'fixed'
                        ? { kind, amount: 500_000 }
                        : { kind: 'none' },
                  );
                }}
              >
                <option value="none">No bonus</option>
                <option value="percentOfSalary">Percent of salary</option>
                <option value="fixed">Fixed amount</option>
              </NativeSelect>
            )}
          </Field>
          {employment.bonus.kind === 'percentOfSalary' ? (
            <PercentField
              control={control}
              name={`${base}.bonus.pct`}
              label="Bonus (% of salary)"
              example="It grows with salary."
            />
          ) : null}
          {employment.bonus.kind === 'fixed' ? (
            <>
              <MoneyField
                control={control}
                name={`${base}.bonus.amount`}
                label="Bonus amount"
                example="Paid once a year."
              />
              <Field
                label="Bonus growth"
                tip="How a fixed bonus changes each year."
                example="Grows with salary by default."
              >
                {(a) => (
                  <NativeSelect
                    {...a}
                    value={employment.bonusGrowth.mode}
                    onChange={(e) => {
                      const mode = e.target.value;
                      set(`${base}.bonusGrowth`, mode === 'ownRate' ? { mode, rate: 0.03 } : { mode });
                    }}
                  >
                    <option value="withSalary">Grows with salary</option>
                    <option value="ownRate">Grows at its own rate</option>
                    <option value="flat">Stays flat</option>
                  </NativeSelect>
                )}
              </Field>
              {employment.bonusGrowth.mode === 'ownRate' ? (
                <PercentField
                  control={control}
                  name={`${base}.bonusGrowth.rate`}
                  label="Bonus growth rate"
                  example="Per year."
                />
              ) : null}
            </>
          ) : null}
          {employment.bonus.kind !== 'none' ? (
            <>
              <SwitchField
                control={control}
                name={`${base}.bonusCountsForDeferrals`}
                label="Bonus counts for plan deferrals"
                tip="Plan-dependent. When on, your bonus deferral percentages apply to the bonus."
                example="On by default; check your plan rules."
              />
              <SwitchField
                control={control}
                name={`${base}.bonusCountsForMatch`}
                label="Bonus counts for the employer match"
                tip="Plan-dependent. When on, the bonus is part of the pay the match is calculated on."
                example="On by default; check your plan rules."
              />
            </>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Annual raise"
            tip="Raises are applied each year from the second year. Enter a nominal raise, or inflation plus a real raise."
            example={`Implied: ${formatPercent(impliedNominal, 2)} nominal, ${formatPercent(impliedReal, 2)} after inflation.`}
          >
            {(a) => (
              <NativeSelect
                {...a}
                value={raise.mode}
                onChange={(e) =>
                  set(
                    `${base}.raise`,
                    e.target.value === 'inflationPlus'
                      ? { mode: 'inflationPlus', realRate: 0.01 }
                      : { mode: 'nominal', rate: 0.03 },
                  )
                }
              >
                <option value="nominal">Nominal raise</option>
                <option value="inflationPlus">Inflation plus a real raise</option>
              </NativeSelect>
            )}
          </Field>
          {raise.mode === 'nominal' ? (
            <PercentField
              control={control}
              name={`${base}.raise.rate`}
              label="Raise per year"
              example="For example 3%."
            />
          ) : (
            <PercentField
              control={control}
              name={`${base}.raise.realRate`}
              label="Real raise above inflation"
              example="For example 1%."
            />
          )}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Year-specific raises</legend>
          <p className="text-xs text-muted-foreground">
            Override the raise in a given year, such as a 10% promotion or a year with no raise.
          </p>
          {overrides.map((o, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <Field label="Year" className="w-28">
                {(a) => (
                  <IntegerInput
                    {...a}
                    value={o.year}
                    onChange={(year) => set(`${base}.raiseOverrides.${i}.year`, year)}
                  />
                )}
              </Field>
              <Field label="Raise that year" className="w-36">
                {(a) => (
                  <PercentInput
                    {...a}
                    value={o.rate}
                    onChange={(rate) => set(`${base}.raiseOverrides.${i}.rate`, rate)}
                  />
                )}
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove the ${o.year} raise override`}
                onClick={() =>
                  set(
                    `${base}.raiseOverrides`,
                    overrides.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          {form.formState.errors.people?.[index]?.employment?.raiseOverrides?.root?.message ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {form.formState.errors.people[index]?.employment?.raiseOverrides?.root?.message}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const used = new Set(overrides.map((o) => o.year));
                let year = CURRENT_YEAR + 1;
                while (used.has(year)) year++;
                set(`${base}.raiseOverrides`, [...overrides, { year, rate: 0.1 }]);
              }}
            >
              <Plus aria-hidden="true" /> Add a year-specific raise
            </Button>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Salary stops at age"
            tip="Salary stops on January 1 of the year this age is reached. By default that is the retirement age."
            example={
              employment.stopAge === null
                ? `At retirement (age ${person.retirementAge}).`
                : employment.stopAge < person.retirementAge
                  ? `Earlier than retirement (age ${person.retirementAge}).`
                  : `After the retirement age (${person.retirementAge}): the forecast counts you as working until salary stops.`
            }
            error={form.formState.errors.people?.[index]?.employment?.stopAge?.message}
          >
            {(a) => (
              <IntegerInput
                {...a}
                value={employment.stopAge ?? person.retirementAge}
                onChange={(age) => set(`${base}.stopAge`, age === person.retirementAge ? null : age)}
              />
            )}
          </Field>
          <MoneyField
            control={control}
            name={`${base}.priorYearFicaWages`}
            label="Last year’s Social Security wages"
            tip="Box 3 of last year's W-2. Under current law, higher earners must make catch-up contributions as Roth; this value decides whether that applies in the first year."
            example="Leave blank if unknown."
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Part-time work (optional)</legend>
          {employment.partTime ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <IntegerField control={control} name={`${base}.partTime.startAge`} label="From age" />
              <IntegerField control={control} name={`${base}.partTime.endAge`} label="Until age (not including)" />
              <MoneyField
                control={control}
                name={`${base}.partTime.annualIncome`}
                label="Part-time income per year"
                tip="In today's dollars; it grows with inflation. Social Security and Medicare taxes apply; plan contributions from part-time pay are not modeled."
                example="For example $25,000."
              />
              <div className="sm:col-span-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => set(`${base}.partTime`, null)}>
                  <Trash2 aria-hidden="true" /> Remove part-time work
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  set(`${base}.partTime`, {
                    startAge: person.retirementAge,
                    endAge: person.retirementAge + 5,
                    annualIncome: 2_500_000,
                  })
                }
              >
                <Plus aria-hidden="true" /> Add a part-time phase
              </Button>
            </div>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
