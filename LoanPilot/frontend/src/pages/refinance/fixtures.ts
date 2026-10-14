import type { RefinanceResult } from '@/api/types';

/** Shape captured from the real API (current loan $21,480.55 at 6.49%, refinanced at 5% over 48 months with $300 fees). */
export function makeRefinanceResult(overrides: Partial<RefinanceResult> = {}): RefinanceResult {
  const costSeries = Array.from({ length: 49 }, (_, m) => ({
    month: m,
    date: `${2026 + Math.floor((9 + m) / 12)}-${String(((9 + m) % 12) + 1).padStart(2, '0')}-10`,
    currentCost: Math.round((21480.55 + m * 58) * 100) / 100,
    refinanceCost: Math.round((21780.55 + m * 48) * 100) / 100,
  }));
  return {
    current: { payment: 537.77, remainingPayments: 46, remainingInterest: 2786.17, totalRemainingCost: 24266.72, payoffDate: '2030-07-10' },
    refinanced: {
      principal: 21480.55,
      payment: 494.68,
      payments: 48,
      totalInterest: 2264.77,
      fees: 300,
      totalCost: 24045.32,
      payoffDate: '2030-09-10',
    },
    monthlyPaymentChange: -43.09,
    lifetimeSavings: 221.4,
    breakEvenMonth: 30,
    breakEvenDate: '2029-04-10',
    verdict: 'Refinancing would save about $221.40 overall and pays back its costs after 30 months, lowering your payment by $43.09.',
    rateComparison: [
      { aprPercent: 4.0, payment: 485.01, totalInterest: 1800.41, lifetimeSavings: 685.76 },
      { aprPercent: 4.5, payment: 489.83, totalInterest: 2031.88, lifetimeSavings: 454.29 },
      { aprPercent: 5.0, payment: 494.68, totalInterest: 2264.77, lifetimeSavings: 221.4 },
      { aprPercent: 5.5, payment: 499.56, totalInterest: 2499.06, lifetimeSavings: -12.89 },
      { aprPercent: 6.0, payment: 504.47, totalInterest: 2734.81, lifetimeSavings: -248.64 },
    ],
    costSeries,
    ...overrides,
  };
}
