import { useId, useMemo, useState } from 'react';
import { AlertTriangle, Info, Plus, Trash2 } from 'lucide-react';
import { useController } from 'react-hook-form';
import type { DollarBasis, Household, Person, ProjectionResult, RulesSet } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field } from '@/components/form/Field';
import { IntegerField, MoneyField, PercentField, SelectField } from '@/components/form/fields';
import { IntegerInput, MoneyInput } from '@/components/form/inputs';
import { UnverifiedNotice } from '@/components/UnverifiedNotice';
import { CURRENT_YEAR } from '@/app/env';
import { formatCents, formatPercent } from '@/lib/format';
import { basisName } from '@/features/dashboard/viewModel';
import { errorAt, setter, type HouseholdControl, type HouseholdForm } from './formHelpers';
import {
  claimingComparison,
  claimingRulesVerified,
  firstBenefitYear,
  formatAge,
  illustrativeEstimate,
  isExcluded,
  warningMessages,
  type ClaimingComparison,
  type SsSourceKind,
} from './model';

type Source = Person['socialSecurity']['source'];

const SOURCES: { kind: SsSourceKind; title: string; description: string; recommended?: boolean }[] = [
  {
    kind: 'atClaimAge',
    title: 'Benefit at your planned claiming age',
    description:
      'From your SSA statement’s table of benefits by claiming age. Used as entered, so it needs no unverified rule values.',
    recommended: true,
  },
  {
    kind: 'statement',
    title: 'Benefit at full retirement age',
    description:
      'The full-retirement-age amount from your SSA statement. Adjusting it to your claiming age needs SSA claiming rules.',
  },
  {
    kind: 'estimateAverage',
    title: 'Illustrative estimate from average earnings',
    description: 'A rough estimate from your average yearly earnings. Not an official SSA calculation.',
  },
  {
    kind: 'estimateHistory',
    title: 'Illustrative estimate from an earnings history',
    description: 'A rough estimate from your earnings year by year. Not an official SSA calculation.',
  },
  { kind: 'none', title: 'No Social Security benefit', description: 'Leave Social Security out of this plan.' },
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function defaultSource(kind: SsSourceKind, person: Person): Source {
  switch (kind) {
    case 'statement':
      return { kind, piaMonthly: 0 as never };
    case 'atClaimAge':
      return { kind, monthlyAtClaim: 0 as never };
    case 'estimateAverage':
      return {
        kind,
        averageAnnualEarnings: (person.employment?.baseSalary ?? 0) as never,
        yearsOfEarnings: 35,
      };
    case 'estimateHistory':
      return { kind, earnings: [] };
    default:
      return { kind: 'none' };
  }
}

function SourcePicker({
  form,
  index,
  person,
  rulesVerified,
}: {
  form: HouseholdForm;
  index: number;
  person: Person;
  rulesVerified: boolean;
}) {
  const name = useId();
  const set = setter(form);
  const current = person.socialSecurity.source.kind;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Where {person.name}’s benefit amount comes from</legend>
      {SOURCES.map((s) => (
        <label
          key={s.kind}
          className="flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        >
          <input
            type="radio"
            name={name}
            value={s.kind}
            checked={current === s.kind}
            onChange={() => set(`people.${index}.socialSecurity.source`, defaultSource(s.kind, person))}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {s.title}
              {s.recommended && !rulesVerified ? (
                <Badge variant="secondary">Recommended while rules are unverified</Badge>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">{s.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function ClaimAgeField({ control, index }: { control: HouseholdControl; index: number }) {
  const { field, fieldState } = useController({ control, name: `people.${index}.socialSecurity.claimAge` });
  const value = (field.value as { years: number; months: number } | undefined) ?? { years: 67, months: 0 };
  const error =
    fieldState.error?.message ?? (fieldState.error as { root?: { message?: string } } | undefined)?.root?.message;
  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <Field
        label="Claiming age (years)"
        tip="The age at which benefits start, from 62 to 70. Benefits begin in the year you reach this age, from the month after the months below."
        example="For example 67."
        error={error}
      >
        {(a) => (
          <NativeSelect
            {...a}
            value={String(value.years)}
            onChange={(e) => field.onChange({ ...value, years: Number(e.target.value) })}
          >
            {Array.from({ length: 9 }, (_, i) => 62 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label="Plus months" example="0 to 11 months (none after 70).">
        {(a) => (
          <NativeSelect
            {...a}
            value={String(value.months)}
            onChange={(e) => field.onChange({ ...value, months: Number(e.target.value) })}
          >
            {Array.from({ length: 12 }, (_, m) => m).map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'No extra months' : `${m} month${m === 1 ? '' : 's'}`}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
    </div>
  );
}

function EarningsHistory({ form, index, person }: { form: HouseholdForm; index: number; person: Person }) {
  const set = setter(form);
  const source = person.socialSecurity.source;
  if (source.kind !== 'estimateHistory') return null;
  const base = `people.${index}.socialSecurity.source.earnings`;
  const earnings = source.earnings;
  const listError = errorAt(form, base);
  return (
    <fieldset className="flex flex-col gap-3 sm:col-span-2">
      <legend className="mb-2 text-sm font-medium">Earnings history</legend>
      <p className="text-xs text-muted-foreground">
        One row per year, as shown on your SSA statement. Enter earnings already capped at each year’s Social Security
        taxable maximum; the estimate assumes they are.
      </p>
      {earnings.length === 0 ? <p className="text-sm text-muted-foreground">No years entered yet.</p> : null}
      {earnings.map((row, j) => (
        <div key={j} className="flex flex-wrap items-end gap-3">
          <Field label="Year" className="w-28" error={errorAt(form, `${base}.${j}.year`)}>
            {(a) => <IntegerInput {...a} value={row.year} onChange={(year) => set(`${base}.${j}.year`, year)} />}
          </Field>
          <Field label="Earnings" className="w-44" error={errorAt(form, `${base}.${j}.earnings`)}>
            {(a) => (
              <MoneyInput {...a} value={row.earnings} onChange={(cents) => set(`${base}.${j}.earnings`, cents)} />
            )}
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove the ${row.year} earnings`}
            onClick={() =>
              set(
                base,
                earnings.filter((_, k) => k !== j),
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
          disabled={earnings.length >= 80}
          onClick={() => {
            const earliest = earnings.reduce((min, r) => Math.min(min, r.year), CURRENT_YEAR);
            set(base, [...earnings, { year: earliest - 1, earnings: person.employment?.baseSalary ?? 0 }]);
          }}
        >
          <Plus aria-hidden="true" /> Add an earlier year
        </Button>
      </div>
    </fieldset>
  );
}

function EstimatorPanel({
  form,
  index,
  person,
  validPerson,
  rules,
}: {
  form: HouseholdForm;
  index: number;
  person: Person;
  validPerson: Person | undefined;
  rules: RulesSet;
}) {
  const control = form.control as HouseholdControl;
  const kind = person.socialSecurity.source.kind;
  const estimate = useMemo(() => (validPerson ? illustrativeEstimate(validPerson, rules) : null), [validPerson, rules]);
  if (kind !== 'estimateAverage' && kind !== 'estimateHistory') return null;
  const base = `people.${index}.socialSecurity.source`;
  return (
    <section
      aria-labelledby={`ss-estimate-${index}`}
      className="flex flex-col gap-4 rounded-md border border-dashed p-4 sm:col-span-2"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`ss-estimate-${index}`} className="text-sm font-semibold">
          Illustrative estimate — not an official SSA calculation
        </h3>
        <p className="text-xs text-muted-foreground">
          A rough benefit at full retirement age from earnings you enter, kept separate from statement amounts. Your SSA
          statement (ssa.gov/myaccount) is the better source.
        </p>
      </div>
      {kind === 'estimateAverage' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            control={control}
            name={`${base}.averageAnnualEarnings` as never}
            label="Average yearly earnings"
            tip="Your typical yearly earnings subject to Social Security tax, in today’s dollars."
            example="For example $70,000."
          />
          <IntegerField
            control={control}
            name={`${base}.yearsOfEarnings` as never}
            label="Years of earnings"
            tip="How many years you have worked, or will have worked, at about that level. The estimate counts up to 35."
            example="For example 35."
          />
        </div>
      ) : (
        <EarningsHistory form={form} index={index} person={person} />
      )}
      {estimate === null ? null : estimate.status === 'ok' ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            Illustrative estimate at full retirement age:{' '}
            <span className="font-semibold">{formatCents(estimate.value.piaMonthly)} per month</span> (not an official
            SSA calculation).
          </p>
          <p className="text-xs text-muted-foreground">{estimate.value.label}</p>
        </div>
      ) : estimate.status === 'unverified' ? (
        <UnverifiedNotice missing={estimate.missing} feature="the illustrative estimate" />
      ) : estimate.status === 'notImplemented' ? (
        <p className="text-sm text-muted-foreground">The illustrative estimate is not available in this version yet.</p>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {estimate.issues.map((i) => i.message).join(' ')}
        </p>
      )}
    </section>
  );
}

function adjustmentText(factor: number): string {
  if (Math.abs(factor - 1) < 1e-9) return 'Full amount';
  return factor < 1 ? `${formatPercent(1 - factor, 1)} less` : `${formatPercent(factor - 1, 1)} more`;
}

function ClaimingTable({ comparison, name }: { comparison: ClaimingComparison; name: string }) {
  if (comparison.kind === 'noBenefit') return null;
  const heading = (
    <h3 className="text-sm font-semibold" id={`claiming-${name}`}>
      Claiming-age comparison
    </h3>
  );
  let body: React.ReactNode;
  switch (comparison.kind) {
    case 'noPia':
      body = (
        <p className="text-sm text-muted-foreground">
          Your SSA statement lists the monthly benefit at each claiming age from 62 to 70, so compare them there. A
          comparison here needs the benefit at full retirement age and verified SSA claiming rules.
        </p>
      );
      break;
    case 'unverified':
      body = <UnverifiedNotice missing={comparison.missing} feature="the claiming-age comparison" />;
      break;
    case 'notImplemented':
      body = (
        <p className="text-sm text-muted-foreground">
          The claiming-age comparison is not available in this version yet.
        </p>
      );
      break;
    case 'invalid':
      body = (
        <p role="alert" className="text-sm text-destructive">
          {comparison.messages.join(' ')}
        </p>
      );
      break;
    case 'ok':
      body = (
        <>
          <Table label={`Claiming-age comparison for ${name}, monthly, today’s dollars`}>
            <TableHeader>
              <TableRow>
                <TableHead>Claiming age</TableHead>
                <TableHead className="text-right">Monthly benefit</TableHead>
                <TableHead className="text-right">Compared with full retirement age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.rows.map((row) => (
                <TableRow
                  key={`${row.age.years}-${row.age.months}`}
                  className={row.planned ? 'bg-primary/5' : undefined}
                >
                  <TableCell>
                    {row.label}
                    {row.planned ? <span className="font-medium"> · your plan</span> : null}
                  </TableCell>
                  <TableCell className="text-right">{formatCents(row.monthly)}</TableCell>
                  <TableCell className="text-right">{adjustmentText(row.adjustmentFactor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Your own benefit only, in today’s dollars before cost-of-living adjustments
            {comparison.piaSource === 'estimate'
              ? ', from the illustrative estimate (not an official SSA calculation)'
              : ', from your full-retirement-age amount'}
            . Full retirement age: {formatAge(comparison.fra)}.
          </p>
        </>
      );
      break;
  }
  return (
    <section aria-labelledby={`claiming-${name}`} className="flex flex-col gap-2 sm:col-span-2">
      {heading}
      {body}
    </section>
  );
}

function ForecastReadout({
  person,
  projection,
  basis,
}: {
  person: Person;
  projection: ProjectionResult | null;
  basis: DollarBasis;
}) {
  if (!projection || person.socialSecurity.source.kind === 'none') return null;
  const first = firstBenefitYear(projection, person.id, basis);
  if (first) {
    return (
      <p className="text-sm sm:col-span-2">
        In this forecast, {person.name}’s benefit starts in {first.year} (age {first.age}):{' '}
        <span className="font-semibold">{formatCents(first.amount)}</span> that year in {basisName(basis)}. The first
        year can be a partial year.
      </p>
    );
  }
  const kind = person.socialSecurity.source.kind;
  if (kind !== 'atClaimAge' && isExcluded(projection, 'socialSecurityClaiming')) {
    return (
      <Alert variant="attention" className="sm:col-span-2">
        <Info aria-hidden="true" />
        <p>
          Left out of the forecast for now: turning this amount into a benefit at {person.name}’s claiming age needs SSA
          claiming rules that are not verified yet. To include Social Security now, choose “Benefit at your planned
          claiming age” and enter the amount from the SSA statement.
        </p>
      </Alert>
    );
  }
  return (
    <p className="text-sm text-muted-foreground sm:col-span-2">
      No Social Security benefit for {person.name} appears in the forecast years.
    </p>
  );
}

function PersonPanel({
  form,
  index,
  person,
  validPerson,
  projection,
  basis,
  rules,
}: {
  form: HouseholdForm;
  index: number;
  person: Person;
  validPerson: Person | undefined;
  projection: ProjectionResult | null;
  basis: DollarBasis;
  rules: RulesSet;
}) {
  const control = form.control as HouseholdControl;
  const kind = person.socialSecurity.source.kind;
  const comparison = useMemo(
    () => (validPerson ? claimingComparison(validPerson, rules) : ({ kind: 'noBenefit' } as const)),
    [validPerson, rules],
  );
  const rulesVerified = useMemo(
    () => (validPerson ? claimingRulesVerified(validPerson, rules) : false),
    [validPerson, rules],
  );
  const base = `people.${index}.socialSecurity.source`;
  return (
    <div className="flex flex-col gap-5">
      <SourcePicker form={form} index={index} person={person} rulesVerified={rulesVerified} />
      {kind === 'none' ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          {kind === 'atClaimAge' ? (
            <MoneyField
              control={control}
              name={`${base}.monthlyAtClaim` as never}
              label="Monthly benefit at your claiming age"
              tip="In today’s dollars, as printed on your SSA statement for the age you plan to claim. It is used directly; the forecast raises it each year by the cost-of-living assumption below."
              example="For example $2,400 at 67."
            />
          ) : null}
          {kind === 'statement' ? (
            <MoneyField
              control={control}
              name={`${base}.piaMonthly` as never}
              label="Monthly benefit at full retirement age"
              tip="Your primary insurance amount from the SSA statement, in today’s dollars. Claiming earlier lowers it and claiming later raises it, by SSA rules."
              example="For example $2,650."
            />
          ) : null}
          <SelectField
            control={control}
            name={`people.${index}.birthMonth`}
            label="Birth month"
            tip="Used only where Social Security counts months: full retirement age and the months of benefits in the first year."
            numeric
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          />
          <ClaimAgeField control={control} index={index} />
          <EstimatorPanel form={form} index={index} person={person} validPerson={validPerson} rules={rules} />
          <ClaimingTable comparison={comparison} name={person.name} />
          <ForecastReadout person={validPerson ?? person} projection={projection} basis={basis} />
        </div>
      )}
    </div>
  );
}

function SsAssumptions({ form, household }: { form: HouseholdForm; household: Household }) {
  const control = form.control as HouseholdControl;
  const set = setter(form);
  const ss = household.assumptions.socialSecurity;
  const reduction = ss.benefitReduction;
  const switchId = useId();
  return (
    <fieldset className="flex flex-col gap-4 border-t pt-5">
      <legend className="sr-only">Social Security assumptions</legend>
      <h3 className="text-sm font-semibold">Assumptions for every benefit</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Cost-of-living adjustment"
          tip="How benefits rise each year once they start. By default they rise with the plan’s inflation assumption."
          example="Default: with inflation."
        >
          {(a) => (
            <NativeSelect
              {...a}
              value={ss.cola.mode}
              onChange={(e) =>
                set(
                  'assumptions.socialSecurity.cola',
                  e.target.value === 'rate' ? { mode: 'rate', rate: 0.02 } : { mode: 'inflation' },
                )
              }
            >
              <option value="inflation">With inflation (default)</option>
              <option value="rate">A set rate</option>
            </NativeSelect>
          )}
        </Field>
        {ss.cola.mode === 'rate' ? (
          <PercentField
            control={control}
            name={'assumptions.socialSecurity.cola.rate' as never}
            label="Cost-of-living rate"
            example="Per year, for example 2%."
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Switch
            id={switchId}
            checked={reduction !== null}
            onCheckedChange={(on) =>
              set(
                'assumptions.socialSecurity.benefitReduction',
                on ? { fromYear: CURRENT_YEAR + 10, reduction: 0.1 } : null,
              )
            }
          />
          <label htmlFor={switchId} className="text-sm font-medium">
            Test a benefit reduction
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          An assumption, not a prediction: every benefit is lowered by the share you choose from the year you choose.
        </p>
        {reduction ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <IntegerField
              control={control}
              name={'assumptions.socialSecurity.benefitReduction.fromYear' as never}
              label="Reduction starts in"
              example="A calendar year. The starting values are examples; set your own."
            />
            <PercentField
              control={control}
              name={'assumptions.socialSecurity.benefitReduction.reduction' as never}
              label="Benefit reduction"
              example="Share of each benefit removed, for example 10%."
            />
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

export function SocialSecuritySection({
  form,
  household,
  values,
  projection,
  basis,
  rules,
}: {
  form: HouseholdForm;
  /** The last valid household (engine inputs). */
  household: Household;
  /** The form's current values (may be mid-edit). */
  values: Household;
  projection: ProjectionResult | null;
  basis: DollarBasis;
  rules: RulesSet;
}) {
  const people = values.people;
  const [tab, setTab] = useState(people[0]?.id ?? '');
  const warnings = projection
    ? warningMessages(projection, ['ssClaimBeforeFraWhileWorking', 'ssEstimateIllustrative'])
    : [];
  const spousalExcluded = people.length > 1 && projection !== null && isExcluded(projection, 'spousalSurvivorBenefits');
  const panel = (i: number) => {
    const person = people[i];
    if (!person) return null;
    return (
      <PersonPanel
        form={form}
        index={i}
        person={person}
        validPerson={household.people.find((p) => p.id === person.id)}
        projection={projection}
        basis={basis}
        rules={rules}
      />
    );
  };
  return (
    <Card aria-labelledby="ss-title">
      <CardHeader>
        <CardTitle id="ss-title">Social Security</CardTitle>
        <CardDescription>
          Amounts are monthly, in today’s dollars. While SSA rule values are unverified, a benefit entered at your
          planned claiming age (from your SSA statement) is the input the forecast can use as is.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {people.length > 1 ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Person">
              {people.map((p) => (
                <TabsTrigger key={p.id} value={p.id}>
                  {p.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {people.map((p, i) => (
              <TabsContent key={p.id} value={p.id} className="mt-5">
                {panel(i)}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          panel(0)
        )}
        {spousalExcluded ? (
          <p className="text-sm text-muted-foreground">
            Spousal and survivor benefits are left out because their SSA rule values are unverified: each person keeps
            only their own benefit, and a survivor gets nothing extra.
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <Alert variant="attention" aria-label="Social Security notes">
            <AlertTriangle aria-hidden="true" />
            <ul className="flex flex-col gap-1">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <SsAssumptions form={form} household={values} />
      </CardContent>
    </Card>
  );
}
