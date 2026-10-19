import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { AccumulationPreview, Household, Person, ResolvedYearRules } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { UnverifiedNotice, UnverifiedValue } from '@/components/UnverifiedNotice';
import { Field } from '@/components/form/Field';
import { MoneyInput } from '@/components/form/inputs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { useEngineContext, useResolvedRules } from '@/hooks/useEngine';
import { formatCents } from '@/lib/format';
import { AccountDialog } from '@/features/accounts/AccountDialog';
import { describeContribution, upsertAccount } from '@/features/accounts/accountModel';
import {
  hsaThisYear,
  personYearOne,
  previewYearOne,
  type HsaAccount,
  type PersonYearOne,
} from '@/features/accounts/thisYear';
import { useCommitHousehold } from '@/features/accounts/useCommitHousehold';

export function HsaPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="HSA"
        description="Health savings accounts: coverage, contributions and this year’s limit, plus the medical expenses an HSA pays for."
      />
      <RequireProfile>{(household) => <HsaBody household={household} />}</RequireProfile>
    </div>
  );
}

function HsaBody({ household }: { household: Household }) {
  const ctx = useEngineContext();
  const rules = useResolvedRules(household);
  const year = ctx.currentYear;
  const preview = useMemo(() => previewYearOne(household, ctx), [household, ctx]);
  const [dialog, setDialog] = useState<{ account?: HsaAccount } | null>(null);
  const hsas = household.accounts.filter((a): a is HsaAccount => a.type === 'hsa');

  return (
    <>
      {hsas.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No HSA yet</CardTitle>
            <CardDescription>
              A health savings account pairs with a high-deductible health plan (HDHP). Add one to include its balance
              and contributions in the plan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setDialog({})}>
              <Plus aria-hidden="true" />
              Add an HSA
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setDialog({})}>
              <Plus aria-hidden="true" />
              Add an HSA
            </Button>
          </div>
          {hsas.map((account) => {
            const owner = household.people.find((p) => p.id === account.ownerId);
            if (!owner) return null;
            return (
              <HsaCard
                key={account.id}
                household={household}
                account={account}
                owner={owner}
                ownerYear={personYearOne(preview, owner, year)}
                preview={preview}
                rules={rules}
                onEdit={() => setDialog({ account })}
              />
            );
          })}
        </>
      )}

      <MedicalExpensesCard household={household} />

      <Card>
        <CardHeader>
          <CardTitle>Withdrawals</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>Qualified medical withdrawals are tax-free up to the yearly medical-expense amount above.</li>
            <li>Non-medical withdrawals after 65 are taxed as ordinary income.</li>
            <li>Non-medical withdrawals before 65 are flagged as penalized (simplified).</li>
            <li>HSA withdrawals are modeled in a later milestone (M4). Everything else about HSAs is unsupported.</li>
          </ul>
        </CardContent>
      </Card>

      <AccountDialog
        household={household}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        account={dialog?.account}
        initialType="hsa"
        lockType
      />
    </>
  );
}

function HsaCard({
  household,
  account,
  owner,
  ownerYear,
  preview,
  rules,
  onEdit,
}: {
  household: Household;
  account: HsaAccount;
  preview: AccumulationPreview | null;
  owner: Person;
  ownerYear: PersonYearOne;
  rules: ResolvedYearRules;
  onEdit: () => void;
}) {
  const commit = useCommitHousehold();
  const [error, setError] = useState<string | undefined>();
  const hsa = hsaThisYear(account, ownerYear, preview, rules);

  const save = (patch: Partial<Pick<HsaAccount, 'coverage' | 'hdhpAttested'>>) => {
    const result = commit(upsertAccount(household, { ...account, ...patch }));
    setError(result.ok ? undefined : result.messages.join(' '));
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{account.name}</CardTitle>
          <CardDescription>
            {owner.name} · balance {formatCents(account.balance)}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${account.name}`}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="HDHP coverage type"
            tip="Self-only or family coverage under the high-deductible health plan. It sets which HSA limit applies."
            example="Family if the plan covers anyone besides the owner"
          >
            {(a) => (
              <NativeSelect
                {...a}
                value={account.coverage}
                onChange={(e) => save({ coverage: e.target.value as HsaAccount['coverage'] })}
              >
                <option value="selfOnly">Self-only</option>
                <option value="family">Family</option>
              </NativeSelect>
            )}
          </Field>
          <Field
            label="Covered by a high-deductible health plan (HDHP)"
            tip="HSA contributions are allowed only while covered by an HDHP. With this off, the model contributes nothing to this HSA; the balance still grows."
            example="On if the health plan is HSA-eligible"
            error={error}
          >
            {(a) => (
              <Switch
                id={a.id}
                aria-describedby={a['aria-describedby']}
                checked={account.hdhpAttested}
                onCheckedChange={(on) => save({ hdhpAttested: on })}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Contribution: </span>
            {describeContribution(account.contribution)}
          </p>
        </div>

        <HsaReadout hsa={hsa} />
      </CardContent>
    </Card>
  );
}

function HsaReadout({ hsa }: { hsa: ReturnType<typeof hsaThisYear> }) {
  const { limit, requested } = hsa;
  if (limit.status === 'unverified') {
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
          <span>HSA this year:</span>
          <strong className="tabular-nums">{requested === 'max' ? 'the maximum' : formatCents(requested)}</strong>
          <span>of</span>
          <UnverifiedValue />
          <span>allowed</span>
        </p>
        <UnverifiedNotice missing={limit.missing} feature="the HSA contribution limit" />
      </div>
    );
  }
  if (limit.status === 'invalid') {
    return (
      <Alert variant="destructive" role="alert">
        <ul className="list-disc pl-4">
          {limit.issues.map((i) => (
            <li key={`${i.path.join('.')}-${i.message}`}>{i.message}</li>
          ))}
        </ul>
      </Alert>
    );
  }
  const planned = hsa.planned ?? 0;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <p className="text-base">
        HSA this year: <strong className="tabular-nums">{formatCents(planned)}</strong> of{' '}
        <strong className="tabular-nums">{formatCents(limit.value)}</strong> allowed
      </p>
      {requested !== 'max' && requested > limit.value ? (
        <Alert variant="attention">
          <p>
            The schedule asks for {formatCents(requested)}; the forecast caps it at the {formatCents(limit.value)}{' '}
            limit.
          </p>
        </Alert>
      ) : null}
      {limit.warnings.map((w) => (
        <Alert key={`${w.code}-${w.message}`} variant="attention">
          <p>{w.message}</p>
        </Alert>
      ))}
    </div>
  );
}

function MedicalExpensesCard({ household }: { household: Household }) {
  const commit = useCommitHousehold();
  const [error, setError] = useState<string | undefined>();
  const value = household.spending.hsaQualifiedMedicalExpenses;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Qualified medical expenses</CardTitle>
        <CardDescription>
          The household’s yearly medical costs paid from HSAs, in today’s dollars. HSA withdrawals are modeled in a
          later milestone; this amount is saved now and used then.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field
          label="Qualified medical expenses per year"
          tip="Out-of-pocket medical costs that qualify for tax-free HSA withdrawals (for example, deductibles and prescriptions). Entered in today’s dollars."
          example="For example, 3,000 (default 0)"
          error={error}
          className="max-w-xs"
        >
          {(a) => (
            <MoneyInput
              {...a}
              value={value}
              onChange={(cents) => {
                const result = commit({
                  ...household,
                  spending: { ...household.spending, hsaQualifiedMedicalExpenses: cents },
                });
                setError(result.ok ? undefined : result.messages.join(' '));
              }}
            />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}
