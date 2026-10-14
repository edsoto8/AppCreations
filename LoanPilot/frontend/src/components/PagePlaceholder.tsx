import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useLoanContext } from '@/context/LoanContext';

interface PagePlaceholderProps {
  title: string;
  description: string;
  icon: ReactNode;
  /** Shown when no loan exists / is selected, e.g. "Select a loan to model extra payments". */
  noLoanTitle: string;
  noLoanDescription: string;
  /** Shown when a loan is selected but this page has not been built yet. */
  readyTitle: (loanName: string) => string;
  readyDescription: string;
}

/**
 * Placeholder page frame used by sections other engineers will fill in. Replace the body of the
 * page component in src/pages/<name>/ — the route, nav item and header are already wired.
 */
export function PagePlaceholder({
  title,
  description,
  icon,
  noLoanTitle,
  noLoanDescription,
  readyTitle,
  readyDescription,
}: PagePlaceholderProps) {
  const { selectedLoan, loans, isLoading } = useLoanContext();
  return (
    <div className="grid gap-6">
      <PageHeader title={title} description={description} />
      {isLoading ? null : selectedLoan ? (
        <EmptyState icon={icon} title={readyTitle(selectedLoan.loan.name)} description={readyDescription} />
      ) : (
        <EmptyState
          icon={icon}
          title={noLoanTitle}
          description={noLoanDescription}
          action={
            loans.length === 0 ? (
              <Button asChild>
                <Link to="/loans/new">
                  <PlusIcon /> Add a loan
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
