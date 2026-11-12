import type { Account, Card, CassetteId, Cents, Customer, Denomination } from '../core/types';
import { cardTokenFor, hashPin } from './pin';

/**
 * Fictional training data. Nothing here is real: the bank, the people, the card numbers (prefix 9990 is
 * not issued to anyone) and the PINs (shown openly in the UI because they are demo values).
 */
export const BANK_NAME = 'Meridian Training Bank';

/** Opening history lines so mini statements look realistic. Times are sim-ms (negative = before today). */
export interface SeedHistoryLine {
  accountId: string;
  daysAgo: number;
  description: string;
  amountCents: Cents;
}

export interface SeedData {
  customers: Customer[];
  accounts: Account[];
  cards: Card[];
  history: SeedHistoryLine[];
}

const DAILY_LIMIT: Cents = 100_000; // $1,000 per account per day

function account(id: string, customerId: string, type: Account['type'], nickname: string, status: Account['status'] = 'ACTIVE'): Account {
  return { id, customerId, type, nickname, ledgerCents: 0, holds: [], status, dailyLimitCents: DAILY_LIMIT, withdrawnTodayCents: 0 };
}

function card(
  id: string,
  last4: string,
  holderName: string,
  customerId: string,
  accountIds: string[],
  demoPin: string,
  persona: string,
  opts: Partial<Pick<Card, 'status' | 'contactless' | 'expiry'>> = {},
): Card {
  const token = cardTokenFor(id);
  return {
    id,
    maskedNumber: `9990 •••• •••• ${last4}`,
    holderName,
    customerId,
    accountIds,
    pinHash: hashPin(demoPin, token),
    demoPin,
    status: opts.status ?? 'ACTIVE',
    pinTriesRemaining: 3,
    expiry: opts.expiry ?? '12/29',
    contactless: opts.contactless ?? false,
    persona,
  };
}

/** Fresh copy of the seed data (every call returns new objects, so reset() starts clean). */
export function createSeedData(): SeedData {
  const customers: Customer[] = [
    { id: 'cust-alex', name: 'Alex Rivera' },
    { id: 'cust-sam', name: 'Sam Okafor' },
    { id: 'cust-jordan', name: 'Jordan Lee' },
    { id: 'cust-casey', name: 'Casey Moreau' },
  ];
  const accounts: Account[] = [
    account('CHK-1001', 'cust-alex', 'CHECKING', 'Everyday Checking'),
    account('SAV-1002', 'cust-alex', 'SAVINGS', 'Savings'),
    account('CHK-2001', 'cust-sam', 'CHECKING', 'Checking'),
    account('CHK-3001', 'cust-jordan', 'CHECKING', 'Checking', 'FROZEN'),
    account('SAV-3002', 'cust-jordan', 'SAVINGS', 'Savings'),
    account('CHK-4001', 'cust-casey', 'CHECKING', 'Checking'),
  ];
  const cards: Card[] = [
    card('card-alex', '1001', 'Alex Rivera', 'cust-alex', ['CHK-1001', 'SAV-1002'], '1234', 'Healthy balances, contactless', { contactless: true }),
    card('card-sam', '2001', 'Sam Okafor', 'cust-sam', ['CHK-2001'], '2468', 'Low balance (insufficient funds demo)'),
    card('card-jordan', '3001', 'Jordan Lee', 'cust-jordan', ['CHK-3001', 'SAV-3002'], '1111', 'Frozen checking account'),
    card('card-blocked', '4001', 'Casey Moreau', 'cust-casey', ['CHK-4001'], '0000', 'Card status BLOCKED', { status: 'BLOCKED' }),
  ];
  // History lines sum to the seeded balances in DOMAIN-API.md.
  const history: SeedHistoryLine[] = [
    { accountId: 'CHK-1001', daysAgo: 9, description: 'Opening balance', amountCents: 200_000 },
    { accountId: 'CHK-1001', daysAgo: 6, description: 'Payroll - Meridian Training Co.', amountCents: 90_000 },
    { accountId: 'CHK-1001', daysAgo: 4, description: 'Grocery store (card)', amountCents: -31_215 },
    { accountId: 'CHK-1001', daysAgo: 2, description: 'Utility bill (direct debit)', amountCents: -13_710 },
    { accountId: 'CHK-1001', daysAgo: 1, description: 'Coffee shop (contactless)', amountCents: -4_300 },
    { accountId: 'CHK-1001', daysAgo: 1, description: 'Refund - online store', amountCents: 4_300 },
    { accountId: 'SAV-1002', daysAgo: 30, description: 'Opening balance', amountCents: 800_000 },
    { accountId: 'SAV-1002', daysAgo: 1, description: 'Interest', amountCents: 12_000 },
    { accountId: 'CHK-2001', daysAgo: 8, description: 'Opening balance', amountCents: 12_000 },
    { accountId: 'CHK-2001', daysAgo: 3, description: 'Bus pass', amountCents: -6_000 },
    { accountId: 'CHK-2001', daysAgo: 1, description: 'Phone top-up', amountCents: -2_460 },
    { accountId: 'CHK-3001', daysAgo: 12, description: 'Opening balance', amountCents: 64_000 },
    { accountId: 'SAV-3002', daysAgo: 12, description: 'Opening balance', amountCents: 100_000 },
    { accountId: 'CHK-4001', daysAgo: 20, description: 'Opening balance', amountCents: 30_000 },
  ];
  return { customers, accounts, cards, history };
}

/** Initial cassette load: denomination, notes, capacity. Low threshold = 10% of the initial load. */
export const SEED_CASSETTES: Record<CassetteId, { denom: Denomination; notes: number; capacity: number }> = {
  A: { denom: 20, notes: 2000, capacity: 2500 },
  B: { denom: 50, notes: 1000, capacity: 2000 },
  C: { denom: 100, notes: 500, capacity: 2000 },
};

/** Branch vault / cash-in-transit stock available for replenishment. */
export const SEED_VAULT: Array<[Denomination, number]> = [
  [20, 3000],
  [50, 1500],
  [100, 1000],
  [10, 500],
];

/** The (single, fictional) customer's wallet: training notes available for deposits. */
export const SEED_WALLET: Array<[Denomination, number]> = [
  [20, 10],
  [50, 4],
  [100, 2],
];
