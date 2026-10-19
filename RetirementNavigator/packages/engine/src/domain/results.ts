/**
 * Result envelope for every engine call that can be blocked by input or rule problems.
 * The engine does not throw for user data; it returns `invalid` or `unverified`.
 */
import type { RuleKey } from './rules';

export type WarningCode =
  | 'deferralCapped'
  | 'bonusDeferralIgnored'
  | 'catchUpApplied'
  | 'rothCatchUpRequired'
  | 'annualAdditionsCapped'
  | 'compensationLimitApplied'
  | 'iraCapped'
  | 'iraEarnedIncomeCap'
  | 'rothIraPhaseOutReduced'
  | 'rothIraIneligible'
  | 'hsaCapped'
  | 'hsaNoHdhp'
  | 'savingsPlanInfeasible'
  | 'portfolioDepleted'
  | 'grossUpNotConverged'
  | 'earlyWithdrawalFlagged'
  | 'rothEarningsWithdrawnEarly'
  | 'hsaNonMedicalPre65'
  | 'ssClaimBeforeFraWhileWorking'
  | 'ssEstimateIllustrative'
  | 'rulesProjected'
  | 'healthcarePreMedicareUserEntered'
  | 'orphanedScenarioOp';

export interface EngineWarning {
  code: WarningCode;
  message: string;
  year?: number;
  personId?: string;
  accountId?: string;
}

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/** Features that depend on rule values; the UI disables a feature whose rules are unverified. */
export type RuleDependentFeature =
  | 'workplaceLimits'
  | 'iraLimits'
  | 'rothIraEligibility'
  | 'hsaLimits'
  | 'federalIncomeTax'
  | 'capitalGainsTax'
  | 'ssBenefitTaxation'
  | 'payrollTax'
  | 'socialSecurityClaiming'
  | 'socialSecurityEstimator'
  | 'spousalSurvivorBenefits'
  | 'rmd'
  | 'rothQualification';

export interface UnverifiedDetail {
  key: RuleKey;
  reason: string;
  features: RuleDependentFeature[];
}

export type EngineResult<T> =
  | { status: 'ok'; value: T; warnings: EngineWarning[] }
  | { status: 'unverified'; missing: UnverifiedDetail[] }
  | { status: 'invalid'; issues: ValidationIssue[] };
