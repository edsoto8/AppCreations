/**
 * Field groups shared by several calculators. Names are dot paths into the calculator's form values,
 * which have the shape of its engine input; errors come from the engine schema.
 */
import { useId } from 'react';
import { useController, useFieldArray, useFormState, useWatch, type Control, type FieldValues } from 'react-hook-form';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { IntegerField, MoneyField, PercentField, PercentSliderField, SelectField } from '@/components/form/fields';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type C = Control<FieldValues>;

const TAX_TREATMENT_OPTIONS = [
  { value: 'taxDeferred', label: 'Tax-deferred (traditional 401(k) or IRA)' },
  { value: 'taxFree', label: 'Tax-free (Roth)' },
  { value: 'taxable', label: 'Taxable brokerage' },
] as const;

const TIMING_OPTIONS = [
  { value: 'midYear', label: 'Evenly through the year' },
  { value: 'startOfYear', label: 'At the start of each year (conservative)' },
] as const;

/** A titled group of fields. */
export function FieldGroup({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-sm font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** Less common fields, collapsed; opens by itself when one of them has an error. */
export function MoreOptions({ control, names, children }: { control: C; names: string[]; children: React.ReactNode }) {
  const { errors } = useFormState({ control, name: names });
  const hasError = names.some((n) =>
    n.split('.').reduce<unknown>((e, k) => (e as Record<string, unknown> | undefined)?.[k], errors),
  );
  return (
    <details className="group rounded-md border" open={hasError || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        More options
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

export function ReturnSlider({ control, name, label, tip }: { control: C; name: string; label: string; tip?: string }) {
  return (
    <PercentSliderField
      control={control}
      name={name}
      label={label}
      min={-5}
      max={15}
      step={0.1}
      tip={tip ?? 'The yearly growth rate before inflation (nominal), applied every year in this calculator.'}
      example="For example, 6 for 6% a year."
    />
  );
}

export function InflationField({ control, name = 'inflation' }: { control: C; name?: string }) {
  return (
    <PercentField
      control={control}
      name={name}
      label="Inflation"
      tip="The yearly rise in prices. Today’s-dollar figures divide by the price level it implies."
      example="For example, 2.5 for 2.5% a year."
    />
  );
}

export function TaxTreatmentFields({ control }: { control: C }) {
  const treatment = useWatch({ control, name: 'taxTreatment' }) as string | undefined;
  return (
    <>
      <SelectField
        control={control}
        name="taxTreatment"
        label="Account type"
        options={TAX_TREATMENT_OPTIONS}
        tip="How withdrawals are taxed when tax rules are verified: tax-deferred withdrawals are income, Roth withdrawals are tax-free, and taxable-account sales owe tax on gains."
      />
      {treatment === 'taxable' ? <CostBasisField control={control} /> : null}
    </>
  );
}

function CostBasisField({ control }: { control: C }) {
  const { field } = useController({ control, name: 'costBasis' });
  const set = field.value !== null && field.value !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Enter a cost basis"
        checked={set}
        onChange={(on) => field.onChange(on ? 0 : null)}
        hint="Off: the cost basis equals the balance (no unrealized gain)."
      />
      {set ? (
        <MoneyField
          control={control}
          name="costBasis"
          label="Cost basis"
          tip="What was paid for the investments; gains above it are taxed when sold."
        />
      ) : null}
    </div>
  );
}

export function TimingField({ control }: { control: C }) {
  return (
    <SelectField
      control={control}
      name="withdrawalTiming"
      label="Withdrawal timing"
      options={TIMING_OPTIONS}
      tip="Withdrawals taken at the start of the year miss that year’s growth, a more conservative assumption."
    />
  );
}

export function ExpenseRatioField({ control, name = 'expenseRatio' }: { control: C; name?: string }) {
  return (
    <PercentField
      control={control}
      name={name}
      label="Expense ratio"
      tip="The yearly fund fee as a share of the balance, modeled as a drag on the return."
      example="For example, 0.1 for 0.1% a year."
    />
  );
}

/** A labeled switch on its own row. */
export function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={hint ? hintId : undefined} />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Claiming age as years and months (62 to 70). */
export function ClaimAgeFields({ control, name, label }: { control: C; name: string; label: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <IntegerField
        control={control}
        name={`${name}.years`}
        label={`${label}: years`}
        tip="The age benefits start, between 62 and 70."
      />
      <IntegerField control={control} name={`${name}.months`} label="Months" example="0 to 11." />
    </div>
  );
}

/**
 * Optional Social Security entered at the claiming age (the amount on the SSA statement for that
 * age; no rule value needed). Null when off.
 */
export function SocialSecurityAtClaimFields({
  control,
  name = 'socialSecurity',
  who = 'Social Security',
}: {
  control: C;
  name?: string;
  who?: string;
}) {
  const { field } = useController({ control, name });
  const on = field.value !== null && field.value !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label={`Include ${who}`}
        checked={on}
        onChange={(next) =>
          field.onChange(next ? { monthlyAtClaim: 200_000, claimAge: { years: 67, months: 0 } } : null)
        }
        hint="The monthly benefit at the claiming age, as the SSA statement lists it (today’s dollars)."
      />
      {on ? (
        <>
          <MoneyField
            control={control}
            name={`${name}.monthlyAtClaim`}
            label="Monthly benefit at the claiming age"
            tip="From the SSA statement, in today’s dollars. Benefits rise with inflation in this model."
          />
          <ClaimAgeFields control={control} name={`${name}.claimAge`} label="Claiming age" />
        </>
      ) : null}
    </div>
  );
}

/** The retirement-plan fields (savings gap, retirement age, Coast and Barista FIRE). */
export function PlanFieldGroups({
  control,
  showRetirementAge = true,
  afterAges,
  extraGroup,
}: {
  control: C;
  showRetirementAge?: boolean;
  /** Fields at the end of the ages group. */
  afterAges?: React.ReactNode;
  /** A group of its own after the ages. */
  extraGroup?: React.ReactNode;
}) {
  return (
    <>
      <FieldGroup legend="Ages">
        <IntegerField control={control} name="age" label="Current age" />
        {showRetirementAge ? (
          <IntegerField
            control={control}
            name="retirementAge"
            label="Retirement age"
            tip="Retirement starts on January 1 of the year this age is reached; contributions stop the year before."
          />
        ) : null}
        <IntegerField
          control={control}
          name="planningAge"
          label="Planning age"
          tip="How long the plan must last (a longevity assumption)."
        />
        {afterAges}
      </FieldGroup>
      {extraGroup}
      <FieldGroup legend="Savings">
        <MoneyField control={control} name="currentBalance" label="Savings today" />
        <MoneyField
          control={control}
          name="annualContribution"
          label="Yearly contribution"
          tip="In today’s dollars, rising with inflation, until the year before retirement."
        />
        <ReturnSlider control={control} name="returnBeforeRetirement" label="Return before retirement" />
        <ReturnSlider control={control} name="returnInRetirement" label="Return in retirement" />
        <InflationField control={control} />
      </FieldGroup>
      <FieldGroup legend="Retirement">
        <MoneyField
          control={control}
          name="retirementSpending"
          label="Yearly retirement spending"
          tip="A net (after-tax) need in today’s dollars, rising with inflation."
        />
        <SocialSecurityAtClaimFields control={control} />
      </FieldGroup>
      <MoreOptions
        control={control}
        names={['taxTreatment', 'costBasis', 'expenseRatio', 'withdrawalTiming', 'minimumEndingBalance']}
      >
        <TaxTreatmentFields control={control} />
        <ExpenseRatioField control={control} />
        <TimingField control={control} />
        <MoneyField
          control={control}
          name="minimumEndingBalance"
          label="Minimum ending balance"
          tip="Success also needs at least this much left at the planning age, in today’s dollars."
        />
      </MoreOptions>
    </>
  );
}

/** The drawdown fields (withdrawal and FI number). */
export function DrawdownFieldGroups({
  control,
  showBalance = true,
  rateField,
}: {
  control: C;
  showBalance?: boolean;
  rateField?: React.ReactNode;
}) {
  return (
    <>
      <FieldGroup legend="Plan">
        {showBalance ? <MoneyField control={control} name="startingBalance" label="Savings at the start" /> : null}
        {rateField}
        <IntegerField
          control={control}
          name="age"
          label="Age this year"
          tip="The plan is retired from this year and runs for the number of years below."
        />
        <IntegerField control={control} name="years" label="Years the plan must last" example="For example, 30." />
        <ReturnSlider control={control} name="annualReturn" label="Annual return" />
        <InflationField control={control} />
        <SocialSecurityAtClaimFields control={control} />
      </FieldGroup>
      <MoreOptions
        control={control}
        names={['taxTreatment', 'costBasis', 'expenseRatio', 'withdrawalTiming', 'minimumEndingBalance']}
      >
        <TaxTreatmentFields control={control} />
        <ExpenseRatioField control={control} />
        <TimingField control={control} />
        <MoneyField
          control={control}
          name="minimumEndingBalance"
          label="Minimum ending balance"
          tip="Success also needs at least this much left at the end, in today’s dollars."
        />
      </MoreOptions>
    </>
  );
}

/** The shared employer match rule: tiers of pay, an optional non-elective contribution. */
export function MatchFields({ control, name = 'match' }: { control: C; name?: string }) {
  const tiers = useFieldArray({ control, name: `${name}.tiers` });
  return (
    <FieldGroup legend="Employer match">
      <p className="text-xs text-muted-foreground">
        Tiers are consecutive bands of pay. Example: 100% of the first 3% of pay, then 50% of the next 2%.
      </p>
      <ol className="flex flex-col gap-3">
        {tiers.fields.map((tier, i) => (
          <li key={tier.id} className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Tier {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => tiers.remove(i)}
                aria-label={`Remove match tier ${i + 1}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PercentField
                control={control}
                name={`${name}.tiers.${i}.matchRate`}
                label={`Tier ${i + 1} match rate`}
                example="100 = dollar for dollar."
              />
              <PercentField
                control={control}
                name={`${name}.tiers.${i}.bandPctOfPay`}
                label={`Tier ${i + 1} share of pay`}
                example="The band of pay it covers."
              />
            </div>
          </li>
        ))}
      </ol>
      {tiers.fields.length < 5 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => tiers.append({ matchRate: 0.5, bandPctOfPay: 0.02 })}
        >
          <Plus aria-hidden="true" />
          Add a match tier
        </Button>
      ) : null}
      <PercentField
        control={control}
        name={`${name}.flatPctOfPay`}
        label="Non-elective employer contribution"
        tip="A share of pay the employer contributes whether or not you defer."
        example="For example, 3 for 3% of pay; 0 if none."
      />
    </FieldGroup>
  );
}

/** An error message for a whole array (for example "Each claiming age can be entered once"). */
export function ArrayError({ control, name }: { control: C; name: string }) {
  const { errors } = useFormState({ control, name });
  const node = name.split('.').reduce<unknown>((e, k) => (e as Record<string, unknown> | undefined)?.[k], errors) as
    { message?: string; root?: { message?: string } } | undefined;
  const message = node?.root?.message ?? node?.message;
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}
