/**
 * Forecast settings (Profile page): withdrawal timing, granularity, withdrawal order, surplus
 * destination, the optimistic / pessimistic return offsets and the minimum ending balance.
 * Every field is validated by the engine's HouseholdSchema through the profile form.
 */
import { useController, useWatch, type Control } from 'react-hook-form';
import type { Household, HouseholdInput } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Field } from '@/components/form/Field';
import { PercentInput } from '@/components/form/inputs';
import { MoneyField, PercentField, SelectField } from '@/components/form/fields';
import { ACCOUNT_TYPE_LABELS } from '@/features/accounts/accountModel';

type HouseholdControl = Control<HouseholdInput, unknown, Household>;

const SURPLUS_TYPES = new Set(['taxableBrokerage', 'cash', 'other']);

const STRATEGIES = [
  { value: 'taxableFirst', label: 'Taxable first (default)' },
  { value: 'traditionalFirst', label: 'Tax-deferred first' },
  { value: 'rothLast', label: 'Roth last' },
  { value: 'proportional', label: 'Proportional' },
  { value: 'bracketFill', label: 'Bracket fill (needs verified tax brackets)' },
] as const;

/** The order each strategy draws accounts in (docs/financial-model.md §7.3). */
const STRATEGY_ORDER: Record<(typeof STRATEGIES)[number]['value'], string> = {
  taxableFirst: 'Order: cash, then taxable, then tax-deferred, then Roth, then HSA.',
  traditionalFirst: 'Order: tax-deferred, then cash, then taxable, then Roth, then HSA.',
  rothLast: 'Order: cash, taxable and tax-deferred together, then HSA, then Roth.',
  proportional: 'Order: every account at once, in proportion to its balance.',
  bracketFill:
    'Order: tax-deferred up to the top of the chosen bracket, then cash, taxable, Roth and HSA. While tax brackets are unverified it uses the taxable-first order.',
};

/** A return offset in percentage points, with a range message in plain words. */
function OffsetField({
  control,
  name,
  label,
  tip,
  example,
  range,
}: {
  control: HouseholdControl;
  name: 'assumptions.deterministicOffsets.optimistic' | 'assumptions.deterministicOffsets.pessimistic';
  label: string;
  tip: string;
  example: string;
  range: string;
}) {
  const { field, fieldState } = useController({ control, name });
  const error = fieldState.error;
  const message =
    error?.type === 'too_big' || error?.type === 'too_small' ? `Must be between ${range} points` : error?.message;
  return (
    <Field label={label} tip={tip} example={example} error={message}>
      {(a) => <PercentInput {...a} value={(field.value as number | null) ?? null} onChange={field.onChange} />}
    </Field>
  );
}

function SurplusField({ control, accounts }: { control: HouseholdControl; accounts: Household['accounts'] }) {
  const { field, fieldState } = useController({ control, name: 'assumptions.surplus' });
  const value = field.value as HouseholdInput['assumptions']['surplus'];
  const nested = fieldState.error as { message?: string; accountId?: { message?: string } } | undefined;
  const error = nested?.message ?? nested?.accountId?.message;
  const eligible = accounts.filter((a) => SURPLUS_TYPES.has(a.type));
  const current = value && value.mode === 'account' ? value.accountId : null;
  const options = [
    ...eligible,
    ...accounts.filter((a) => a.id === current && !SURPLUS_TYPES.has(a.type)), // keep an invalid choice visible
  ];
  return (
    <Field
      label="Surplus while working"
      tip="What happens to take-home pay left over after taxes, contributions and spending in working years. It can only go to a taxable brokerage, cash or other account, so it never bypasses plan, IRA or HSA limits. It needs verified tax rules to compute take-home pay; until then no surplus is added."
      example="Default: spent (not saved)."
      error={error}
    >
      {(a) => (
        <NativeSelect
          {...a}
          value={current === null ? 'spent' : `account:${current}`}
          onChange={(e) => {
            const v = e.target.value;
            field.onChange(
              v === 'spent' ? { mode: 'spent' } : { mode: 'account', accountId: v.slice('account:'.length) },
            );
          }}
        >
          <option value="spent">Spent (not saved)</option>
          {options.map((acct) => (
            <option key={acct.id} value={`account:${acct.id}`}>
              Saved to {acct.name} ({ACCOUNT_TYPE_LABELS[acct.type]})
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

export function ForecastSettings({
  control,
  accounts,
}: {
  control: HouseholdControl;
  accounts: Household['accounts'];
}) {
  const strategy = useWatch({ control, name: 'assumptions.withdrawalStrategy' }) ?? 'taxableFirst';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecast settings</CardTitle>
        <CardDescription>
          How the dashboard forecast is run. Labeled assumptions with documented defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="assumptions.withdrawalTiming"
          label="Withdrawal timing"
          tip="When retirement withdrawals happen within each year. Mid-year withdrawals earn half a year of growth; start-of-year withdrawals earn none, which is more conservative."
          example="Default: mid-year."
          options={[
            { value: 'midYear', label: 'Mid-year (default)' },
            { value: 'startOfYear', label: 'Start of year (conservative)' },
          ]}
        />
        <SelectField
          control={control}
          name="assumptions.granularity"
          label="Forecast granularity"
          tip="Annual steps a year at a time. Monthly applies growth and flows month by month; with mid-year timing the results differ from annual by under 0.75% of each year’s net flow (returns between −15% and +15%); with start-of-year timing the difference is larger (about 3% at a 7% return). Monthly applies to the deterministic forecast only."
          example="Default: annual."
          options={[
            { value: 'annual', label: 'Annual (default)' },
            { value: 'monthly', label: 'Monthly (deterministic only)' },
          ]}
        />
        <SelectField
          control={control}
          name="assumptions.withdrawalStrategy"
          label="Withdrawal order"
          tip="Which accounts fund retirement spending first. Within a group, accounts are drawn in proportion to what each can provide. Bracket fill draws tax-deferred money until taxable income reaches the top of a chosen bracket; it needs verified tax brackets and uses taxable-first until then."
          example={STRATEGY_ORDER[strategy]}
          options={STRATEGIES}
          className="sm:col-span-2"
        />
        {strategy === 'bracketFill' ? (
          <PercentField
            control={control}
            name="assumptions.bracketFillTopRate"
            label="Bracket to fill (its tax rate)"
            tip="Tax-deferred withdrawals fill taxable income up to the top of the federal bracket with this rate (for example the 12% bracket). Enter a rate from your bracket table; it is your choice, not a rule value."
            example="For example 12. Leave empty to use taxable first."
          />
        ) : null}
        <SurplusField control={control} accounts={accounts} />
        <MoneyField
          control={control}
          name="assumptions.minimumEndingBalance"
          label="Minimum ending balance"
          tip="In today’s dollars. A forecast counts as lasting only if it never runs out and ends with at least this much (for example, to leave a legacy or keep a reserve)."
          example="Default $0."
        />
        <OffsetField
          control={control}
          name="assumptions.deterministicOffsets.optimistic"
          label="Optimistic return offset"
          tip="Percentage points added to every account’s return for the optimistic line. It is a fixed return offset, not a confidence interval."
          example="Default +2 points (enter 2)."
          range="0 and +10"
        />
        <OffsetField
          control={control}
          name="assumptions.deterministicOffsets.pessimistic"
          label="Pessimistic return offset"
          tip="Percentage points added to every account’s return for the pessimistic line (a negative number). It is a fixed return offset, not a confidence interval; readiness uses this run."
          example="Default −2 points (enter -2)."
          range="−10 and 0"
        />
      </CardContent>
    </Card>
  );
}
