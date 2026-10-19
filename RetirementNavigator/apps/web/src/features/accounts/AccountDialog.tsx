import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  useController,
  useForm,
  useWatch,
  type Control,
  type Path,
  type UseFormSetValue,
  type UseFormTrigger,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Account, AccountType, Household } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/form/Field';
import { MoneyField, PercentField, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { formatPercent } from '@/lib/format';
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_CONTRIBUTION,
  FORM_ROOT,
  PLAN_TYPE_LABELS,
  TAX_TREATMENT_LABELS,
  accountFormSchema,
  accountTypeLabel,
  friendlyIssue,
  isWorkplace,
  linkedPlanOf,
  newAccountDraft,
  supportsMaxAllowed,
  taxTreatmentOf,
  upsertAccount,
  type AccountInput,
} from './accountModel';
import { useCommitHousehold } from './useCommitHousehold';

type AccountControl = Control<AccountInput, unknown, Account>;
/** Field names in the union of account shapes (react-hook-form paths). */
const p = (name: string) => name as Path<AccountInput>;

export interface AccountDialogProps {
  household: Household;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account to edit; omit to add a new one. */
  account?: Account;
  /** New account presets. */
  initialType?: AccountType;
  initialOwnerId?: string;
  /** Hide the type picker for a new account (e.g. "Add a Roth IRA"). */
  lockType?: boolean;
  onSaved?: (account: Account) => void;
}

