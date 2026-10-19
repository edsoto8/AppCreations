import { Plus } from 'lucide-react';
import type { Household } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { IntegerField, MoneyField, PercentField, SelectField, TextField } from '@/components/form/fields';
import { CURRENT_YEAR } from '@/app/env';
import { newId } from '@/lib/ids';
import { AccountField, ItemHeader } from './formParts';
import { setter, type HouseholdControl, type HouseholdForm } from './formHelpers';
import { inflowDestinations } from './model';

type OneTimeEvent = Household['oneTimeEvents'][number];

export function OneTimeEventsSection({ form, values }: { form: HouseholdForm; values: Household }) {
  const control = form.control as HouseholdControl;
  const set = setter(form);
  const events = values.oneTimeEvents;
  const destinations = inflowDestinations(values);

  const add = () => {
    const event: OneTimeEvent = {
      id: newId('event') as never,
      name: `Event ${events.length + 1}`,
      year: CURRENT_YEAR + 5,
      direction: 'outflow',
      amount: 0 as never,
      amountBasis: 'todaysDollars',
      taxTreatment: 'none',
      gainFraction: 0,
      destinationAccountId: null,
    };
    set('oneTimeEvents', [...events, event]);
  };

  return (
    <Card aria-labelledby="events-title">
      <CardHeader>
        <CardTitle id="events-title">One-time events</CardTitle>
        <CardDescription>
          Money in or out in a single year: an inheritance or home sale (in), or a large expense such as a new roof or a
          wedding (out). Expenses are paid like spending, from withdrawals.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {events.length === 0 ? <p className="text-sm text-muted-foreground">No one-time events in this plan.</p> : null}
        {events.map((event, i) => {
          const base = `oneTimeEvents.${i}`;
          const inflow = event.direction === 'inflow';
          return (
            <section
              key={event.id}
              aria-label={`One-time event: ${event.name || `Event ${i + 1}`}`}
              className="flex flex-col gap-4 rounded-md border p-4"
            >
              <ItemHeader
                title={event.name || `Event ${i + 1}`}
                removeLabel={`Remove the event ${event.name}`}
                onRemove={() =>
                  set(
                    'oneTimeEvents',
                    events.filter((_, j) => j !== i),
                  )
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={control}
                  name={`${base}.name` as never}
                  label="Name"
                  example="For example Home sale."
                />
                <IntegerField
                  control={control}
                  name={`${base}.year` as never}
                  label="Year"
                  example={`A calendar year, for example ${CURRENT_YEAR + 5}.`}
                />
                <Field
                  label="Money in or out"
                  example={inflow ? 'Deposited mid-year.' : 'Added to that year’s spending.'}
                >
                  {(a) => (
                    <NativeSelect
                      {...a}
                      value={event.direction}
                      onChange={(e) =>
                        set(
                          base,
                          e.target.value === 'inflow'
                            ? { ...event, direction: 'inflow' }
                            : {
                                ...event,
                                direction: 'outflow',
                                taxTreatment: 'none',
                                gainFraction: 0,
                                destinationAccountId: null,
                              },
                        )
                      }
                    >
                      <option value="outflow">Money out (an expense)</option>
                      <option value="inflow">Money in (an inheritance, sale or gift)</option>
                    </NativeSelect>
                  )}
                </Field>
                <MoneyField
                  control={control}
                  name={`${base}.amount` as never}
                  label="Amount"
                  example="For example $40,000."
                />
                <SelectField
                  control={control}
                  name={`${base}.amountBasis` as never}
                  label="Amount is stated in"
                  tip="Today’s dollars rise with inflation until the event year. Future dollars are the exact amount in that year."
                  options={[
                    { value: 'todaysDollars', label: 'Today’s dollars' },
                    { value: 'nominal', label: 'Future dollars in that year' },
                  ]}
                />
                {inflow ? (
                  <>
                    <SelectField
                      control={control}
                      name={`${base}.taxTreatment` as never}
                      label="Tax treatment"
                      tip="Untaxed: for example an inheritance of cash. Ordinary income: for example a taxable bonus or IRA distribution. Capital gain: for example a home or stock sale, where only the gain is taxed."
                      options={[
                        { value: 'none', label: 'Not taxed' },
                        { value: 'ordinaryIncome', label: 'Ordinary income' },
                        { value: 'capitalGain', label: 'Long-term capital gain' },
                      ]}
                    />
                    {event.taxTreatment === 'capitalGain' ? (
                      <PercentField
                        control={control}
                        name={`${base}.gainFraction` as never}
                        label="Taxable gain share"
                        tip="The part of the amount that is a taxable gain. For a home sale, the gain above your cost and any exclusion you qualify for."
                        example="For example 30%."
                      />
                    ) : null}
                    <AccountField
                      control={control}
                      name={`${base}.destinationAccountId`}
                      eligible={destinations}
                      all={values.accounts}
                      label="Deposited into"
                      tip="A brokerage, cash or other account. Retirement plans, IRAs and HSAs are not offered, so the deposit never bypasses their limits."
                      example="Default: where surplus cash goes, else the first brokerage or cash account."
                      defaultOption="Default account"
                    />
                  </>
                ) : null}
              </div>
            </section>
          );
        })}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={events.length >= 50}>
            <Plus aria-hidden="true" /> Add a one-time event
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
