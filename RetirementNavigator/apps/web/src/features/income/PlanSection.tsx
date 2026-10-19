import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import type { Control, UseFormReturn } from 'react-hook-form';
import type { Household, HouseholdInput, PersonPreviewRow } from '@rn/engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Field } from '@/components/form/Field';
import { IntegerField, PercentField, PercentSliderField, SelectField } from '@/components/form/fields';
import { IntegerInput, MoneyInput, PercentInput } from '@/components/form/inputs';
import { InfoTip } from '@/components/InfoTip';
import { UnverifiedValue } from '@/components/UnverifiedNotice';
import { formatCents, formatPercent } from '@/lib/format';
import { newId } from '@/lib/ids';
import { calculatorHref } from '@/features/calculators/registry';

type Form = UseFormReturn<HouseholdInput, unknown, Household>;
type Person = Household['people'][number];
type Plan = Person['workplacePlans'][number];

const PLAN_LABEL: Record<Plan['planType'], string> = { '401k': '401(k)', '403b': '403(b)', '457b': '457(b)' };

function MatchReadout({
  preview,
  previewRow,
  limitsVerified,
}: {
  preview: PersonPreviewRow['plans'][number] | undefined;
  previewRow: PersonPreviewRow | undefined;
  limitsVerified: boolean;
}) {
  if (!preview) return null;
  const m = preview.matchBeforeLimits;
  if (m.maxPossibleMatch === 0) {
    return <p className="text-sm text-muted-foreground">This plan has no matching contribution.</p>;
  }
  return (
    <div className="rounded-md border bg-muted/40 p-4 text-sm" aria-live="polite">
      <p className="font-medium">
        Contribute {formatPercent(m.pctToCaptureFullMatch, 2)} ({formatCents(m.dollarsToCaptureFullMatch)} a year) to
        capture the full match.
      </p>
      <p className="mt-1 text-muted-foreground">
        In this plan you currently capture {formatCents(m.match)} of a possible {formatCents(m.maxPossibleMatch)}
        {m.unclaimed > 0 ? `, leaving ${formatCents(m.unclaimed)} per year unclaimed.` : ', the full match.'}
      </p>
      {!limitsVerified ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <UnverifiedValue label="Before plan limits" /> The deferral, compensation and annual-additions limits are
          unverified, so capping is not applied to this readout.
        </p>
      ) : (
        <AfterLimits previewRow={previewRow} />
      )}
    </div>
  );
}

/** With verified limits: the employer match the forecast actually counts after plan limits. */
function AfterLimits({ previewRow }: { previewRow: PersonPreviewRow | undefined }) {
  const after = previewRow?.contributions;
  if (!previewRow || !after) return null;
  const before = previewRow.matchBeforeLimits.match;
  const scope = previewRow.plans.length > 1 ? ' (all of this person’s plans together)' : '';
  if (after.employerMatch >= before) {
    return <p className="mt-2 text-xs text-muted-foreground">Plan limits do not reduce this match{scope}.</p>;
  }
  return (
    <p className="mt-2 text-xs font-medium">
      After plan limits, the forecast counts {formatCents(after.employerMatch)} of employer match this year
      {scope}: {formatCents(before - after.employerMatch)} less than the figures above, because the deferral or
      annual-additions limits cap the contributions.
    </p>
  );
}