/** Add or edit one account. Validated by the engine's AccountSchema and HouseholdSchema. */
export function AccountDialog(props: AccountDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">{props.open ? <AccountForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}

const TAX_TREATMENT_OPTIONS = (['taxDeferred', 'taxFree', 'taxable'] as const).map((value) => ({
  value,
  label: TAX_TREATMENT_LABELS[value],
}));
const PLAN_OPTIONS = (['401k', '403b', '457b'] as const).map((value) => ({ value, label: PLAN_TYPE_LABELS[value] }));

function AccountForm({
  household,
  onOpenChange,
  account,
  initialType = 'taxableBrokerage',
  initialOwnerId,
  lockType = false,
  onSaved,
}: AccountDialogProps) {
  const commit = useCommitHousehold();
  const schema = useMemo(() => accountFormSchema(household), [household]);
  const firstOwner = initialOwnerId ?? household.people[0]?.id ?? '';
  const form = useForm<AccountInput, unknown, Account>({
    resolver: zodResolver(schema, { error: (issue) => friendlyIssue(issue) }),
    mode: 'onChange',
    defaultValues: account ?? newAccountDraft(initialType, firstOwner),
  });
  const { control, handleSubmit, formState } = form;
  const values = useWatch({ control }) as Partial<AccountInput>;
  const type = values.type ?? initialType;
  const [saveError, setSaveError] = useState<string[]>([]);

  const linkedPlan = account ? linkedPlanOf(household, account.id) : null;

  const ownerOptions = household.people.map((person) => ({ value: person.id, label: person.name }));
  const isNew = !account;
  const title = isNew ? `Add ${lockType ? accountTypeLabel({ type }) : 'an account'}` : `Edit ${account.name}`;

  const changeType = (next: AccountType) => {
    const current = form.getValues();
    const keepName = current.name && !current.name.startsWith('New ') ? current.name : undefined;
    form.reset(
      newAccountDraft(next, current.ownerId, {
        id: current.id,
        name: keepName,
        balance: current.balance,
        expectedReturn: current.expectedReturn,
        expenseRatio: current.expenseRatio,
        allocation: current.allocation,
      }),
    );
  };

  const onSubmit = handleSubmit((saved) => {
    const result = commit(upsertAccount(household, saved));
    if (result.ok) {
      setSaveError([]);
      onSaved?.(saved);
      onOpenChange(false);
    } else {
      setSaveError(result.messages);
    }
  });

  const rootError = (formState.errors as Record<string, { message?: string } | undefined>)[FORM_ROOT]?.message;
  const allocationError = (formState.errors as { allocation?: { message?: string } }).allocation?.message;

  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>
        {isNew
          ? 'Enter the current balance and, where relevant, how much goes in each year.'
          : `${accountTypeLabel(account)} · ${TAX_TREATMENT_LABELS[taxTreatmentOf(account)]}`}
      </DialogDescription>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {isNew && !lockType ? (
          <Field
            label="Account type"
            tip="The type sets the tax treatment and which contribution limits apply."
            example="For example, Roth IRA or taxable brokerage"
          >
            {(a) => (
              <NativeSelect {...a} value={type} onChange={(e) => changeType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Account name" example="For example, “Vanguard Roth IRA”" />
          <SelectField
            control={control}
            name="ownerId"
            label="Owner"
            tip="The person whose account this is. Limits, ages and earned income are this person’s."
            example={linkedPlan ? 'Set by the linked workplace plan' : 'Each account has one owner'}
            options={ownerOptions}
            disabled={!!linkedPlan}
          />
          <MoneyField
            control={control}
            name="balance"
            label="Current balance"
            tip="Today’s value of the account."
            example="For example, 25,000"
          />
          <TypeSpecificFields control={control} type={type} linked={!!linkedPlan} />
        </div>

        {isWorkplace({ type }) ? (
          <Alert>
            <p>
              Contributions and employer match for workplace plans come only from the owner’s plan settings on{' '}
              <Link to="/income" className="font-medium underline underline-offset-4">
                Income &amp; Savings
              </Link>
              .
              {linkedPlan
                ? ` This account is linked to ${linkedPlan.person.name}’s ${PLAN_TYPE_LABELS[linkedPlan.plan.planType]} plan, so its owner and plan type follow that plan.`
                : ' This account is not linked to a workplace plan yet; it grows from its balance until it is linked there.'}
            </p>
          </Alert>
        ) : null}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">Returns and fees</legend>
          <ExpectedReturnField control={control} household={household} setValue={form.setValue} />
          <PercentField
            control={control}
            name="expenseRatio"
            label="Expense ratio"
            tip="The fund’s annual fee as a percent of the balance. Fees are modeled as return drag: they reduce the account’s return each year."
            example="For example, 0.05 for a broad index fund (0% to 5%)"
          />
          <AllocationFields control={control} error={allocationError} setValue={form.setValue} trigger={form.trigger} />
        </fieldset>

        {!isWorkplace({ type }) ? <ContributionFields control={control} type={type} setValue={form.setValue} /> : null}

        {rootError ? (
          <Alert variant="destructive" role="alert">
            <p>{rootError}</p>
          </Alert>
        ) : null}
        {saveError.length > 0 ? (
          <Alert variant="destructive" role="alert">
            <ul className="list-disc pl-4">
              {saveError.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit">{isNew ? 'Add account' : 'Save changes'}</Button>
        </div>
      </form>
    </>
  );
}

function TypeSpecificFields({
  control,
  type,
  linked,
}: {
  control: AccountControl;
  type: AccountType;
  linked: boolean;
}) {
  switch (type) {
    case 'workplaceTraditional':
    case 'workplaceRoth':
      return (
        <>
          <SelectField
            control={control}
            name={p('planType')}
            label="Plan type"
            tip="401(k), 403(b) and 457(b) plans have their own contribution rules; it must match the linked plan."
            example={linked ? 'Set by the linked workplace plan' : 'For example, 401(k)'}
            options={PLAN_OPTIONS}
            disabled={linked}
          />
          <MoneyField
            control={control}
            name={p('unvestedEmployerBalance')}
            label="Unvested employer money"
            tip="The part of the balance from employer contributions you would lose if you left today (not yet vested)."
            example="For example, 0 if fully vested"
          />
        </>
      );
    case 'rothIra':
      return (
        <>
          <MoneyField
            control={control}
            name={p('contributionBasis')}
            label="Contribution basis"
            tip="The total you have contributed (not earnings). It can come out tax- and penalty-free; it cannot exceed the balance."
            example="For example, 30,000 contributed of a 41,000 balance"
          />
          <OptionalYearField
            control={control}
            name={p('firstContributionYear')}
            label="First Roth IRA contribution year"
            tip="Starts the 5-year clock for qualified (tax-free) withdrawals of earnings. Leave blank if unknown."
            example="For example, 2015 (blank = unknown)"
          />
        </>
      );
    case 'hsa':
      return (
        <>
          <SelectField
            control={control}
            name={p('coverage')}
            label="HDHP coverage type"
            tip="Self-only or family coverage under a high-deductible health plan sets the HSA contribution limit."
            example="Family if the plan covers anyone besides you"
            options={[
              { value: 'selfOnly', label: 'Self-only' },
              { value: 'family', label: 'Family' },
            ]}
          />
          <SwitchField
            control={control}
            name={p('hdhpAttested')}
            label="Covered by a high-deductible health plan (HDHP)"
            tip="HSA contributions are allowed only while covered by an HDHP. Without it, the model contributes nothing."
            example="On if your health plan is HSA-eligible"
          />
        </>
      );
    case 'taxableBrokerage':
      return (
        <MoneyField
          control={control}
          name={p('costBasis')}
          label="Cost basis"
          tip="What you paid for the investments. Gains above basis are taxed when sold."
          example="For example, 38,000 paid for holdings worth 52,000"
        />
      );
    case 'other':
      return (
        <SelectField
          control={control}
          name={p('taxTreatment')}
          label="Tax treatment"
          tip="Tax-deferred: taxed on withdrawal. Tax-free: qualified withdrawals untaxed. Taxable: gains taxed along the way."
          example="For example, taxable for a savings bond fund"
          options={TAX_TREATMENT_OPTIONS}
        />
      );
    default:
      return null;
  }
}

function ExpectedReturnField({
  control,
  household,
  setValue,
}: {
  control: AccountControl;
  household: Household;
  setValue: UseFormSetValue<AccountInput>;
}) {
  const value = useWatch({ control, name: 'expectedReturn' });
  const useHousehold = value === null || value === undefined;
  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Use the household return assumption"
        tip="Off: enter this account’s own expected return. On: the household’s return assumption applies (or the allocation-based return if an allocation is set)."
        example={`Household assumption: ${formatPercent(household.assumptions.returnPreRetirement)} before retirement, ${formatPercent(household.assumptions.returnPostRetirement)} after`}
      >
        {(a) => (
          <Switch
            id={a.id}
            aria-describedby={a['aria-describedby']}
            checked={useHousehold}
            onCheckedChange={(on) =>
              setValue('expectedReturn', on ? null : household.assumptions.returnPreRetirement, {
                shouldValidate: true,
              })
            }
          />
        )}
      </Field>
      {!useHousehold ? (
        <PercentField
          control={control}
          name="expectedReturn"
          label="Expected annual return"
          tip="Median (geometric) nominal annual return for this account, before the expense ratio."
          example="For example, 6 for 6% a year"
        />
      ) : null}
    </div>
  );
}

function AllocationFields({
  control,
  error,
  setValue,
  trigger,
}: {
  control: AccountControl;
  error?: string;
  setValue: UseFormSetValue<AccountInput>;
  trigger: UseFormTrigger<AccountInput>;
}) {
  const value = useWatch({ control, name: 'allocation' });
  const enabled = value !== null && value !== undefined;
  // The "must total 100%" rule sits on the allocation object, which per-field validation of the three
  // shares does not surface; validate the object whenever a share changes.
  const { stocks, bonds, cash } = value ?? {};
  useEffect(() => {
    if (enabled) void trigger('allocation');
  }, [enabled, stocks, bonds, cash, trigger]);
  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Set an asset allocation"
        tip="The mix of stocks, bonds and cash. Used for allocation views and Monte Carlo; without it the account uses a blended return."
        example="Optional"
      >
        {(a) => (
          <Switch
            id={a.id}
            aria-describedby={a['aria-describedby']}
            checked={enabled}
            onCheckedChange={(on) =>
              setValue('allocation', on ? { stocks: 0.6, bonds: 0.4, cash: 0 } : null, { shouldValidate: true })
            }
          />
        )}
      </Field>
      {enabled ? (
        <div className="flex flex-col gap-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <PercentField
              control={control}
              name={p('allocation.stocks')}
              label="Stocks"
              tip="Share of the account in stock funds."
              example="For example, 60"
            />
            <PercentField
              control={control}
              name={p('allocation.bonds')}
              label="Bonds"
              tip="Share of the account in bond funds."
              example="For example, 40"
            />
            <PercentField
              control={control}
              name={p('allocation.cash')}
              label="Cash"
              tip="Share in cash or money-market funds."
              example="For example, 0"
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">The three shares must total 100%.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

type AmountKind = 'dollars' | 'percentOfSalary' | 'maxAllowed';
type GrowthMode = 'flat' | 'inflation' | 'rate';

function ContributionFields({
  control,
  type,
  setValue,
}: {
  control: AccountControl;
  type: AccountType;
  setValue: UseFormSetValue<AccountInput>;
}) {
  const schedule = useWatch({ control, name: p('contribution') }) as typeof DEFAULT_CONTRIBUTION | null | undefined;
  const enabled = schedule !== null && schedule !== undefined;
  const kind = schedule?.amount.kind;
  const growth = schedule?.growth?.mode ?? 'flat';
  const set = (name: string, value: unknown) =>
    setValue(p(name), value as never, { shouldValidate: true, shouldDirty: true });

  const setKind = (next: AmountKind) => {
    set(
      'contribution.amount',
      next === 'dollars'
        ? { kind: 'dollars', amount: 0, frequency: 'annual' }
        : next === 'percentOfSalary'
          ? { kind: 'percentOfSalary', pct: 0 }
          : { kind: 'maxAllowed' },
    );
    if (next !== 'dollars') set('contribution.growth', { mode: 'flat' });
  };
  const setGrowth = (next: GrowthMode) =>
    set('contribution.growth', next === 'rate' ? { mode: 'rate', rate: 0.02 } : { mode: next });

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-sm font-semibold">Contributions</legend>
      <Field
        label="Contributes each year"
        tip="A recurring contribution to this account. IRA and HSA contributions are capped at the year’s allowed amount, with a warning."
        example="Off if nothing new goes in"
      >
        {(a) => (
          <Switch
            id={a.id}
            aria-describedby={a['aria-describedby']}
            checked={enabled}
            onCheckedChange={(on) => set('contribution', on ? DEFAULT_CONTRIBUTION : null)}
          />
        )}
      </Field>
      {enabled ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Contribution amount type"
            tip="A dollar amount, a share of base salary, or the maximum allowed for the year (IRA and HSA only)."
            example="For example, a dollar amount each month"
          >
            {(a) => (
              <NativeSelect {...a} value={kind} onChange={(e) => setKind(e.target.value as AmountKind)}>
                <option value="dollars">Dollar amount</option>
                <option value="percentOfSalary">Percent of salary</option>
                {supportsMaxAllowed(type) ? <option value="maxAllowed">Maximum allowed</option> : null}
              </NativeSelect>
            )}
          </Field>
          {kind === 'dollars' ? (
            <>
              <MoneyField
                control={control}
                name={p('contribution.amount.amount')}
                label="Contribution amount"
                tip="The amount added per period, in today’s dollars for the first year."
                example="For example, 250"
              />
              <SelectField
                control={control}
                name={p('contribution.amount.frequency')}
                label="Frequency"
                tip="How often the amount above is contributed."
                example="Monthly amounts are added up for the year"
                options={[
                  { value: 'annual', label: 'Per year' },
                  { value: 'monthly', label: 'Per month' },
                ]}
              />
              <Field
                label="Contribution growth"
                tip="Whether the dollar amount stays flat, rises with inflation, or rises at a set rate each year."
                example="For example, grow with inflation"
              >
                {(a) => (
                  <NativeSelect {...a} value={growth} onChange={(e) => setGrowth(e.target.value as GrowthMode)}>
                    <option value="flat">Stays flat</option>
                    <option value="inflation">Grows with inflation</option>
                    <option value="rate">Grows at a set rate</option>
                  </NativeSelect>
                )}
              </Field>
              {growth === 'rate' ? (
                <PercentField
                  control={control}
                  name={p('contribution.growth.rate')}
                  label="Growth rate"
                  tip="Annual increase in the contribution amount (nominal)."
                  example="For example, 3"
                />
              ) : null}
            </>
          ) : null}
          {kind === 'percentOfSalary' ? (
            <PercentField
              control={control}
              name={p('contribution.amount.pct')}
              label="Percent of base salary"
              tip="A share of the owner’s base salary each year; it rises with raises."
              example="For example, 5"
            />
          ) : null}
          {kind === 'maxAllowed' ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Contributes the year’s allowed maximum after eligibility and earned-income caps. When a needed limit is
              unverified, the amount is shown as unverified rather than estimated.
            </p>
          ) : null}
          <OptionalYearField
            control={control}
            name={p('contribution.startYear')}
            label="Start year"
            tip="First calendar year of contributions."
            example="Blank = this year"
          />
          <OptionalYearField
            control={control}
            name={p('contribution.stopYear')}
            label="Stop year"
            tip="Last calendar year of contributions (inclusive)."
            example="Blank = the owner’s last working year"
          />
        </div>
      ) : null}
    </fieldset>
  );
}

/** Calendar year that may be left blank (null). */
function OptionalYearField({
  control,
  name,
  label,
  tip,
  example,
}: {
  control: AccountControl;
  name: Path<AccountInput>;
  label: string;
  tip: string;
  example: string;
}) {
  const { field, fieldState } = useController({ control, name });
  const value = (field.value as number | null | undefined) ?? null;
  // The field remounts whenever its value is replaced from outside (type change, toggling the schedule).
  const [text, setText] = useState(value === null ? '' : String(value));
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <Field label={label} tip={tip} example={example} error={typed ?? fieldState.error?.message}>
      {(a) => (
        <Input
          {...a}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const trimmed = next.trim();
            if (trimmed === '') {
              setTyped(null);
              field.onChange(null);
            } else if (/^\d{4}$/.test(trimmed)) {
              setTyped(null);
              field.onChange(Number(trimmed));
            } else {
              setTyped('Enter a four-digit year, or leave blank');
            }
          }}
          onBlur={field.onBlur}
        />
      )}
    </Field>
  );
}
