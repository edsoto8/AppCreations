/**
 * Pure helpers for the Accounts, Roth IRA and HSA pages: labels, tax-treatment derivation, drafts
 * for new accounts, household upserts/deletes (always re-validated by the engine's HouseholdSchema)
 * and the account form schema (engine AccountSchema + household cross-checks).
 */
import type { z } from 'zod';
import {
  AccountSchema,
  HouseholdSchema,
  type Account,
  type AccountType,
  type ContributionSchedule,
  type Household,
  type Person,
  type TaxTreatment,
  type WorkplacePlan,
} from '@rn/engine';
import { formatCents, formatPercent } from '@/lib/format';
import { newId } from '@/lib/ids';

/** Form values: the engine's account input type (unbranded numbers, defaults optional). */
export type AccountInput = z.input<typeof AccountSchema>;
export type ContributionInput = NonNullable<Extract<AccountInput, { type: 'rothIra' }>['contribution']>;

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'workplaceTraditional',
  'workplaceRoth',
  'traditionalIra',
  'rothIra',
  'hsa',
  'taxableBrokerage',
  'cash',
  'other',
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  workplaceTraditional: 'Workplace plan, traditional',
  workplaceRoth: 'Workplace plan, Roth',
  traditionalIra: 'Traditional IRA',
  rothIra: 'Roth IRA',
  hsa: 'Health savings account (HSA)',
  taxableBrokerage: 'Taxable brokerage',
  cash: 'Cash or savings',
  other: 'Other',
};

export const PLAN_TYPE_LABELS = { '401k': '401(k)', '403b': '403(b)', '457b': '457(b)' } as const;
export type PlanType = keyof typeof PLAN_TYPE_LABELS;

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  taxDeferred: 'Tax-deferred',
  taxFree: 'Tax-free',
  taxable: 'Taxable',
};

export const TAX_TREATMENT_TIPS: Record<TaxTreatment, string> = {
  taxDeferred: 'Contributions are usually pre-tax; withdrawals are taxed as ordinary income.',
  taxFree: 'Contributions are after-tax (or, for an HSA, pre-tax); qualified withdrawals are not taxed.',
  taxable: 'Investment income and gains are taxed as they occur or when sold; withdrawals of basis are not taxed.',
};

export function isWorkplace(account: {
  type: AccountType;
}): account is { type: 'workplaceTraditional' | 'workplaceRoth' } {
  return account.type === 'workplaceTraditional' || account.type === 'workplaceRoth';
}

/** Account types whose contribution schedule may use "maximum allowed". */
export function supportsMaxAllowed(type: AccountType): boolean {
  return type === 'traditionalIra' || type === 'rothIra' || type === 'hsa';
}

/** Short display label, e.g. "Traditional 401(k)" or "Roth IRA". */
export function accountTypeLabel(account: Pick<AccountInput, 'type'> & { planType?: PlanType }): string {
  if (account.type === 'workplaceTraditional' && account.planType)
    return `Traditional ${PLAN_TYPE_LABELS[account.planType]}`;
  if (account.type === 'workplaceRoth' && account.planType) return `Roth ${PLAN_TYPE_LABELS[account.planType]}`;
  if (account.type === 'hsa') return 'HSA';
  return ACCOUNT_TYPE_LABELS[account.type];
}

export function taxTreatmentOf(account: Pick<AccountInput, 'type'> & { taxTreatment?: TaxTreatment }): TaxTreatment {
  switch (account.type) {
    case 'workplaceTraditional':
    case 'traditionalIra':
      return 'taxDeferred';
    case 'workplaceRoth':
    case 'rothIra':
    case 'hsa':
      return 'taxFree';
    case 'taxableBrokerage':
    case 'cash':
      return 'taxable';
    case 'other':
      return account.taxTreatment ?? 'taxable';
  }
}

export const DEFAULT_CONTRIBUTION: ContributionInput = {
  amount: { kind: 'dollars', amount: 0, frequency: 'annual' },
  growth: { mode: 'flat' },
  startYear: null,
  stopYear: null,
};

/** A valid draft for a new account of `type`, owned by `ownerId`. */
export function newAccountDraft(type: AccountType, ownerId: string, carry: Partial<AccountInput> = {}): AccountInput {
  const base = {
    id: carry.id ?? newId('account'),
    name: carry.name ?? `New ${accountTypeLabel({ type, planType: '401k' })}`,
    ownerId,
    balance: carry.balance ?? 0,
    expectedReturn: carry.expectedReturn ?? null,
    expenseRatio: carry.expenseRatio ?? 0,
    allocation: carry.allocation ?? null,
  };
  switch (type) {
    case 'workplaceTraditional':
    case 'workplaceRoth':
      return { ...base, type, planType: '401k', unvestedEmployerBalance: 0 };
    case 'traditionalIra':
    case 'cash':
      return { ...base, type, contribution: null };
    case 'rothIra':
      return {
        ...base,
        type,
        contribution: null,
        contributionBasis: 0,
        firstContributionYear: null,
        magiOverride: null,
      };
    case 'hsa':
      return { ...base, type, contribution: null, coverage: 'selfOnly', hdhpAttested: false };
    case 'taxableBrokerage':
      return { ...base, type, contribution: null, costBasis: 0 };
    case 'other':
      return { ...base, type, contribution: null, taxTreatment: 'taxable' };
  }
}

/** Household with `account` replacing the account with the same id, or appended. */
export function upsertAccount<A extends { id: string }>(household: Household, account: A): Household {
  const exists = household.accounts.some((a) => a.id === account.id);
  const accounts = exists
    ? household.accounts.map((a) => (a.id === account.id ? (account as unknown as Account) : a))
    : [...household.accounts, account as unknown as Account];
  return { ...household, accounts };
}

