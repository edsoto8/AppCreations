/** Monte Carlo test fixtures. */
import { HouseholdSchema, minimalHouseholdInput, type Household } from '@rn/engine';
import { TEST_YEAR } from './renderWithProfile';

/** A short-horizon retiree (11 projection years) so a few thousand paths run quickly. */
export function shortHousehold(): Household {
  const input = minimalHouseholdInput(TEST_YEAR);
  const person = input.people[0];
  if (!person) throw new Error('minimal household has no person');
  input.people = [{ ...person, birthYear: TEST_YEAR - 85, retirementAge: 65, planningAge: 95 }];
  input.accounts = [
    {
      type: 'taxableBrokerage',
      id: 'brokerage',
      name: 'Brokerage',
      ownerId: person.id,
      balance: 50_000_000,
      costBasis: 30_000_000,
      allocation: { stocks: 0.6, bonds: 0.3, cash: 0.1 },
    },
    { type: 'cash', id: 'cash', name: 'Savings', ownerId: person.id, balance: 2_000_000 },
  ];
  input.spending = { currentAnnualSpending: 4_500_000, retirementAnnualSpending: 4_500_000 };
  return HouseholdSchema.parse(input);
}
