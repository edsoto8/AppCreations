import { GitCompareArrowsIcon } from 'lucide-react';
import { PagePlaceholder } from '@/components/PagePlaceholder';

export function ComparePage() {
  return (
    <PagePlaceholder
      title="Scenario Comparison"
      description="Compare your saved scenarios and common presets side by side: payoff date, interest and monthly outlay."
      icon={<GitCompareArrowsIcon />}
      noLoanTitle="Select a loan to compare scenarios"
      noLoanDescription="Choose a loan from the selector at the top, or add one, to compare payoff scenarios side by side."
      readyTitle={(name) => `${name}: scenario comparison`}
      readyDescription="Saved scenarios and presets for this loan will be compared here, with the best option for each goal highlighted."
    />
  );
}
