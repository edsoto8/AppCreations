/**
 * The Roth IRA eligibility readout, read from the engine's accumulation preview
 * (`cashFlow[0].rothIra` and `.scheduled`). The UI does no MAGI or limit arithmetic of its own, so
 * the page always shows what the forecast uses.
 */
import type {
  AccumulationPreview,
  EngineWarning,
  Household,
  RothIraYear,
  RuleDependentFeature,
  UnverifiedDetail,
} from '@rn/engine';
import { scheduledThisYear, type RothIraAccount } from '@/features/accounts/thisYear';

export function rothAccountsOf(household: Household, personId: string): RothIraAccount[] {
  return household.accounts.filter((a): a is RothIraAccount => a.type === 'rothIra' && a.ownerId === personId);
}

const ROTH_WARNINGS = new Set<EngineWarning['code']>([
  'rothIraPhaseOutReduced',
  'rothIraIneligible',
  'iraEarnedIncomeCap',
]);

export interface RothReadout {
  /** The engine's year-1 Roth IRA figures for this person; null when the person has no Roth IRA. */
  year: RothIraYear | null;
  /** This year's scheduled Roth IRA contributions: requested ('max' = the allowed amount). */
  requested: number | 'max';
  /** The contributions after limits; null when a rule they need is unverified. */
  contributed: number | null;
  /** Unverified rules behind any null figure in the readout. */
  missing: UnverifiedDetail[];
  /** Engine warnings for this person's Roth IRA this year (phase-out, ineligible, caps). */
  warnings: EngineWarning[];
}

export function rothReadout(household: Household, personId: string, preview: AccumulationPreview | null): RothReadout {
  const accounts = rothAccountsOf(household, personId);
  const ids = new Set<string>(accounts.map((a) => a.id));
  const row = preview?.cashFlow[0];
  const year = row?.rothIra.find((r) => r.personId === personId) ?? null;

  let requested: number | 'max' = 0;
  let contributed: number | null = 0;
  for (const account of accounts) {
    const s = scheduledThisYear(preview, account.id);
    requested = requested === 'max' || s.requested === 'max' ? 'max' : requested + s.requested;
    contributed = contributed === null || s.allowed === null ? null : contributed + s.allowed;
  }

  const features = new Set<RuleDependentFeature>();
  if (year && year.eligibility === null) features.add('rothIraEligibility').add('iraLimits');
  if (year && year.magi === null) {
    if (year.magiComponents.traditionalDeferrals === null) features.add('workplaceLimits');
    if (year.magiComponents.hsaContributions === null) features.add('hsaLimits');
  }
  const missing = (preview?.unverified ?? []).filter((m) => m.features.some((f) => features.has(f)));

  const warnings = (row?.warnings ?? []).filter(
    (w) =>
      (w.personId === personId && ROTH_WARNINGS.has(w.code)) || (w.accountId !== undefined && ids.has(w.accountId)),
  );
  return { year, requested, contributed, missing, warnings };
}
