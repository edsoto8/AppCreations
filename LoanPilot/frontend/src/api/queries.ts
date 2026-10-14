import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from './client';
import * as api from './endpoints';
import type { LoanInput } from './types';

/**
 * Query keys. Everything that belongs to a loan lives under ['loans', ...] so a single
 * `invalidateQueries({ queryKey: queryKeys.loansRoot })` after a loan mutation refreshes
 * every list, dashboard, schedule, comparison, etc.
 */
export const queryKeys = {
  loansRoot: ['loans'] as const,
  loanList: (includeArchived: boolean) => ['loans', 'list', { includeArchived }] as const,
  loan: (id: number) => ['loans', id] as const,
  dashboard: (id: number) => ['loans', id, 'dashboard'] as const,
  scenarios: (id: number) => ['loans', id, 'scenarios'] as const,
  comparison: (id: number, budget: number | null) => ['loans', id, 'comparison', budget] as const,
  insights: (id: number) => ['loans', id, 'insights'] as const,
  schedule: (id: number, scenarioId: number | null) => ['loans', id, 'schedule', scenarioId] as const,
  payments: (id: number) => ['loans', id, 'payments'] as const,
  tracking: (id: number) => ['loans', id, 'tracking'] as const,
  preferences: ['preferences'] as const,
  preview: (input: LoanInput | null) => ['preview', input] as const,
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Client errors (400/404) will not fix themselves; a down server gets one retry.
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}

export function useLoans(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.loanList(includeArchived),
    queryFn: ({ signal }) => api.listLoans(includeArchived, { signal }),
  });
}

export function useLoan(id: number | null) {
  return useQuery({
    queryKey: queryKeys.loan(id ?? -1),
    queryFn: ({ signal }) => api.getLoan(id as number, { signal }),
    enabled: id !== null,
  });
}

export function useDashboard(id: number | null) {
  return useQuery({
    queryKey: queryKeys.dashboard(id ?? -1),
    queryFn: ({ signal }) => api.getDashboard(id as number, { signal }),
    enabled: id !== null,
  });
}

/** Loan mutations. Each one invalidates everything under ['loans'] on success. */
export function useLoanMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.loansRoot });

  const create = useMutation({ mutationFn: (input: LoanInput) => api.createLoan(input), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: LoanInput }) => api.updateLoan(id, input),
    onSuccess: invalidate,
  });
  const archive = useMutation({ mutationFn: (id: number) => api.archiveLoan(id), onSuccess: invalidate });
  const unarchive = useMutation({ mutationFn: (id: number) => api.unarchiveLoan(id), onSuccess: invalidate });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteLoan(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: queryKeys.loan(id) });
      return invalidate();
    },
  });

  return { create, update, archive, unarchive, remove };
}
