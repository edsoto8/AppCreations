import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus } from 'lucide-react';
import type { AccumulationPreview, Household, Person, RothIraYear } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { UnverifiedNotice, UnverifiedValue } from '@/components/UnverifiedNotice';
import { Field } from '@/components/form/Field';
import { MoneyInput } from '@/components/form/inputs';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEngineContext } from '@/hooks/useEngine';
import { formatCents } from '@/lib/format';
import { AccountDialog } from '@/features/accounts/AccountDialog';
import { describeContribution } from '@/features/accounts/accountModel';
import { previewYearOne, type RothIraAccount } from '@/features/accounts/thisYear';
import { useCommitHousehold } from '@/features/accounts/useCommitHousehold';
import { calculatorHref } from '@/features/calculators/registry';
import { rothAccountsOf, rothReadout, type RothReadout } from './rothEligibility';

export function RothIraPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roth IRA"
        description="Roth IRA balances and contributions for each person, with this year’s eligibility check."
      />
      <RequireProfile>{(household) => <RothBody household={household} />}</RequireProfile>
    </div>
  );
}

interface Shared {
  household: Household;
  preview: AccumulationPreview | null;
  year: number;
}

function RothBody({ household }: { household: Household }) {
  const ctx = useEngineContext();
  const year = ctx.currentYear;
  const preview = useMemo(() => previewYearOne(household, ctx), [household, ctx]);
  const shared: Shared = { household, preview, year };
  const [first] = household.people;

  return (
    <>
      {household.people.length > 1 && first ? (
        <Tabs defaultValue={first.id} className="flex flex-col gap-4">
          <TabsList aria-label="Person" className="self-start">
            {household.people.map((person) => (
              <TabsTrigger key={person.id} value={person.id}>
                {person.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {household.people.map((person) => (
            <TabsContent key={person.id} value={person.id} className="flex flex-col gap-6">
              <PersonRoth {...shared} person={person} />
            </TabsContent>
          ))}
        </Tabs>
      ) : first ? (
        <PersonRoth {...shared} person={first} />
      ) : null}
      <NotModeledCard household={household} />
    </>
  );
}

function PersonRoth(props: Shared & { person: Person }) {
  const { household, person, preview, year } = props;
  const accounts = rothAccountsOf(household, person.id);
  const readout = rothReadout(household, person.id, preview);
  const joint = household.filingStatus === 'marriedFilingJointly';
  const [dialog, setDialog] = useState<{ account?: RothIraAccount } | null>(null);

  return (
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{person.name}’s Roth IRA</CardTitle>
            <CardDescription>Balance, contribution basis and the contribution schedule.</CardDescription>
          </div>
          <Button variant={accounts.length === 0 ? 'default' : 'outline'} onClick={() => setDialog({})}>
            <Plus aria-hidden="true" />
            Add a Roth IRA
          </Button>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{person.name} has no Roth IRA in this plan.</p>
          ) : (
            <Table label={`${person.name}’s Roth IRA accounts`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Contribution basis</TableHead>
                  <TableHead>First contribution</TableHead>
                  <TableHead>Contributions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-medium">{account.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-3"
                          onClick={() => setDialog({ account })}
                          aria-label={`Edit ${account.name}`}
                        >
                          <Pencil aria-hidden="true" />
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatCents(account.balance)}</TableCell>
                    <TableCell className="text-right">{formatCents(account.contributionBasis)}</TableCell>
                    <TableCell>{account.firstContributionYear ?? 'Unknown'}</TableCell>
                    <TableCell>{describeContribution(account.contribution)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eligibility for {year}</CardTitle>
          <CardDescription>
            Direct Roth IRA contributions phase out above an income range that depends on filing status. The check uses
            modified adjusted gross income (MAGI).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {readout.year ? (
            <MagiBreakdown year={readout.year} joint={joint} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Add a Roth IRA for {person.name} to see the MAGI estimate and this year’s allowed contribution.
            </p>
          )}
          <MagiOverride
            household={household}
            person={person}
            accounts={accounts}
            startValue={readout.year ? overrideStart(readout.year) : 0}
          />
          {readout.year ? <Readout readout={readout} /> : null}
        </CardContent>
      </Card>

      <AccountDialog
        household={household}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        account={dialog?.account}
        initialType="rothIra"
        initialOwnerId={person.id}
        lockType
      />
    </>
  );
}

/** Starting value when the override is switched on: the estimate, or gross pay if it is unavailable. */
function overrideStart(year: RothIraYear): number {
  if (year.magiSource === 'estimate' && year.magi !== null) return year.magi;
  const c = year.magiComponents;
  return c.salary + c.bonus + c.partTimeIncome;
}

function MagiBreakdown({ year, joint }: { year: RothIraYear; joint: boolean }) {
  const c = year.magiComponents;
  const rows: { label: string; value: number | null; sign: '' | '+' | '−' }[] = [
    { label: joint ? 'Base salaries (both people)' : 'Base salary', value: c.salary, sign: '' },
    { label: 'Bonus', value: c.bonus, sign: '+' },
  ];
  if (c.partTimeIncome > 0) rows.push({ label: 'Part-time income', value: c.partTimeIncome, sign: '+' });
  rows.push(
    { label: 'Traditional workplace deferrals (after limits)', value: c.traditionalDeferrals, sign: '−' },
    { label: 'HSA contributions (after limits)', value: c.hsaContributions, sign: '−' },
  );
  const estimate = year.magiSource === 'estimate' ? year.magi : null;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Estimated MAGI{joint ? ' (married filing jointly, both people combined)' : ''}
      </h3>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 border-b border-dashed py-1">
            <dt className="text-muted-foreground">
              <span aria-hidden="true" className="inline-block w-3">
                {r.sign}
              </span>
              {r.sign === '−' ? <span className="sr-only">minus </span> : null}
              {r.label}
            </dt>
            <dd className="tabular-nums">{r.value === null ? <UnverifiedValue /> : formatCents(r.value)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 py-1 font-semibold">
          <dt>
            <span aria-hidden="true" className="inline-block w-3">
              =
            </span>
            Estimated MAGI
          </dt>
          <dd className="tabular-nums">
            {year.magiSource === 'override' ? (
              <span className="font-normal text-muted-foreground">Not used (override on)</span>
            ) : estimate === null ? (
              <UnverifiedValue />
            ) : (
              formatCents(estimate)
            )}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Simplification: MAGI is estimated as salary + bonus − traditional workplace deferrals − HSA contributions (plus
        part-time pay). Actual MAGI also includes items such as investment income, so it can differ; an override can be
        entered below.
        {estimate === null && year.magiSource === 'estimate'
          ? ' Deferrals and HSA contributions after limits need rule values that are unverified, so the estimate is not available; an override can still be entered.'
          : ''}
      </p>
    </section>
  );
}

function MagiOverride({
  household,
  person,
  accounts,
  startValue,
}: {
  household: Household;
  person: Person;
  accounts: RothIraAccount[];
  startValue: number;
}) {
  const commit = useCommitHousehold();
  const [error, setError] = useState<string | undefined>();
  const current = accounts.find((a) => a.magiOverride !== null)?.magiOverride ?? null;
  const disabled = accounts.length === 0;

  const save = (value: number | null) => {
    const ids = new Set<string>(accounts.map((a) => a.id));
    const result = commit({
      ...household,
      accounts: household.accounts.map((a) =>
        a.type === 'rothIra' && ids.has(a.id) ? { ...a, magiOverride: value } : a,
      ),
    });
    setError(result.ok ? undefined : result.messages.join(' '));
  };

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Enter MAGI yourself"
        tip="Modified adjusted gross income from your tax return or tax software. When on, it replaces the estimate above for this person’s Roth IRA check. It starts from the estimate, or from gross pay when the estimate is not available."
        example={disabled ? `Available once ${person.name} has a Roth IRA` : 'Off uses the estimate above'}
      >
        {(a) => (
          <Switch
            id={a.id}
            aria-describedby={a['aria-describedby']}
            disabled={disabled}
            checked={current !== null}
            onCheckedChange={(on) => save(on ? startValue : null)}
          />
        )}
      </Field>
      {current !== null ? (
        <Field
          label="MAGI override"
          tip="Your own MAGI figure for this year, in dollars."
          example="For example, 185,000"
          error={error}
          className="max-w-xs"
        >
          {(a) => <MoneyInput {...a} value={current} onChange={(cents) => save(cents)} />}
        </Field>
      ) : null}
    </div>
  );
}

const STATUS_LABELS = {
  full: 'Full contribution allowed',
  reduced: 'Reduced by the income phase-out',
  ineligible: 'Above the income limit',
} as const;

function Readout({ readout }: { readout: RothReadout }) {
  const { year, requested, contributed, missing, warnings } = readout;
  const eligibility = year?.eligibility ?? null;
  const source = year?.magiSource === 'override' ? 'your MAGI override' : 'the MAGI estimate';
  if (eligibility === null || contributed === null) {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
          <span>Roth IRA this year:</span>
          <strong className="tabular-nums">{requested === 'max' ? 'the maximum' : formatCents(requested)}</strong>
          <span>of</span>
          <UnverifiedValue />
          <span>allowed</span>
        </p>
        <UnverifiedNotice missing={missing} feature="Roth IRA eligibility" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <p className="text-base">
        Roth IRA this year: <strong className="tabular-nums">{formatCents(contributed)}</strong> of{' '}
        <strong className="tabular-nums">{formatCents(eligibility.allowed)}</strong> allowed
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={eligibility.status === 'full' ? 'secondary' : 'attention'}>
          {STATUS_LABELS[eligibility.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">Based on {source}.</span>
      </div>
      <p className="text-sm text-muted-foreground">{eligibility.calculation}</p>
      {warnings.map((w) => (
        <Alert key={`${w.code}-${w.message}`} variant="attention">
          <p>{w.message}</p>
        </Alert>
      ))}
      {year && year.otherIraContributions !== null && year.otherIraContributions > 0 ? (
        <p className="text-xs text-muted-foreground">
          Traditional IRA contributions of {formatCents(year.otherIraContributions)} share this limit and are
          subtracted.
        </p>
      ) : null}
    </div>
  );
}

function NotModeledCard({ household }: { household: Household }) {
  const single = household.people.length === 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>What this page does not model</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Spousal IRA contributions for a non-working spouse are not supported: each person’s IRA contributions are
            capped at that person’s own earned income.
          </li>
          <li>Backdoor Roth contributions (for incomes above the limit) are not modeled.</li>
          <li>Traditional and Roth IRAs share one annual limit per person.</li>
          <li>
            Withdrawals: contribution basis is tracked separately from earnings. Qualified withdrawals (age 59½ and the
            5-year rule) and early withdrawals are modeled in a later milestone.
          </li>
          <li>Roth conversions are on the roadmap and not modeled.</li>
        </ul>
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground">
            The Roth vs traditional calculator compares the same workplace deferral made pre-tax or as Roth, filled from
            the plan.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {household.people.map((person) => (
              <li key={person.id}>
                <Link
                  to={calculatorHref('rothVsTraditional', { personId: person.id })}
                  className="font-medium underline underline-offset-4"
                >
                  {single ? 'Compare Roth vs traditional' : `Compare Roth vs traditional for ${person.name}`}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
