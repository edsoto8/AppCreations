import { Link } from 'react-router';
import { RefreshCwIcon } from 'lucide-react';
import type { LoanStatus, PaymentRecord } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatCount, formatDate } from '@/lib/format';

/**
 * Projections start from the loan's balance date and never use payment records, so once payments are
 * recorded after that date the user is asked to enter a newer balance from their statement.
 */
export function UpdateBalancePrompt({ loanId, status, records }: { loanId: number; status: LoanStatus | null; records: PaymentRecord[] }) {
  if (!status || status.isPaidOff) return null;
  const newer = records.filter((r) => r.date > status.balanceAsOf);
  if (newer.length === 0) return null;

  const latest = newer.reduce((a, b) => (b.date > a.date ? b : a));
  return (
    <Alert variant="warning" data-testid="update-balance-prompt">
      <RefreshCwIcon />
      <AlertTitle>{status.balanceIsEstimated ? 'Enter your current balance to include these payments' : 'Update your balance to include these payments'}</AlertTitle>
      <AlertDescription>
        <p>
          You have recorded {formatCount(newer.length, 'payment')} after{' '}
          {status.balanceIsEstimated ? 'the date your balance is estimated from' : 'your balance date'} ({formatDate(status.balanceAsOf)}), the latest on{' '}
          {formatDate(latest.date)}. Payment records don&apos;t change your projections:{' '}
          {status.balanceIsEstimated
            ? 'the estimated balance assumes only scheduled payments.'
            : 'the dashboard, schedule and saved plans still start from that balance.'}{' '}
          Enter the balance from your latest statement so any extra payments are reflected.
        </p>
        <Button asChild size="sm" className="mt-2">
          <Link to={`/loans/${loanId}/edit?focus=currentBalance`}>
            <RefreshCwIcon /> Update balance
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
