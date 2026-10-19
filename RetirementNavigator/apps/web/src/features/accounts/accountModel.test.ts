import { describe, expect, it } from 'vitest';
import { HouseholdSchema, SAMPLE_PROFILES, type Household } from '@rn/engine';
import { TEST_YEAR } from '@/test/renderWithProfile';
import {
  ACCOUNT_TYPES,
  FORM_ROOT,
  accountFormSchema,
  deleteAccount,
  deletionBlockers,
  describeContribution,
  newAccountDraft,
  taxTreatmentOf,
  upsertAccount,
} from './accountModel';

function sample(id: string): Household {
  const s = SAMPLE_PROFILES.find((p) => p.id === id);
  if (!s) throw new Error(id);
  return s.build(TEST_YEAR);
}

describe('accountModel', () => {
  it('derives tax treatment from the account type', () => {
    expect(taxTreatmentOf({ type: 'workplaceTraditional' })).toBe('taxDeferred');
    expect(taxTreatmentOf({ type: 'traditionalIra' })).toBe('taxDeferred');
    expect(taxTreatmentOf({ type: 'workplaceRoth' })).toBe('taxFree');
    expect(taxTreatmentOf({ type: 'rothIra' })).toBe('taxFree');
    expect(taxTreatmentOf({ type: 'hsa' })).toBe('taxFree');
    expect(taxTreatmentOf({ type: 'taxableBrokerage' })).toBe('taxable');
    expect(taxTreatmentOf({ type: 'cash' })).toBe('taxable');
    expect(taxTreatmentOf({ type: 'other', taxTreatment: 'taxDeferred' })).toBe('taxDeferred');
  });

  it('creates a valid draft for every account type', () => {
    const h = sample('midCareerCouple');
    for (const type of ACCOUNT_TYPES) {
      const draft = newAccountDraft(type, 'jordan');
      expect(HouseholdSchema.safeParse(upsertAccount(h, draft)).success, type).toBe(true);
    }
  });

  it('blocks deleting plan-linked and surplus accounts, and deletes others', () => {
    const couple = sample('midCareerCouple');
    expect(deletionBlockers(couple, 'jordan-403b')).toEqual([
      'Jordan’s 403(b) plan on Income & Savings holds its contributions in this account.',
    ]);
    const blocked = deleteAccount(couple, 'sam-401k');
    expect(blocked.ok).toBe(false);

    const high = sample('highEarner');
    expect(deletionBlockers(high, 'morgan-brokerage')).toEqual(['Surplus cash is set to go to this account.']);

    const ok = deleteAccount(couple, 'joint-brokerage');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.household.accounts.map((a) => a.id)).not.toContain('joint-brokerage');
  });

  it('maps household issues on the edited account to its fields and others to the form root', () => {
    const couple = sample('midCareerCouple');
    const schema = accountFormSchema(couple);
    const roth = couple.accounts.find((a) => a.id === 'jordan-roth');
    const basis = schema.safeParse({ ...roth, contributionBasis: 5_000_000 });
    expect(basis.success).toBe(false);
    expect(basis.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['contributionBasis', 'Basis cannot exceed balance'],
    ]);

    const k401 = couple.accounts.find((a) => a.id === 'sam-401k');
    const plan = schema.safeParse({ ...k401, planType: '457b' });
    expect(plan.success).toBe(false);
    expect(plan.error?.issues[0]?.path).toEqual([FORM_ROOT]);
    expect(plan.error?.issues[0]?.message).toMatch(/^Conflicts with other plan data: Plan type must match/);

    expect(schema.safeParse({ ...roth, balance: 5_000_000 }).success).toBe(true);
  });

  it('reads this year’s scheduled request from the engine preview', async () => {
    const { previewAccumulation, RULES } = await import('@rn/engine');
    const { scheduledThisYear } = await import('./thisYear');
    const h = sample('midCareerCouple');
    const p = previewAccumulation(h, { currentYear: TEST_YEAR, rules: RULES }, 1);
    if (p.status !== 'ok') throw new Error('preview');
    // Jordan's Roth IRA: $250 a month.
    // The allowed amount needs the (unverified) Roth IRA rules, so it is null, never a guess.
    expect(scheduledThisYear(p.value, 'jordan-roth')).toEqual({ requested: 300_000, allowed: null });
    expect(scheduledThisYear(p.value, 'missing')).toEqual({ requested: 0, allowed: 0 });
    expect(scheduledThisYear(null, 'jordan-roth')).toEqual({ requested: 0, allowed: 0 });
  });

  it('describes contribution schedules', () => {
    expect(describeContribution(null)).toBe('No contributions');
    expect(
      describeContribution({
        amount: { kind: 'dollars', amount: 500_000 as never, frequency: 'annual' },
        growth: { mode: 'rate', rate: 0.03 as never },
        startYear: 2027,
        stopYear: null,
      }),
    ).toBe('$5,000 per year, grows 3%/yr (2027–retirement)');
    expect(
      describeContribution({
        amount: { kind: 'maxAllowed' },
        growth: { mode: 'flat' },
        startYear: null,
        stopYear: null,
      }),
    ).toBe('Maximum allowed');
  });
});
