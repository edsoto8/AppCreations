import { RefreshCcwIcon } from 'lucide-react';
import { PagePlaceholder } from '@/components/PagePlaceholder';

export function RefinancePage() {
  return (
    <PagePlaceholder
      title="Refinance"
      description="Check whether a new rate and term would save money, and when the fees would pay for themselves."
      icon={<RefreshCcwIcon />}
      noLoanTitle="Select a loan to evaluate a refinance"
      noLoanDescription="Choose a loan from the selector at the top, or add one, to compare it against a refinanced loan and find the break-even month."
      readyTitle={(name) => `${name}: refinance analysis`}
      readyDescription="Refinance offers for this loan will be compared here, with break-even month and lifetime savings."
    />
  );
}
