import { useMemo } from 'react';
import {
  RULES,
  resolveRules,
  type EngineContext,
  type Household,
  type NominalRate,
  type ResolvedYearRules,
} from '@rn/engine';
import { CURRENT_YEAR } from '@/app/env';

/** Engine context: the current year (read once in the UI layer) and the bundled rules. */
export function useEngineContext(): EngineContext {
  return useMemo(() => ({ currentYear: CURRENT_YEAR, rules: RULES }), []);
}

/** Rules in force for `year` under the household's anchor-year and indexing assumptions. */
export function useResolvedRules(household: Household, year: number = CURRENT_YEAR): ResolvedYearRules {
  const { anchorYear, indexing } = household.assumptions.rules;
  const inflation = household.assumptions.inflation;
  return useMemo(
    () =>
      resolveRules(RULES, {
        anchorYear,
        targetYear: year,
        indexRate: (indexing.mode === 'inflation' ? inflation : indexing.rate) as NominalRate,
      }),
    [anchorYear, indexing, inflation, year],
  );
}
