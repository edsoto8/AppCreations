import { SlidersHorizontalIcon } from 'lucide-react';
import { PagePlaceholder } from '@/components/PagePlaceholder';

export function SimulatorPage() {
  return (
    <PagePlaceholder
      title="Payoff Simulator"
      description="Model recurring extra payments, lump sums, a target payoff date or a monthly budget, and see the effect instantly."
      icon={<SlidersHorizontalIcon />}
      noLoanTitle="Select a loan to simulate payoff strategies"
      noLoanDescription="Choose a loan from the selector at the top, or add one, to model extra payments and lump sums against its schedule."
      readyTitle={(name) => `${name}: payoff strategies`}
      readyDescription="Extra-payment, lump-sum, target-date and budget scenarios for this loan will be shown here."
    />
  );
}
