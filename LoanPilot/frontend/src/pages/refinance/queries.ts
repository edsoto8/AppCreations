import { useQuery } from '@tanstack/react-query';
import { refinance } from '@/api/endpoints';
import type { RefinanceInput } from '@/api/types';

/** Query key under the ['loans'] root so loan/payment mutations refresh the comparison. */
export const refinanceKey = (loanId: number, input: RefinanceInput | null) => ['loans', loanId, 'refinance', input] as const;

/**
 * POST /loans/{id}/refinance for the (already debounced) input. Disabled while the form is
 * incomplete; keeps the previous result on screen while a new one loads.
 */
export function useRefinance(loanId: number | null, input: RefinanceInput | null) {
  return useQuery({
    queryKey: refinanceKey(loanId ?? -1, input),
    queryFn: ({ signal }) => refinance(loanId as number, input as RefinanceInput, { signal }),
    enabled: loanId !== null && input !== null,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === loanId ? previous : undefined),
  });
}
