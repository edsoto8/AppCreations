import { ReceiptIcon } from 'lucide-react';
import { PagePlaceholder } from '@/components/PagePlaceholder';

export function PaymentsPage() {
  return (
    <PagePlaceholder
      title="Payments"
      description="Record the payments you have made, import them from CSV, and track actual against scheduled payments."
      icon={<ReceiptIcon />}
      noLoanTitle="Select a loan to track payments"
      noLoanDescription="Choose a loan from the selector at the top, or add one, to record payments, import a CSV and compare actual against scheduled payments."
      readyTitle={(name) => `${name}: payment history`}
      readyDescription="Payment records, CSV import and tracking against the schedule for this loan will be shown here."
    />
  );
}