export type CommitResult = { ok: true; household: Household } | { ok: false; messages: string[] };

/** Validate a candidate household with the engine schema. */
export function validateHousehold(candidate: unknown): CommitResult {
  const parsed = HouseholdSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, household: parsed.data };
  return { ok: false, messages: [...new Set(parsed.error.issues.map((i) => i.message))] };
}

/** The workplace plan (and its person) whose contributions go to this account, if any. */
export function linkedPlanOf(household: Household, accountId: string): { person: Person; plan: WorkplacePlan } | null {
  for (const person of household.people) {
    for (const plan of person.workplacePlans) {
      if (plan.traditionalAccountId === accountId || plan.rothAccountId === accountId) return { person, plan };
    }
  }
  return null;
}

/** Why an account cannot be deleted (other household data points to it); empty when it can be. */
export function deletionBlockers(household: Household, accountId: string): string[] {
  const reasons: string[] = [];
  for (const person of household.people) {
    for (const plan of person.workplacePlans) {
      if (plan.traditionalAccountId === accountId || plan.rothAccountId === accountId) {
        reasons.push(
          `${person.name}’s ${PLAN_TYPE_LABELS[plan.planType]} plan on Income & Savings holds its contributions in this account.`,
        );
      }
    }
  }
  if (household.assumptions.surplus.mode === 'account' && household.assumptions.surplus.accountId === accountId) {
    reasons.push('Surplus cash is set to go to this account.');
  }
  for (const pension of household.pensions) {
    if (pension.payout.kind === 'lumpSum' && pension.payout.destinationAccountId === accountId) {
      reasons.push(`The pension “${pension.name}” pays its lump sum into this account.`);
    }
  }
  for (const event of household.oneTimeEvents) {
    if (event.destinationAccountId === accountId) {
      reasons.push(`The one-time event “${event.name}” deposits into this account.`);
    }
  }
  return reasons;
}

export type DeleteResult = CommitResult | { ok: false; blocked: string[]; messages: string[] };

export function deleteAccount(household: Household, accountId: string): DeleteResult {
  const blocked = deletionBlockers(household, accountId);
  if (blocked.length > 0) return { ok: false, blocked, messages: blocked };
  return validateHousehold({ ...household, accounts: household.accounts.filter((a) => a.id !== accountId) });
}

/**
 * Error key for issues that are not about a single field of the account being edited. Not RHF's
 * `root`, which handleSubmit clears after running the resolver.
 */
export const FORM_ROOT = 'household';

/**
 * The account form schema: the engine's AccountSchema plus the household-level checks that involve
 * this account (basis vs balance, plan links, owner). Household issues on this account's fields are
 * mapped to those fields; other issues go to the form root.
 */
export function accountFormSchema(household: Household) {
  return AccountSchema.superRefine((account, ctx) => {
    // Field-level issues from AccountSchema itself are already reported; check the household only
    // once the account is valid on its own.
    if (!AccountSchema.safeParse(account).success) return;
    const next = upsertAccount(household, account);
    const parsed = HouseholdSchema.safeParse(next);
    if (parsed.success) return;
    const index = next.accounts.findIndex((a) => a.id === account.id);
    const seen = new Set<string>();
    for (const issue of parsed.error.issues) {
      const [head, at, ...rest] = issue.path;
      const own = head === 'accounts' && at === index;
      const path = own && rest.length > 0 ? rest.map((p) => (typeof p === 'symbol' ? String(p) : p)) : [FORM_ROOT];
      const key = `${path.join('.')}|${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.addIssue({
        code: 'custom',
        path,
        message: own ? issue.message : `Conflicts with other plan data: ${issue.message}`,
      });
    }
  });
}

/** Friendly messages for zod's generic issues (schema-specific messages take precedence). */
export function friendlyIssue(issue: { code?: string; origin?: string; maximum?: unknown; minimum?: unknown }) {
  if (issue.code === 'too_small' && issue.origin === 'string') return 'Enter a name';
  if (issue.code === 'too_big' && issue.origin === 'string') return 'Use 60 characters or fewer';
  if (issue.code === 'too_big' && issue.maximum === 0.05) return 'Expense ratio can be at most 5%';
  if ((issue.code === 'too_big' || issue.code === 'too_small') && (issue.maximum === 2200 || issue.minimum === 1900))
    return 'Enter a year between 1900 and 2200';
  if (issue.code === 'invalid_type') return 'Enter a value';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Contribution schedules (display and this-year planned amount)
// ---------------------------------------------------------------------------------------------

const GROWTH_LABELS = { flat: 'flat', inflation: 'grows with inflation', rate: 'grows' } as const;

export function describeContribution(schedule: ContributionSchedule | null | undefined): string {
  if (!schedule) return 'No contributions';
  const a = schedule.amount;
  const amount =
    a.kind === 'dollars'
      ? `${formatCents(a.amount)} per ${a.frequency === 'monthly' ? 'month' : 'year'}`
      : a.kind === 'percentOfSalary'
        ? `${formatPercent(a.pct, 2)} of salary`
        : 'Maximum allowed';
  const g = schedule.growth;
  const growth =
    a.kind === 'dollars'
      ? g.mode === 'rate'
        ? `, grows ${formatPercent(g.rate, 2)}/yr`
        : `, ${GROWTH_LABELS[g.mode]}`
      : '';
  const window =
    schedule.startYear !== null || schedule.stopYear !== null
      ? ` (${schedule.startYear ?? 'now'}–${schedule.stopYear ?? 'retirement'})`
      : '';
  return `${amount}${growth}${window}`;
}

export function personName(household: Household, id: string): string {
  return household.people.find((p) => p.id === id)?.name ?? 'Unknown owner';
}
