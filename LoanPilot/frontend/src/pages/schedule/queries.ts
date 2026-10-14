import { useQuery } from '@tanstack/react-query';
import { getSchedule, listScenarios } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';

/** Saved scenarios for the loan (the schedule's plan selector). */
export function useScenarios(loanId: number | null) {
  return useQuery({
    queryKey: queryKeys.scenarios(loanId ?? -1),
    queryFn: ({ signal }) => listScenarios(loanId as number, { signal }),
    enabled: loanId !== null,
  });
}

/**
 * GET /loans/{id}/schedule?scenarioId=. Switching plans keeps the previous schedule on screen
 * (dimmed) until the new one arrives, but never shows another loan's rows.
 */
export function useSchedule(loanId: number | null, scenarioId: number | null) {
  return useQuery({
    queryKey: queryKeys.schedule(loanId ?? -1, scenarioId),
    queryFn: ({ signal }) => getSchedule(loanId as number, scenarioId, { signal }),
    enabled: loanId !== null,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === loanId ? previous : undefined),
  });
}
