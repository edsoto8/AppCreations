import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, CarFrontIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/QueryError';
import { errorMessage, isApiError } from '@/api/client';
import { useLoan, useLoanMutations } from '@/api/queries';
import type { Loan } from '@/api/types';
import { usePreferences } from '@/context/PreferencesContext';
import { emptyLoanForm, loanToForm } from './loanForm';
import { LoanForm } from './LoanForm';

/** /loans/new and /loans/:id/edit */
export function LoanDetailsPage() {
  const params = useParams();
  const id = params.id !== undefined ? Number(params.id) : null;
  return id === null ? <NewLoan /> : Number.isInteger(id) && id > 0 ? <EditLoan id={id} /> : <MissingLoan />;
}

function NewLoan() {
  const { preferences } = usePreferences();
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Loan details"
        title="Add a loan"
        description="Enter your contract terms. A live estimate updates on the right as you type."
      />
      <LoanForm mode="create" initialValues={emptyLoanForm(preferences.defaultAccrualMethod)} />
    </div>
  );
}

function EditLoan({ id }: { id: number }) {
  const query = useLoan(id);

  if (query.isPending) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[480px] rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    if (isApiError(query.error) && query.error.isNotFound) return <MissingLoan />;
    return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  }

  const loan = query.data;
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Loan details"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {loan.name}
            {loan.isArchived && <Badge variant="secondary">Archived</Badge>}
          </span>
        }
        description="Changes recalculate your dashboard, schedule and scenarios when you save."
        actions={<LoanActions loan={loan} />}
      />
      {/* Re-mount the form when the saved loan changes so it starts from the server copy. */}
      <LoanForm key={`${loan.id}-${loan.updatedAt}`} mode="edit" loan={loan} initialValues={loanToForm(loan)} />
    </div>
  );
}

function LoanActions({ loan }: { loan: Loan }) {
  const navigate = useNavigate();
  const { archive, unarchive, remove } = useLoanMutations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = archive.isPending || unarchive.isPending || remove.isPending;

  const toggleArchive = async () => {
    try {
      if (loan.isArchived) {
        await unarchive.mutateAsync(loan.id);
        toast.success(`${loan.name} restored`);
      } else {
        await archive.mutateAsync(loan.id);
        toast.success(`${loan.name} archived`, { description: 'It is hidden from the loan selector. Restore it any time from Settings.' });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onDelete = async () => {
    try {
      await remove.mutateAsync(loan.id);
      setConfirmOpen(false);
      toast.success(`${loan.name} deleted`);
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <Button variant="outline" onClick={toggleArchive} disabled={busy}>
        {loan.isArchived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
        {loan.isArchived ? 'Unarchive' : 'Archive'}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="text-negative hover:text-negative" disabled={busy}>
            <Trash2Icon /> Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {loan.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the loan with its saved scenarios and payment records. It cannot be undone. Archive it
              instead if you only want to hide it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep loan</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                void onDelete();
              }}
            >
              {remove.isPending && <LoaderCircleIcon className="animate-spin" />}
              Delete loan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MissingLoan() {
  return (
    <EmptyState
      icon={<CarFrontIcon />}
      title="This loan could not be found"
      description="It may have been deleted. Pick another loan from the selector, or add a new one."
      action={
        <>
          <Button variant="outline" asChild>
            <Link to="/">
              <ArrowLeftIcon /> Dashboard
            </Link>
          </Button>
          <Button asChild>
            <Link to="/loans/new">Add a loan</Link>
          </Button>
        </>
      }
    />
  );
}
