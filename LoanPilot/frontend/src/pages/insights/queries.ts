import { useQuery } from '@tanstack/react-query';
import { getInsights } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';

/** GET /loans/{id}/insights: every rule-based insight for the loan. */
export function useInsights(loanId: number | null) {
  return useQuery({
    queryKey: queryKeys.insights(loanId ?? -1),
    queryFn: ({ signal }) => getInsights(loanId as number, { signal }),
    enabled: loanId !== null,
  });
}
