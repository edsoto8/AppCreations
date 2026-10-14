import { LightbulbIcon } from 'lucide-react';
import { PagePlaceholder } from '@/components/PagePlaceholder';

export function InsightsPage() {
  return (
    <PagePlaceholder
      title="Insights"
      description="Plain-language observations about your loan, each with the numbers and method behind it."
      icon={<LightbulbIcon />}
      noLoanTitle="Select a loan to see insights"
      noLoanDescription="Choose a loan from the selector at the top, or add one, to get rule-based insights about progress, interest and savings."
      readyTitle={(name) => `${name}: insights`}
      readyDescription="Every insight for this loan, grouped by progress, savings and warnings, will be listed here."
    />
  );
}