function TierEditor({
  plan,
  basePath,
  set,
}: {
  plan: Plan;
  basePath: string;
  set: (path: string, value: unknown) => void;
}) {
  const tiers = plan.match.tiers;
  // Band start of each tier: tier k covers [start_k, start_k + band_k).
  const starts = tiers.map((_, i) => tiers.slice(0, i).reduce((sum, t) => sum + t.bandPctOfPay, 0));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
        Employer match tiers
        <InfoTip term="Match tiers">
          Each tier matches a band of your contributions. “100% of the first 3%, then 50% of the next 2%” is two tiers:
          100% on 3% of pay, then 50% on the next 2%.
        </InfoTip>
      </legend>
      {tiers.length === 0 ? <p className="text-xs text-muted-foreground">No match tiers.</p> : null}
      {tiers.map((tier, i) => {
        const from = starts[i] ?? 0;
        const to = from + tier.bandPctOfPay;
        return (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <Field label={`Tier ${i + 1}: match rate`} className="w-36">
              {(a) => (
                <PercentInput
                  {...a}
                  value={tier.matchRate}
                  onChange={(v) => set(`${basePath}.match.tiers.${i}.matchRate`, v)}
                />
              )}
            </Field>
            <Field label="on the next (% of pay)" className="w-40">
              {(a) => (
                <PercentInput
                  {...a}
                  value={tier.bandPctOfPay}
                  onChange={(v) => set(`${basePath}.match.tiers.${i}.bandPctOfPay`, v)}
                />
              )}
            </Field>
            <p className="pb-2.5 text-xs text-muted-foreground">
              covers {formatPercent(from, 2)}–{formatPercent(to, 2)} of pay
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove tier ${i + 1}`}
              onClick={() =>
                set(
                  `${basePath}.match.tiers`,
                  tiers.filter((_, j) => j !== i),
                )
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        );
      })}
      {tiers.length < 5 ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set(`${basePath}.match.tiers`, [...tiers, { matchRate: 0.5, bandPctOfPay: 0.02 }])}
          >
            <Plus aria-hidden="true" /> Add a tier
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

function VestingEditor({
  plan,
  basePath,
  set,
  control,
}: {
  plan: Plan;
  basePath: string;
  set: (path: string, value: unknown) => void;
  control: Control<HouseholdInput, unknown, Household>;
}) {
  const vesting = plan.match.vesting;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Vesting"
        tip="When employer contributions become yours. Unvested employer money is forfeited if you leave before vesting; this matters if you retire before full vesting."
        example="Many plans vest immediately or over 3–6 years."
      >
        {(a) => (
          <NativeSelect
            {...a}
            value={vesting.kind}
            onChange={(e) => {
              const kind = e.target.value;
              set(
                `${basePath}.match.vesting`,
                kind === 'cliff'
                  ? { kind, years: 3 }
                  : kind === 'graded'
                    ? { kind, vestedByYear: [0.2, 0.4, 0.6, 0.8, 1] }
                    : { kind: 'immediate' },
              );
            }}
          >
            <option value="immediate">Immediate</option>
            <option value="cliff">Cliff (all at once)</option>
            <option value="graded">Graded (each year)</option>
          </NativeSelect>
        )}
      </Field>
      <IntegerField
        control={control}
        name={`${basePath}.match.yearsOfServiceAtStart` as never}
        label="Years of service so far"
        example="Completed years with this employer."
      />
      {vesting.kind === 'cliff' ? (
        <Field label="Fully vested after (years)">
          {(a) => (
            <IntegerInput {...a} value={vesting.years} onChange={(v) => set(`${basePath}.match.vesting.years`, v)} />
          )}
        </Field>
      ) : null}
      {vesting.kind === 'graded' ? (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Vested share after each year of service</legend>
          <div className="flex flex-wrap gap-3">
            {vesting.vestedByYear.map((v, i) => (
              <Field key={i} label={`Year ${i + 1}`} className="w-24">
                {(a) => (
                  <PercentInput
                    {...a}
                    value={v}
                    onChange={(x) =>
                      set(
                        `${basePath}.match.vesting.vestedByYear`,
                        vesting.vestedByYear.map((y, j) => (j === i ? x : y)),
                      )
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

export function PlanSection({
  form,
  personIndex,
  person,
  household,
  previewRow,
  limitsVerified,
}: {
  form: Form;
  personIndex: number;
  person: Person;
  household: Household;
  previewRow: PersonPreviewRow | undefined;
  limitsVerified: boolean;
}) {
  const control = form.control as Control<HouseholdInput, unknown, Household>;
  const [paychecks, setPaychecks] = useState(26);
  const set = (path: string, value: unknown) =>
    form.setValue(path as never, value as never, { shouldDirty: true, shouldValidate: true });
  const plans = person.workplacePlans;
  const hasBonus = person.employment !== null && person.employment.bonus.kind !== 'none';

  const addPlan = () => {
    const accountId = newId('account');
    const planType = plans.some((p) => p.planType === '401k') ? '457b' : '401k';
    set('accounts', [
      ...household.accounts,
      {
        type: 'workplaceTraditional',
        planType,
        id: accountId,
        name: `${person.name} ${PLAN_LABEL[planType]}`,
        ownerId: person.id,
        balance: 0,
        expectedReturn: null,
        expenseRatio: 0,
        allocation: null,
        unvestedEmployerBalance: 0,
      },
    ]);
    set(`people.${personIndex}.workplacePlans`, [
      ...plans,
      {
        id: newId('plan'),
        planType,
        traditionalAccountId: accountId,
        rothAccountId: null,
        planOffersRoth: false,
        traditionalPctOfSalary: 0.05,
        rothPctOfSalary: 0,
        traditionalPctOfBonus: 0,
        rothPctOfBonus: 0,
        autoEscalation: null,
        match: {
          tiers: [
            { matchRate: 1, bandPctOfPay: 0.03 },
            { matchRate: 0.5, bandPctOfPay: 0.02 },
          ],
          flatPctOfPay: 0,
          annualMatchCap: null,
          vesting: { kind: 'immediate' },
          yearsOfServiceAtStart: 0,
        },
        matchDestination: 'traditional',
      },
    ]);
  };

  const toggleRoth = (planIndex: number, plan: Plan, on: boolean) => {
    const path = `people.${personIndex}.workplacePlans.${planIndex}`;
    if (on) {
      if (plan.rothAccountId === null) {
        const accountId = newId('account');
        set('accounts', [
          ...household.accounts,
          {
            type: 'workplaceRoth',
            planType: plan.planType,
            id: accountId,
            name: `${person.name} Roth ${PLAN_LABEL[plan.planType]}`,
            ownerId: person.id,
            balance: 0,
            expectedReturn: null,
            expenseRatio: 0,
            allocation: null,
            unvestedEmployerBalance: 0,
          },
        ]);
        set(`${path}.rothAccountId`, accountId);
      }
      set(`${path}.planOffersRoth`, true);
    } else {
      set(`${path}.rothPctOfSalary`, 0);
      set(`${path}.rothPctOfBonus`, 0);
      set(`${path}.matchDestination`, 'traditional');
      if (plan.autoEscalation?.appliesTo === 'roth') set(`${path}.autoEscalation`, null);
      set(`${path}.planOffersRoth`, false);
    }
  };

  const changePlanType = (planIndex: number, plan: Plan, planType: Plan['planType']) => {
    set(
      'accounts',
      household.accounts.map((a) =>
        (a.id === plan.traditionalAccountId || a.id === plan.rothAccountId) &&
        (a.type === 'workplaceTraditional' || a.type === 'workplaceRoth')
          ? { ...a, planType }
          : a,
      ),
    );
    set(`people.${personIndex}.workplacePlans.${planIndex}.planType`, planType);
  };

  return (
    <div className="flex flex-col gap-6">
      {plans.map((plan, planIndex) => {
        const basePath = `people.${personIndex}.workplacePlans.${planIndex}`;
        const planPreview = previewRow?.plans.find((p) => p.planId === plan.id);
        const requested = planPreview ? planPreview.requestedTraditional + planPreview.requestedRoth : 0;
        const totalPct = plan.traditionalPctOfSalary + (plan.planOffersRoth ? plan.rothPctOfSalary : 0);
        return (
          <Card key={plan.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>
                    {PLAN_LABEL[plan.planType]} contributions{plans.length > 1 ? ` (plan ${planIndex + 1})` : ''}
                  </CardTitle>
                  <CardDescription>
                    Your contributions and the employer match come only from here; the account balance is on the
                    Accounts page.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set(
                      `people.${personIndex}.workplacePlans`,
                      plans.filter((_, j) => j !== planIndex),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" /> Remove plan
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Plan type"
                  tip="401(k) and 403(b) deferrals share one annual limit; a 457(b) has its own."
                >
                  {(a) => (
                    <NativeSelect
                      {...a}
                      value={plan.planType}
                      onChange={(e) => changePlanType(planIndex, plan, e.target.value as Plan['planType'])}
                    >
                      <option value="401k">401(k)</option>
                      <option value="403b">403(b)</option>
                      <option value="457b">457(b)</option>
                    </NativeSelect>
                  )}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1">
                    <Label htmlFor={`${plan.id}-roth`}>Plan offers Roth contributions</Label>
                    <InfoTip term="Roth contributions">
                      After-tax contributions; qualified withdrawals are tax-free. Plan-dependent.
                    </InfoTip>
                  </div>
                  <Switch
                    id={`${plan.id}-roth`}
                    checked={plan.planOffersRoth}
                    onCheckedChange={(on) => toggleRoth(planIndex, plan, on)}
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <PercentSliderField
                  control={control}
                  name={`${basePath}.traditionalPctOfSalary` as never}
                  label="Traditional (pre-tax) % of salary"
                  tip="Pre-tax contributions lower taxable income now; withdrawals are taxed later."
                  example="For example 6%."
                  min={0}
                  max={50}
                  step={0.5}
                />
                {plan.planOffersRoth ? (
                  <PercentSliderField
                    control={control}
                    name={`${basePath}.rothPctOfSalary` as never}
                    label="Roth % of salary"
                    tip="After-tax contributions; qualified withdrawals are tax-free."
                    example="For example 4%."
                    min={0}
                    max={50}
                    step={0.5}
                  />
                ) : null}
                {hasBonus ? (
                  <>
                    <PercentField
                      control={control}
                      name={`${basePath}.traditionalPctOfBonus` as never}
                      label="Traditional % of bonus"
                      example="Can differ from salary, e.g. 50% of the bonus."
                    />
                    {plan.planOffersRoth ? (
                      <PercentField
                        control={control}
                        name={`${basePath}.rothPctOfBonus` as never}
                        label="Roth % of bonus"
                        example="For example 0%."
                      />
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-muted/40 px-4 py-3 text-sm">
                <p>
                  Total of salary: <span className="font-semibold">{formatPercent(totalPct, 2)}</span>
                </p>
                <p>
                  This year: <span className="font-semibold">{formatCents(requested)}</span>
                </p>
                <div className="flex items-center gap-2">
                  Per paycheck: <span className="font-semibold">{formatCents(requested / paychecks)}</span>
                  <label className="sr-only" htmlFor={`${plan.id}-paychecks`}>
                    Paychecks per year
                  </label>
                  <NativeSelect
                    id={`${plan.id}-paychecks`}
                    className="h-8 w-36 text-xs"
                    value={String(paychecks)}
                    onChange={(e) => setPaychecks(Number(e.target.value))}
                  >
                    <option value="52">Weekly (52)</option>
                    <option value="26">Every 2 weeks (26)</option>
                    <option value="24">Twice a month (24)</option>
                    <option value="12">Monthly (12)</option>
                  </NativeSelect>
                </div>
              </div>

              {planIndex === 0 ? (
                <p className="text-sm text-muted-foreground">
                  The same deferral made pre-tax or as Roth:{' '}
                  <Link
                    to={calculatorHref('rothVsTraditional', { personId: person.id })}
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    Compare Roth vs traditional
                  </Link>{' '}
                  (calculator, filled from {person.name}’s plan).
                </p>
              ) : null}

              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 flex items-center gap-2 text-sm font-medium">
                  Automatic increase
                  <Switch
                    aria-label="Automatic increase"
                    checked={plan.autoEscalation !== null}
                    onCheckedChange={(on) =>
                      set(
                        `${basePath}.autoEscalation`,
                        on ? { stepPct: 0.01, capPct: 0.1, appliesTo: 'traditional' } : null,
                      )
                    }
                  />
                </legend>
                {plan.autoEscalation ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <PercentField
                      control={control}
                      name={`${basePath}.autoEscalation.stepPct` as never}
                      label="Increase per year"
                      example="For example 1%."
                    />
                    <PercentField
                      control={control}
                      name={`${basePath}.autoEscalation.capPct` as never}
                      label="Up to"
                      example="For example 10%."
                    />
                    <SelectField
                      control={control}
                      name={`${basePath}.autoEscalation.appliesTo` as never}
                      label="Applies to"
                      options={[
                        { value: 'traditional', label: 'Traditional' },
                        ...(plan.planOffersRoth ? [{ value: 'roth', label: 'Roth' }] : []),
                      ]}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Raise the contribution percentage a little every year, up to a cap.
                  </p>
                )}
              </fieldset>

              <TierEditor plan={plan} basePath={basePath} set={set} />
              <div className="grid gap-4 sm:grid-cols-2">
                <PercentField
                  control={control}
                  name={`${basePath}.match.flatPctOfPay` as never}
                  label="Employer contribution regardless of yours"
                  tip="A non-elective contribution some employers make whether or not you contribute."
                  example="For example 3% of pay; 0% if none."
                />
                <Field
                  label="Annual match cap (optional)"
                  tip="Some plans cap the match at a dollar amount per year."
                  example="Leave at $0 for no cap."
                >
                  {(a) => (
                    <MoneyInput
                      {...a}
                      value={plan.match.annualMatchCap ?? 0}
                      onChange={(c) => set(`${basePath}.match.annualMatchCap`, c > 0 ? c : null)}
                    />
                  )}
                </Field>
                {plan.planOffersRoth ? (
                  <SelectField
                    control={control}
                    name={`${basePath}.matchDestination` as never}
                    label="Match goes to"
                    tip="By default the match is pre-tax (traditional). Some plans allow a Roth match."
                    options={[
                      { value: 'traditional', label: 'Traditional (pre-tax)' },
                      { value: 'roth', label: 'Roth' },
                    ]}
                  />
                ) : null}
              </div>
              <VestingEditor plan={plan} basePath={basePath} set={set} control={control} />
              <MatchReadout preview={planPreview} previewRow={previewRow} limitsVerified={limitsVerified} />
            </CardContent>
          </Card>
        );
      })}
      {person.employment && plans.length < 2 ? (
        <div>
          <Button type="button" variant="outline" onClick={addPlan}>
            <Plus aria-hidden="true" /> Add a workplace plan
          </Button>
        </div>
      ) : null}
    </div>
  );
}
