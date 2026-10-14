import { TablePropertiesIcon } from 'lucide-react';
import { PagePlaceholder } from '@/components/PagePlaceholder';

export function SchedulePage() {
  return (
    <PagePlaceholder
      title="Amortization Schedule"
      description="Every payment with its interest, principal and remaining balance, monthly or by year, with CSV and Excel export."
      icon={<TablePropertiesIcon />}
      noLoanTitle="Select a loan to view its schedule"
      noLoanDescription="Choose a loan from the selector at the top, or add one, to see its payment-by-payment amortization schedule."
      readyTitle={(name) => `${name}: amortization schedule`}
      readyDescription="The monthly and annual schedule for this loan, with export to CSV and Excel, will be listed here."
    />
  );
}
