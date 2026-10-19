import { Plus } from 'lucide-react';
import type { Household } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { IntegerField, MoneyField, PercentField, SelectField, TextField } from '@/components/form/fields';
import { newId } from '@/lib/ids';
import { AccountField, GrowthModeField, ItemHeader, OwnerField } from './formParts';
import { errorAt, setter, type HouseholdControl, type HouseholdForm } from './formHelpers';
import { lumpSumDestinations } from './model';

type Pension = Household['pensions'][number];

export function PensionsSection({ form, values }: { form: HouseholdForm; values: Household }) {
  const control = form.control as HouseholdControl;
  const set = setter(form);
  const pensions = values.pensions;
  const people = values.people;
  const couple = people.length > 1;

  const add = () => {
    const owner = people[0];
    const pension: Pension = {
      id: newId('pension') as never,
      name: `Pension ${pensions.length + 1}`,
      ownerId: (owner?.id ?? '') as never,
      startAge: owner?.retirementAge ?? 65,
      annualAmount: 0 as never,
      amountBasis: 'todaysDollars',
      cola: { mode: 'flat' },
      taxableFraction: 1,
      payout: { kind: 'annuity' },
      survivorFraction: 1,
    };
    set('pensions', [...pensions, pension]);
  };

  return (
    <Card aria-labelledby="pensions-title">
      <CardHeader>
        <CardTitle id="pensions-title">Pensions</CardTitle>
        <CardDescription>
          A defined-benefit pension paid for life (an annuity) or once as a lump sum rolled into an account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {pensions.length === 0 ? <p className="text-sm text-muted-foreground">No pensions in this plan.</p> : null}
        {pensions.map((pension, i) => {
          const base = `pensions.${i}`;
          const owner = people.find((p) => p.id === pension.ownerId);
          const lumpSum = pension.payout.kind === 'lumpSum';
          return (
            <section
              key={pension.id}
              aria-label={`Pension: ${pension.name || `Pension ${i + 1}`}`}
              className="flex flex-col gap-4 rounded-md border p-4"
            >
              <ItemHeader
                title={pension.name || `Pension ${i + 1}`}
                removeLabel={`Remove the pension ${pension.name}`}
                onRemove={() =>
                  set(
                    'pensions',
                    pensions.filter((_, j) => j !== i),
                  )
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={control}
                  name={`${base}.name` as never}
                  label="Name"
                  example="For example State pension."
                />
                <OwnerField control={control} name={`${base}.ownerId`} people={people} label="Paid to" />
                <IntegerField
                  control={control}
                  name={`${base}.startAge` as never}
                  label="Starts at age"
                  tip="Payments start in the year the owner reaches this age."
                  example={owner ? `${owner.name}’s age. For example ${owner.retirementAge}.` : 'For example 65.'}
                />
                <Field
                  label="Paid as"
                  tip="An annuity pays every year for life. A lump sum is paid once at the start age and rolled into an account."
                  example={lumpSum ? 'Paid once, into the account below.' : 'Paid every year from the start age.'}
                >
                  {(a) => (
                    <NativeSelect
                      {...a}
                      value={pension.payout.kind}
                      onChange={(e) => {
                        const destination = lumpSumDestinations(values, pension.ownerId)[0];
                        set(
                          `${base}.payout`,
                          e.target.value === 'lumpSum'
                            ? { kind: 'lumpSum', amount: 0, destinationAccountId: destination?.id ?? '' }
                            : { kind: 'annuity' },
                        );
                      }}
                    >
                      <option value="annuity">Annuity (every year for life)</option>
                      <option value="lumpSum">Lump sum (paid once)</option>
                    </NativeSelect>
                  )}
                </Field>
                {lumpSum ? (
                  <>
                    <MoneyField
                      control={control}
                      name={`${base}.payout.amount` as never}
                      label="Lump-sum amount"
                      tip="In future (nominal) dollars at the start age, as the plan states it."
                      example="For example $250,000."
                    />
                    <PensionDestination form={form} index={i} pension={pension} values={values} />
                  </>
                ) : (
                  <>
                    <MoneyField
                      control={control}
                      name={`${base}.annualAmount` as never}
                      label="Annual amount"
                      tip="The yearly pension before taxes."
                      example="For example $24,000 a year."
                    />
                    <SelectField
                      control={control}
                      name={`${base}.amountBasis` as never}
                      label="Amount is stated in"
                      tip="Today’s dollars rise with inflation until the start age. Future dollars are the amount the plan will pay at the start age."
                      options={[
                        { value: 'todaysDollars', label: 'Today’s dollars' },
                        { value: 'nominalAtStart', label: 'Future dollars at the start age' },
                      ]}
                    />
                    <GrowthModeField
                      form={form}
                      path={`${base}.cola`}
                      value={pension.cola}
                      label="Cost-of-living adjustment"
                      tip="How the payment changes each year after it starts."
                      example="Many private pensions stay flat."
                    />
                    {couple ? (
                      <PercentField
                        control={control}
                        name={`${base}.survivorFraction` as never}
                        label="Continues to a surviving spouse"
                        tip="The share of the payment that continues after the owner’s death (a joint-and-survivor option)."
                        example="Default 100%. Use 0% for a single-life pension."
                      />
                    ) : (
                      <p className="self-end text-xs text-muted-foreground">
                        Payments stop at the owner’s death (single person).
                      </p>
                    )}
                  </>
                )}
                <PercentField
                  control={control}
                  name={`${base}.taxableFraction` as never}
                  label="Taxable share"
                  tip="The part of each payment that is taxable income. Usually 100%, less if you made after-tax contributions."
                  example={lumpSum ? 'A rollover into a tax-deferred account is not taxed when paid.' : 'Usually 100%.'}
                />
              </div>
              {errorAt(form, base) ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {errorAt(form, base)}
                </p>
              ) : null}
            </section>
          );
        })}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={pensions.length >= 10}>
            <Plus aria-hidden="true" /> Add a pension
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PensionDestination({
  form,
  index,
  pension,
  values,
}: {
  form: HouseholdForm;
  index: number;
  pension: Pension;
  values: Household;
}) {
  const eligible = lumpSumDestinations(values, pension.ownerId);
  if (eligible.length === 0 && pension.payout.kind === 'lumpSum' && !pension.payout.destinationAccountId) {
    return (
      <p role="alert" className="text-sm text-destructive sm:col-span-2">
        A lump sum needs an account to roll into: add a traditional IRA, brokerage or cash account on the Accounts page.
      </p>
    );
  }
  return (
    <AccountField
      control={form.control as HouseholdControl}
      name={`pensions.${index}.payout.destinationAccountId`}
      eligible={eligible}
      all={values.accounts}
      label="Rolled into"
      tip="The owner’s tax-deferred account (a rollover, untaxed when paid), or a brokerage or cash account (taxed by the taxable share). Roth accounts and HSAs are not offered."
      example="The lump sum is deposited mid-year."
    />
  );
}
