/**
 * CSV export of forecast rows (BRIEF §5.11). Money columns are dollars with cents, in the chosen basis:
 * nominal, or today's dollars (the row's own real figure where the engine reports one, otherwise
 * the nominal cents divided by the row's deflator, rounded half to even). A figure the engine left
 * null (for example taxes with unverified rules) is an empty cell, never a number.
 *
 * Formula injection: a cell that is not a plain number and begins with `=`, `+`, `-`, `@`, a tab or a
 * carriage return is prefixed with an apostrophe so spreadsheets show it as text. Plain numbers
 * (including negative ones) cannot run as formulas and are written as numbers.
 */
import type { DollarBasis } from '../domain/primitives';
import type { ProjectionResult, YearRow } from '../domain/projection';
import { roundHalfEven } from '../money';

export interface CsvOptions {
  dollarBasis: DollarBasis;
  /** Display names for account and person ids (user text; escaped like every other cell). */
  accountNames?: Readonly<Record<string, string>>;
  personNames?: Readonly<Record<string, string>>;
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const DANGEROUS_START = /^[=+\-@\t\r]/;

/** One CSV cell: injection-safe, quoted when it holds a comma, quote or line break. */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  let text = String(value);
  if (!PLAIN_NUMBER.test(text) && DANGEROUS_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Integer cents as a dollars string with two decimals ("-12.05"), without float formatting. */
function dollarsText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac < 10 ? '0' : ''}${frac}`;
}

export function toCsv(result: ProjectionResult, opts: CsvOptions): string {
  const real = opts.dollarBasis === 'todays';
  const money = (cents: number | null, row: YearRow, realCents?: number | null) => {
    if (cents === null) return null;
    if (!real) return dollarsText(cents);
    if (realCents !== undefined && realCents !== null) return dollarsText(realCents);
    return dollarsText(roundHalfEven(cents / row.deflator));
  };
  const first = result.rows[0];
  const accountIds = first ? first.accounts.map((a) => a.accountId as string) : [];
  const personIds = first ? first.people.map((p) => p.personId as string) : [];
  const accountName = (id: string) => opts.accountNames?.[id] ?? id;
  const personName = (id: string) => opts.personNames?.[id] ?? id;
  const basisLabel = real ? "today's dollars" : 'future (nominal) dollars';

  const header = [
    'Year',
    'Phase',
    ...personIds.map((id) => `Age: ${personName(id)}`),
    `Portfolio start (${basisLabel})`,
    'Contributions',
    'Employer contributions',
    'Growth after fees',
    'Fees',
    'Withdrawals',
    'Required minimum distributions',
    'Social Security',
    'Pensions',
    'Other income',
    'One-time inflows',
    'One-time outflows',
    'Spending need',
    'Spending funded',
    'Shortfall',
    'Gross income',
    'Total tax (empty = not computed)',
    'Net income (empty = not computed)',
    `Portfolio end (${basisLabel})`,
    ...accountIds.map((id) => `End balance: ${accountName(id)}`),
    'Depleted',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of result.rows) {
    const f = row.flows;
    const cells: (string | number | boolean | null)[] = [
      row.year,
      row.phase,
      ...personIds.map((id) => row.people.find((p) => p.personId === id)?.age ?? null),
      // A start balance is the prior year-end money, so it is deflated by the prior year's level.
      real
        ? dollarsText(roundHalfEven(row.totals.portfolioStart / (result.rows[row.index - 2]?.deflator ?? 1)))
        : dollarsText(row.totals.portfolioStart),
      money(f.contributions, row),
      money(f.employerContributions, row),
      money(f.growthNet, row),
      money(f.feeDrag, row),
      money(f.withdrawals, row),
      money(f.rmd, row),
      money(f.socialSecurity, row),
      money(f.pensions, row),
      money(f.otherIncome, row),
      money(f.oneTimeInflows, row),
      money(f.oneTimeOutflows, row),
      money(f.spendingNeed, row, row.real.spendingNeed),
      money(f.spendingFunded, row),
      money(f.shortfall, row),
      money(row.grossIncome, row, row.real.grossIncome),
      money(row.tax ? row.tax.totalTax : null, row),
      money(row.netIncome, row, row.real.netIncome),
      money(row.totals.portfolioEnd, row, row.real.portfolioEnd),
      ...accountIds.map((id) => {
        const a = row.accounts.find((x) => x.accountId === id);
        return a ? money(a.end, row) : null;
      }),
      row.depleted,
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
