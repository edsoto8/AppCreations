/**
 * Plain-language definitions for financial terms, shown by <FieldInfo term="..." />.
 * Keep them short (2–4 sentences), concrete, and free of jargon.
 */
export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const glossary = {
  apr: {
    term: 'APR',
    definition:
      'Annual percentage rate: the yearly interest rate on your loan. A 6% APR means about 0.5% of your balance is charged as interest each month. Use the rate from your contract.',
  },
  principal: {
    term: 'Principal',
    definition:
      'The amount you still owe, not counting interest. Each payment covers the interest that has built up first; whatever is left reduces the principal.',
  },
  amortization: {
    term: 'Amortization',
    definition:
      'How a fixed payment is split over the life of the loan. Early payments carry the most interest because the balance is high; later payments go mostly to principal.',
  },
  accrualMethod: {
    term: 'Accrual method',
    definition:
      'How interest builds up. Monthly periodic charges one-twelfth of the APR on the balance each month. Daily simple interest charges a daily rate for each day between payments, so paying early saves a little interest and paying late costs a little more.',
  },
  monthlyAccrual: {
    term: 'Monthly periodic interest',
    definition:
      'Interest is charged once per period at APR ÷ periods per year (÷ 12 for monthly payments) on the balance, regardless of how many days the period has. This is how most payment calculators work.',
  },
  dailySimpleAccrual: {
    term: 'Daily simple interest',
    definition:
      'Interest accrues every day at APR ÷ 365 (or the actual days in the year) on the principal balance. Most U.S. auto lenders use this; the exact interest depends on the day each payment posts.',
  },
  dayCountBasis: {
    term: 'Day-count basis',
    definition:
      'For daily interest: how many days a year has. Actual/365 always divides by 365. Actual/Actual divides by 366 in leap years. Check your contract; Actual/365 is the most common.',
  },
  payoffQuote: {
    term: 'Payoff quote vs principal balance',
    definition:
      'Your principal balance excludes interest that has built up since your last payment. A payoff amount adds that accrued interest (and any lender fees) up to a specific date. Only your lender can give an official payoff quote.',
  },
  negativeAmortization: {
    term: 'Negative amortization',
    definition:
      'When a payment is smaller than the interest charged for the period, the balance does not go down. The unpaid interest is carried forward, and the loan never pays off on schedule.',
  },
  lumpSum: {
    term: 'Lump sum',
    definition:
      'A one-time extra payment on a date you choose. It goes entirely to principal, so it lowers the balance that future interest is charged on.',
  },
  recurringExtra: {
    term: 'Recurring extra payment',
    definition:
      'An extra amount added to every scheduled payment. It goes to principal, shortens the loan and reduces total interest. It never replaces or skips the next scheduled payment.',
  },
  refinanceBreakEven: {
    term: 'Refinance break-even',
    definition:
      'The month when the money saved by a refinanced loan finally covers the fees you paid to refinance. If you sell or pay off the car before then, refinancing cost you more.',
  },
  equity: {
    term: 'Equity',
    definition:
      'What the vehicle is worth minus what you still owe on it. Negative equity (being "upside down") means you owe more than the car is worth.',
  },
  scheduledPayment: {
    term: 'Scheduled payment',
    definition:
      'The regular amount you pay each period. Leave "use standard payment" on to use the payment that pays the loan off exactly at the end of its term.',
  },
  downPayment: {
    term: 'Down payment',
    definition:
      'Cash or trade-in value you put toward the vehicle up front. It is recorded for reference; enter the amount you actually financed as the original loan amount.',
  },
  balanceAsOf: {
    term: 'Balance as-of date',
    definition:
      'The date your current principal balance was accurate, for example the date on your latest statement. Projections start from this date.',
  },
  projectedLifetimeCost: {
    term: 'Total projected loan cost',
    definition:
      'Everything you will have paid over the life of the loan: principal plus all interest, past and projected. If the interest you paid before the balance date is unknown, it is estimated from the original schedule.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof glossary;
