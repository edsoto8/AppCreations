import { formatIssues, HouseholdSchema, minimalHouseholdInput, zodIssues, type Household } from '@rn/engine';
import { newId } from '@/lib/ids';

export interface Basics {
  name: string;
  yourName: string;
  birthYear: number;
  retirementAge: number;
  partner: { name: string; birthYear: number; retirementAge: number } | null;
  salaryCents: number;
  spendingCents: number;
}

/** A new household from the onboarding basics (no accounts yet), or readable validation errors. */
export function blankHousehold(
  currentYear: number,
  b: Basics,
): { ok: true; household: Household } | { ok: false; errors: string[] } {
  const base = minimalHouseholdInput(currentYear, newId('household'));
  const [you] = base.people;
  if (!you) return { ok: false, errors: ['Template household has no person'] };
  const people = [
    {
      ...you,
      name: b.yourName,
      birthYear: b.birthYear,
      retirementAge: b.retirementAge,
      employment:
        b.salaryCents > 0 ? { baseSalary: b.salaryCents, raise: { mode: 'nominal' as const, rate: 0.03 } } : null,
    },
    ...(b.partner
      ? [
          {
            ...you,
            id: newId('person'),
            name: b.partner.name,
            birthYear: b.partner.birthYear,
            retirementAge: b.partner.retirementAge,
          },
        ]
      : []),
  ];
  const parsed = HouseholdSchema.safeParse({
    ...base,
    name: b.name,
    filingStatus: b.partner ? 'marriedFilingJointly' : 'single',
    people,
    accounts: [],
    spending: { currentAnnualSpending: b.spendingCents, retirementAnnualSpending: Math.round(b.spendingCents * 0.85) },
  });
  return parsed.success
    ? { ok: true, household: parsed.data }
    : { ok: false, errors: formatIssues(zodIssues(parsed.error)) };
}
