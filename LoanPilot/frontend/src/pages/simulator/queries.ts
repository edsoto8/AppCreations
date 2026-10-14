/**
 * React Query hooks for the payoff simulator and scenario comparison. Keys live under the
 * ['loans', id, ...] root (see api/queries.ts) so loan mutations refresh them, and every scenario
 * mutation invalidates that root so the dashboard, insights and comparison pick up the change.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import type { IsoDate, ScenarioInput } from '@/api/types';

export const simulatorKeys = {
  simulate: (loanId: number, input: ScenarioInput) => ['loans', loanId, 'simulate', input] as const,
  target: (loanId: number, date: IsoDate) => ['loans', loanId, 'target-payoff', date] as const,
  budget: (loanId: number, budget: number) => ['loans', loanId, 'budget', budget] as const,
};

/** POST /simulate. Keeps the previous result on screen while the next one loads (no flicker). */
export function useSimulation(loanId: number, input: ScenarioInput, enabled: boolean) {
  return useQuery({
    queryKey: simulatorKeys.simulate(loanId, input),
    queryFn: ({ signal }) => api.simulate(loanId, input, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useTargetPayoff(loanId: number, targetDate: IsoDate | null, enabled: boolean) {
  return useQuery({
    queryKey: simulatorKeys.target(loanId, targetDate ?? ''),
    queryFn: ({ signal }) => api.solveTargetPayoff(loanId, targetDate as IsoDate, { signal }),
    enabled: enabled && targetDate !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useBudgetPayoff(loanId: number, budget: number | null, enabled: boolean) {
  return useQuery({
    queryKey: simulatorKeys.budget(loanId, budget ?? 0),
    queryFn: ({ signal }) => api.solveBudget(loanId, budget as number, { signal }),
    enabled: enabled && budget !== null && budget > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useScenarios(loanId: number | null) {
  return useQuery({
    queryKey: queryKeys.scenarios(loanId ?? -1),
    queryFn: ({ signal }) => api.listScenarios(loanId as number, { signal }),
    enabled: loanId !== null,
  });
}

export function useComparison(loanId: number | null, budget: number | null) {
  return useQuery({
    queryKey: queryKeys.comparison(loanId ?? -1, budget),
    queryFn: ({ signal }) => api.getComparison(loanId as number, budget, { signal }),
    enabled: loanId !== null,
    placeholderData: keepPreviousData,
  });
}

/** Create / update / delete saved scenarios. Each invalidates everything under ['loans']. */
export function useScenarioMutations(loanId: number) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.loansRoot });

  const create = useMutation({
    mutationFn: (input: ScenarioInput) => api.createScenario(loanId, input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ScenarioInput }) => api.updateScenario(loanId, id, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteScenario(loanId, id),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
