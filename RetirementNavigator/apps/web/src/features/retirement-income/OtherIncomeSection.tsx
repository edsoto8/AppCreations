import { Plus } from 'lucide-react';
import { useController } from 'react-hook-form';
import type { Household } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/form/Field';
import { IntegerInput } from '@/components/form/inputs';
import { IntegerField, MoneyField, PercentField, TextField } from '@/components/form/fields';
import { CURRENT_YEAR } from '@/app/env';
import { newId } from '@/lib/ids';
import { GrowthModeField, ItemHeader, OwnerField } from './formParts';
import { setter, type HouseholdControl, type HouseholdForm } from './formHelpers';

type IncomeSource = Household['otherIncome'][number];

/** End year: blank means "through the end of the plan" (null). */
function EndYearField({ control, name }: { control: HouseholdControl; name: string }) {
  const { field, fieldState } = useController({ control, name: name as never });
  const value = (field.value as number | null | undefined) ?? null;
  return (
    <Field
      label="Last year (optional)"
      tip="The last calendar year the income is received. Leave blank for the rest of the plan."
      example="Blank: continues through the plan."
      error={fieldState.error?.message}
    >
      {(a) => (
        <div className="flex items-center gap-2">
          <IntegerInput {...a} value={value} onChange={field.onChange} />
          {value !== null ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange(null)}>
              Clear
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  );
}

export function OtherIncomeSection({ form, values }: { form: HouseholdForm; values: Household }) {
  const control = form.control as HouseholdControl;
  const set = setter(form);
  const items = values.otherIncome;

  const add = () => {
    const item: IncomeSource = {
      id: newId('income') as never,
      name: `Income ${items.length + 1}`,
      ownerId: null,
      startYear: CURRENT_YEAR,
      endYear: null,
      annualAmount: 0 as never,
      growth: { mode: 'inflation' },
      taxableFraction: 1,
    };
    set('otherIncome', [...items, item]);
  };

  return (
    <Card aria-labelledby="other-income-title">
      <CardHeader>
        <CardTitle id="other-income-title">Other income</CardTitle>
        <CardDescription>
          Recurring income that is not salary, Social Security or a pension, such as rent, consulting or a purchased
          annuity. Income owned by one person stops at their death.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No other income in this plan.</p> : null}
        {items.map((item, i) => {
          const base = `otherIncome.${i}`;
          return (
            <section
              key={item.id}
              aria-label={`Other income: ${item.name || `Income ${i + 1}`}`}
              className="flex flex-col gap-4 rounded-md border p-4"
            >
              <ItemHeader
                title={item.name || `Income ${i + 1}`}
                removeLabel={`Remove the income ${item.name}`}
                onRemove={() =>
                  set(
                    'otherIncome',
                    items.filter((_, j) => j !== i),
                  )
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={control}
                  name={`${base}.name` as never}
                  label="Name"
                  example="For example Rental."
                />
                <OwnerField
                  control={control}
                  name={`${base}.ownerId`}
                  people={values.people}
                  allowHousehold
                  label="Received by"
                  tip="Owned income stops after that person’s death; household income continues."
                />
                <MoneyField
                  control={control}
                  name={`${base}.annualAmount` as never}
                  label="Annual amount"
                  tip="Yearly amount before taxes, in today’s dollars."
                  example="For example $18,000."
                />
                <IntegerField
                  control={control}
                  name={`${base}.startYear` as never}
                  label="First year"
                  example={`A calendar year, for example ${CURRENT_YEAR}.`}
                />
                <EndYearField control={control} name={`${base}.endYear`} />
                <GrowthModeField
                  form={form}
                  path={`${base}.growth`}
                  value={item.growth}
                  label="Yearly change"
                  tip="How the amount changes each year."
                  example="Default: rises with inflation."
                />
                <PercentField
                  control={control}
                  name={`${base}.taxableFraction` as never}
                  label="Taxable share"
                  tip="The part of the income that is taxable."
                  example="Usually 100%."
                />
              </div>
            </section>
          );
        })}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={items.length >= 20}>
            <Plus aria-hidden="true" /> Add other income
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
