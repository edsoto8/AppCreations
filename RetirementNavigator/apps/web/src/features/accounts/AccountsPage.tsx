import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Account, Household, TaxTreatment } from '@rn/engine';
import { PageHeader } from '@/components/PageHeader';
import { RequireProfile } from '@/components/RequireProfile';
import { InfoTip } from '@/components/InfoTip';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents, formatPercent } from '@/lib/format';
import { AccountDialog } from './AccountDialog';
import {
  TAX_TREATMENT_LABELS,
  TAX_TREATMENT_TIPS,
  accountTypeLabel,
  deleteAccount,
  deletionBlockers,
  describeContribution,
  isWorkplace,
  taxTreatmentOf,
} from './accountModel';
import { useCommitHousehold } from './useCommitHousehold';

export function AccountsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Balances, contributions, expected returns and fees for each account. Workplace-plan contributions are set on Income & Savings."
      />
      <RequireProfile>{(household) => <AccountsBody household={household} />}</RequireProfile>
    </div>
  );
}

type Editing = { account?: Account } | null;

function AccountsBody({ household }: { household: Household }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const total = household.accounts.reduce((sum, a) => sum + a.balance, 0);
  const byTreatment = (['taxDeferred', 'taxFree', 'taxable'] as const).map((t) => ({
    treatment: t,
    total: household.accounts.filter((a) => taxTreatmentOf(a) === t).reduce((sum, a) => sum + a.balance, 0),
  }));

  return (
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>All accounts</CardTitle>
            <CardDescription>Current balances (today’s dollars).</CardDescription>
          </div>
          <Button onClick={() => setEditing({})}>
            <Plus aria-hidden="true" />
            Add account
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total balances" value={formatCents(total)} emphasis />
            {byTreatment.map((t) => (
              <Stat key={t.treatment} label={TAX_TREATMENT_LABELS[t.treatment]} value={formatCents(t.total)} />
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Expense ratios are annual percentages of the balance. Fees are modeled as return drag: each account’s
            expected return is reduced by its expense ratio.
          </p>
        </CardContent>
      </Card>

      {household.accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No accounts yet</CardTitle>
            <CardDescription>
              Add retirement, savings and investment accounts to include them in the plan.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {household.people.map((person) => {
        const accounts = household.accounts.filter((a) => a.ownerId === person.id);
        if (accounts.length === 0 && household.people.length === 1) return null;
        const subtotal = accounts.reduce((sum, a) => sum + a.balance, 0);
        return (
          <Card key={person.id}>
            <CardHeader>
              <CardTitle>{person.name}’s accounts</CardTitle>
              <CardDescription>
                {accounts.length} account{accounts.length === 1 ? '' : 's'} · {formatCents(subtotal)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accounts owned by {person.name}.</p>
              ) : (
                <AccountTable
                  label={`${person.name}’s accounts`}
                  accounts={accounts}
                  onEdit={(account) => setEditing({ account })}
                  onDelete={setDeleting}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      <AccountDialog
        household={household}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        account={editing?.account}
      />
      <DeleteAccountDialog household={household} account={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

function Stat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={emphasis ? 'text-lg font-semibold tabular-nums' : 'font-medium tabular-nums'}>{value}</dd>
    </div>
  );
}

function TreatmentCell({ treatment }: { treatment: TaxTreatment }) {
  return (
    <span className="inline-flex items-center gap-1">
      {TAX_TREATMENT_LABELS[treatment]}
      <InfoTip term={TAX_TREATMENT_LABELS[treatment]}>{TAX_TREATMENT_TIPS[treatment]}</InfoTip>
    </span>
  );
}

function AccountTable({
  label,
  accounts,
  onEdit,
  onDelete,
}: {
  label: string;
  accounts: Account[];
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
}) {
  return (
    <Table label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Account</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Tax treatment</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead>Expected return</TableHead>
          <TableHead className="text-right">Expense ratio</TableHead>
          <TableHead>Contributions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell>
              {/* Actions sit under the name so they stay on screen when the table scrolls on a phone. */}
              <div className="flex flex-col items-start gap-1">
                <span className="font-medium">{account.name}</span>
                <div className="-ml-3 flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(account)} aria-label={`Edit ${account.name}`}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(account)}
                    aria-label={`Delete ${account.name}`}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            </TableCell>
            <TableCell>{accountTypeLabel(account)}</TableCell>
            <TableCell>
              <TreatmentCell treatment={taxTreatmentOf(account)} />
            </TableCell>
            <TableCell className="text-right">{formatCents(account.balance)}</TableCell>
            <TableCell>
              {account.expectedReturn === null ? (
                <span className="text-muted-foreground">Household assumption</span>
              ) : (
                formatPercent(account.expectedReturn, 2)
              )}
            </TableCell>
            <TableCell className="text-right">{formatPercent(account.expenseRatio, 2)}</TableCell>
            <TableCell>
              {isWorkplace(account) ? (
                <Link to="/income" className="underline underline-offset-4">
                  Set on Income &amp; Savings
                </Link>
              ) : (
                describeContribution(account.contribution)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DeleteAccountDialog({
  household,
  account,
  onClose,
}: {
  household: Household;
  account: Account | null;
  onClose: () => void;
}) {
  const commit = useCommitHousehold();
  const [error, setError] = useState<string[]>([]);
  const blockers = account ? deletionBlockers(household, account.id) : [];

  const confirm = () => {
    if (!account) return;
    const result = deleteAccount(household, account.id);
    if (!result.ok) {
      setError(result.messages);
      return;
    }
    const saved = commit(result.household);
    if (saved.ok) {
      setError([]);
      onClose();
    } else {
      setError(saved.messages);
    }
  };

  return (
    <Dialog
      open={account !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError([]);
          onClose();
        }
      }}
    >
      <DialogContent>
        {account ? (
          blockers.length > 0 ? (
            <>
              <DialogTitle>{account.name} can’t be deleted yet</DialogTitle>
              <DialogDescription>Other parts of this plan point to this account:</DialogDescription>
              <Alert variant="attention" role="alert">
                <ul className="list-disc pl-4">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Alert>
              <p className="text-sm text-muted-foreground">
                Once those settings point elsewhere (for workplace plans, on{' '}
                <Link to="/income" className="font-medium text-foreground underline underline-offset-4">
                  Income &amp; Savings
                </Link>
                ), the account can be deleted here.
              </p>
              <div className="flex justify-end">
                <DialogClose asChild>
                  <Button variant="outline">Close</Button>
                </DialogClose>
              </div>
            </>
          ) : (
            <>
              <DialogTitle>Delete {account.name}?</DialogTitle>
              <DialogDescription>
                This removes the account and its {formatCents(account.balance)} balance from this profile. It can’t be
                undone.
              </DialogDescription>
              {error.length > 0 ? (
                <Alert variant="destructive" role="alert">
                  <ul className="list-disc pl-4">
                    {error.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button variant="destructive" onClick={confirm}>
                  Delete account
                </Button>
              </div>
            </>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
