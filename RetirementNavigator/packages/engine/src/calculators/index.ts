/**
 * The 15 standalone calculators (docs/financial-model.md §12). Each validates its own input, builds
 * an engine input and reports figures read from engine results; none has a formula of its own (the
 * M7a "no duplicated formulas" gate, checked by `noDuplicatedFormulas.test.ts`).
 *
 * `runCalculator` dispatches by `CalculatorId` for callers holding untyped input (forms, workers).
 */
import type { CalculatorId, EngineContext } from '../api';
import type { EngineResult } from '../domain/results';
import { baristaFire } from './baristaFire';
import { coastFire } from './coastFire';
import { compoundInterest } from './compoundInterest';
import { contribution401k } from './contribution401k';
import { feeImpact } from './feeImpact';
import { fiNumber } from './fiNumber';
import { inflationPurchasingPower } from './inflationPurchasingPower';
import { lumpSumVsRecurring } from './lumpSumVsRecurring';
import { matchOptimizer } from './matchOptimizer';
import { retirementAge } from './retirementAge';
import { rothVsTraditional } from './rothVsTraditional';
import { savingsGap } from './savingsGap';
import { spendingPlanner } from './spendingPlanner';
import { ssClaimingComparison } from './ssClaimingComparison';
import { withdrawal } from './withdrawal';

export {
  compoundInterest,
  CompoundInterestInputSchema,
  type CompoundInterestInput,
  type CompoundInterestResult,
  type GrowthTotals,
} from './compoundInterest';
export {
  contribution401k,
  Contribution401kInputSchema,
  type Contribution401kInput,
  type Contribution401kResult,
  type Contribution401kRow,
} from './contribution401k';
export {
  matchOptimizer,
  MatchOptimizerInputSchema,
  type MatchOptimizerInput,
  type MatchOptimizerResult,
  type MatchScanRow,
} from './matchOptimizer';
export {
  rothVsTraditional,
  RothVsTraditionalInputSchema,
  type RothVsTraditionalInput,
  type RothVsTraditionalResult,
  type RothVsTraditionalSide,
} from './rothVsTraditional';
export {
  retirementAge,
  RetirementAgeInputSchema,
  type RetirementAgeInput,
  type RetirementAgeResult,
} from './retirementAge';
export { savingsGap, SavingsGapInputSchema, type SavingsGapInput, type SavingsGapResult } from './savingsGap';
export {
  inflationPurchasingPower,
  InflationPurchasingPowerInputSchema,
  type InflationPurchasingPowerInput,
  type InflationPurchasingPowerResult,
  type PurchasingPowerRow,
} from './inflationPurchasingPower';
export {
  withdrawal,
  WithdrawalInputSchema,
  type WithdrawalInput,
  type WithdrawalResult,
  type WithdrawalRow,
  type DrawdownRun,
  type Longevity,
} from './withdrawal';
export {
  ssClaimingComparison,
  SsClaimingComparisonInputSchema,
  type SsClaimingComparisonInput,
  type SsClaimingComparisonResult,
  type ClaimingOption,
} from './ssClaimingComparison';
export {
  feeImpact,
  FeeImpactInputSchema,
  type FeeImpactInput,
  type FeeImpactResult,
  type FeeImpactRow,
} from './feeImpact';
export {
  lumpSumVsRecurring,
  LumpSumVsRecurringInputSchema,
  type LumpSumVsRecurringInput,
  type LumpSumVsRecurringResult,
} from './lumpSumVsRecurring';
export {
  spendingPlanner,
  SpendingPlannerInputSchema,
  type SpendingPlannerInput,
  type SpendingPlannerResult,
  type SpendingPlannerRow,
} from './spendingPlanner';
export { coastFire, CoastFireInputSchema, type CoastFireInput, type CoastFireResult } from './coastFire';
export { baristaFire, BaristaFireInputSchema, type BaristaFireInput, type BaristaFireResult } from './baristaFire';
export { fiNumber, FiNumberInputSchema, type FiNumberInput, type FiNumberResult } from './fiNumber';
export type {
  CalculatorBasis,
  CalculatorLabels,
  CalculatorUnverified,
  DollarBasisLabel,
  GrowthRow,
  LimitsBasisLabel,
  PlanOutcome,
  SearchOutcome,
  TaxBasisLabel,
} from './common';

/** Every calculator, keyed by its id. Input is validated by the calculator (invalid → `invalid`). */
export const CALCULATORS: { [K in CalculatorId]: (input: never, ctx: EngineContext) => EngineResult<unknown> } = {
  compoundInterest,
  contribution401k,
  matchOptimizer,
  rothVsTraditional,
  retirementAge,
  savingsGap,
  inflationPurchasingPower,
  withdrawal,
  ssClaimingComparison,
  feeImpact,
  lumpSumVsRecurring,
  spendingPlanner,
  coastFire,
  baristaFire,
  fiNumber,
};

/** Run a calculator by id on untyped input; the calculator's own schema validates it. */
export function runCalculator(id: CalculatorId, input: unknown, ctx: EngineContext): EngineResult<unknown> {
  return (CALCULATORS[id] as (input: unknown, ctx: EngineContext) => EngineResult<unknown>)(input, ctx);
}
