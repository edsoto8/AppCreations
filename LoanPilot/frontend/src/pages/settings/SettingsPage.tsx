import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CloudOffIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CurrencyInput } from '@/components/CurrencyInput';
import { Disclaimer } from '@/components/Disclaimer';
import { FieldInfo } from '@/components/FieldInfo';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { THEME_OPTIONS } from '@/components/layout/ThemeToggle';
import { errorMessage } from '@/api/client';
import { useLoanMutations, useLoans } from '@/api/queries';
import type { AccrualMethod, LoanListItem, ThemePreference } from '@/api/types';
import { usePreferences } from '@/context/PreferencesContext';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, formatMonthYear, formatPercent, SUPPORTED_CURRENCIES } from '@/lib/format';

export function SettingsPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="Settings" description="Preferences are stored with your local LoanPilot data." />
      <PreferencesCard />
      <LoansCard />
      <AboutCalculationsCard />
    </div>
  );
}

function SettingRow({
  label,
  description,
  htmlFor,
  info,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={htmlFor}>{label}</Label>
          {info}
        </div>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

function PreferencesCard() {
  const { preferences, updatePreferences, isServerBacked, isLoading } = usePreferences();
  const { theme, setTheme } = useTheme();
  const [budget, setBudget] = useState<number | null>(preferences.comparisonBudget);
  const [budgetSeen, setBudgetSeen] = useState(preferences.comparisonBudget);
  // Follow the stored value when it arrives from the server (render-time sync, no effect needed).
  if (preferences.comparisonBudget !== budgetSeen) {
    setBudgetSeen(preferences.comparisonBudget);
    setBudget(preferences.comparisonBudget);
  }

  const saveBudget = () => {
    if (budget === preferences.comparisonBudget) return;
    if (budget !== null && budget <= 0) return;
    void updatePreferences({ comparisonBudget: budget });
    toast.success(budget === null ? 'Comparison budget cleared' : `Comparison budget set to ${formatCurrency(budget, preferences.currency)}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preferences</CardTitle>
        <CardDescription>Appearance, currency and defaults for new loans.</CardDescription>
      </CardHeader>
      <CardContent>
        {!isLoading && !isServerBacked && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <CloudOffIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The LoanPilot server is not reachable, so these choices are kept in this browser for now.
          </div>
        )}
        <div className="divide-y">
          <SettingRow label="Theme" description="Light, dark, or follow your system setting.">
            <ToggleGroup
              type="single"
              variant="outline"
              className="w-full"
              aria-label="Theme"
              value={theme}
              onValueChange={(v) => v && setTheme(v as ThemePreference)}
            >
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <ToggleGroupItem key={value} value={value} aria-label={label} className="gap-1.5">
                  <Icon aria-hidden /> {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
          <SettingRow label="Currency" htmlFor="pref-currency" description="Used to display every amount. Calculations are unaffected.">
            <Select value={preferences.currency} onValueChange={(v) => void updatePreferences({ currency: v })}>
              <SelectTrigger id="pref-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} · {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            label="Default accrual method"
            info={<FieldInfo term="accrualMethod" />}
            htmlFor="pref-accrual"
            description="Pre-selected when you add a new loan."
          >
            <Select
              value={preferences.defaultAccrualMethod}
              onValueChange={(v) => void updatePreferences({ defaultAccrualMethod: v as AccrualMethod })}
            >
              <SelectTrigger id="pref-accrual">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly periodic</SelectItem>
                <SelectItem value="dailySimple">Daily simple interest</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            label="Comparison budget"
            htmlFor="pref-budget"
            description="The most you could pay per month. Scenario Comparison highlights the best option within it (biweekly and weekly payments are converted to monthly). Leave blank for none."
          >
            <CurrencyInput
              id="pref-budget"
              value={budget}
              min={0.01}
              onValueChange={setBudget}
              onBlur={saveBudget}
              placeholder="e.g. 750.00"
            />
          </SettingRow>
        </div>
      </CardContent>
    </Card>
  );
}

function LoansCard() {
  const query = useLoans(true);
  const { archive, unarchive, remove } = useLoanMutations();
  const { preferences } = usePreferences();
  const [toDelete, setToDelete] = useState<LoanListItem | null>(null);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Loans</CardTitle>
        <CardDescription>All loans, including archived ones. Archived loans are hidden from the loan selector.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
            No loans yet.
            <Button asChild size="sm">
              <Link to="/loans/new">
                <PlusIcon /> Add a loan
              </Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loan</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Repaid</TableHead>
                  <TableHead className="hidden md:table-cell">Payoff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((item) => (
                  <TableRow key={item.loan.id}>
                    <TableCell className="max-w-48 truncate font-medium">{item.loan.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.currentBalance, preferences.currency)}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{formatPercent(item.percentRepaid, 1)}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{item.payoffDate ? formatMonthYear(item.payoffDate) : '—'}</TableCell>
                    <TableCell>
                      {item.loan.isArchived ? (
                        <Badge variant="secondary">Archived</Badge>
                      ) : item.isPaidOff ? (
                        <Badge variant="positive">Paid off</Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.loan.name}`}>
                            <EllipsisIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/loans/${item.loan.id}/edit`}>
                              <PencilIcon /> Edit
                            </Link>
                          </DropdownMenuItem>
                          {item.loan.isArchived ? (
                            <DropdownMenuItem onSelect={() => void run(() => unarchive.mutateAsync(item.loan.id), `${item.loan.name} restored`)}>
                              <ArchiveRestoreIcon /> Unarchive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => void run(() => archive.mutateAsync(item.loan.id), `${item.loan.name} archived`)}>
                              <ArchiveIcon /> Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(item)}>
                            <Trash2Icon /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.loan.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the loan with its saved scenarios and payment records. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep loan</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!toDelete) return;
                const target = toDelete;
                void run(() => remove.mutateAsync(target.loan.id), `${target.loan.name} deleted`).then(() => setToDelete(null));
              }}
            >
              {remove.isPending && <LoaderCircleIcon className="animate-spin" />}
              Delete loan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const ALLOCATION_RULES: { title: string; body: string }[] = [
  {
    title: 'Interest first, then principal',
    body: 'Each payment first covers the interest that has accrued since the last payment. Whatever is left reduces the principal balance.',
  },
  {
    title: 'Extra payments go to principal',
    body: 'Recurring extra amounts are applied to principal on top of the scheduled payment. They never reduce, replace or skip the next scheduled payment.',
  },
  {
    title: 'Lump sums are principal-only',
    body: 'A one-time payment lowers the principal on its date, so less interest accrues from then on.',
  },
  {
    title: 'Interest is not compounded',
    body: 'Interest is charged on principal only. If a payment cannot cover the interest due, the unpaid interest is carried separately and is never added to the principal.',
  },
  {
    title: 'Two ways to accrue interest',
    body: 'Monthly periodic charges APR ÷ periods per year (÷ 12 for monthly payments) each period. Daily simple interest charges a daily rate for the actual days between payments, using Actual/365 or Actual/Actual.',
  },
  {
    title: 'Existing loans start from your balance',
    body: 'For a loan already in progress, projections start from the principal balance and as-of date you enter. Past history is not reconstructed.',
  },
];

function AboutCalculationsCard() {
  return (
    <Card id="about-calculations">
      <CardHeader>
        <CardTitle className="text-base">About the calculations</CardTitle>
        <CardDescription>How LoanPilot applies payments. All figures are computed on this device by the LoanPilot engine.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          {ALLOCATION_RULES.map((r) => (
            <div key={r.title} className="grid content-start gap-1">
              <dt className="text-sm font-medium">{r.title}</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{r.body}</dd>
            </div>
          ))}
        </dl>
        <Disclaimer />
      </CardContent>
    </Card>
  );
}
