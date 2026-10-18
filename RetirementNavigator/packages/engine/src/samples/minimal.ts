/**
 * A minimal valid single-person household, used by tests and as the "blank profile" template.
 * Not a sample profile (those arrive in M2); amounts are illustrative inputs, not rule values.
 */
import type { HouseholdInput } from '../domain/household';

export function minimalHouseholdInput(currentYear: number, id = 'household-1'): HouseholdInput {
  return {
    id,
    name: 'My plan',
    filingStatus: 'single',
    people: [
      {
        id: 'person-1',
        name: 'You',
        birthYear: currentYear - 35,
        retirementAge: 65,
        planningAge: 95,
        socialSecurity: { source: { kind: 'none' }, claimAge: { years: 67, months: 0 } },
      },
    ],
    accounts: [
      {
        type: 'taxableBrokerage',
        id: 'account-1',
        name: 'Brokerage',
        ownerId: 'person-1',
        balance: 2_500_000,
        costBasis: 2_000_000,
      },
    ],
    spending: { currentAnnualSpending: 6_000_000, retirementAnnualSpending: 5_000_000 },
    assumptions: {
      inflation: 0.025,
      returnPreRetirement: 0.06,
      returnPostRetirement: 0.05,
      capitalMarket: {
        stocks: { geometricReturn: 0.07, volatility: 0.16 },
        bonds: { geometricReturn: 0.045, volatility: 0.06 },
        cash: { geometricReturn: 0.03, volatility: 0.01 },
        correlation: [
          [1, 0.1, 0],
          [0.1, 1, 0.2],
          [0, 0.2, 1],
        ],
        blendedVolatility: 0.12,
        note: 'Illustrative round-number assumptions chosen by the app authors; not a forecast.',
      },
      rules: { anchorYear: currentYear },
    },
  };
}
