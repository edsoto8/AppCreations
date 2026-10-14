import type { AnnualSummaryRow, Loan, LoanStatus, ProjectionSummary } from '@/api/types';
import { DISCLAIMER_TEXT } from '@/components/Disclaimer';
import { formatCount, formatCurrency, formatDate, formatMonthYear, formatPercent, FREQUENCY_LABELS, todayIso } from '@/lib/format';
import { AnnualTable } from './ScheduleTables';

interface PrintSummaryProps {
  loan: Loan;
  status: LoanStatus | null;
  /** Projection for the plan being printed (baseline or the selected scenario). */
  summary: ProjectionSummary;
  /** Balance the projection starts from (used when the dashboard status is unavailable). */
  startBalance: number;
  planName: string;
  annual: AnnualSummaryRow[];
  estimatedYears: Set<number>;
  cumulativeNote: string;
  currency: string;
}

/**
 * The printable loan summary. Rendered only while printing (see usePrintMode); print.css hides everything else, so
 * "Print summary" → "Save as PDF" produces a clean one-document report.
 */
export function PrintSummary({ loan, status, summary, startBalance, planName, annual, estimatedYears, cumulativeNote, currency }: PrintSummaryProps) {
  const fmt = (v: number | null | undefined) => formatCurrency(v, currency);
  const freq = FREQUENCY_LABELS[loan.paymentFrequency];
  const vehicle = [loan.vehicleYear, loan.vehicleMake, loan.vehicleModel].filter(Boolean).join(' ');
  const balanceEstimated = status?.balanceIsEstimated ?? false;
  const figures: { label: string; value: string; note?: string }[] = [
    {
      label: 'Current principal balance',
      value: fmt(status?.currentBalance ?? startBalance),
      note: status ? `${balanceEstimated ? 'Estimated, ' : ''}as of ${formatDate(status.balanceAsOf)}` : undefined,
    },
    { label: `${freq.adjective} payment`, value: fmt(status?.scheduledPayment ?? null) },
    { label: 'APR', value: formatPercent(loan.aprPercent), note: `${formatCount(loan.termMonths, 'month')} term` },
    {
      label: 'Estimated payoff',
      value: summary.payoffDate ? formatMonthYear(summary.payoffDate, 'long') : 'Not on this schedule',
      note: summary.payoffDate ? `${formatCount(summary.paymentCount, 'payment')} left · ${formatDate(summary.payoffDate)}` : undefined,
    },
    { label: 'Remaining interest', value: fmt(summary.totalInterest), note: 'From the projection start to payoff' },
    {
      label: 'Remaining total to pay',
      value: fmt(summary.totalPaid),
      note: summary.totalExtra > 0 ? `Includes ${fmt(summary.totalExtra)} extra` : undefined,
    },
  ];

  return (
    <section className="lp-print" data-testid="print-summary">
      <header className="lp-print-header">
        <div>
          <p className="lp-print-eyebrow">LoanPilot · Loan summary</p>
          <h1>{loan.name}</h1>
          <p className="lp-print-meta">{[vehicle, loan.lender, `Plan: ${planName}`].filter(Boolean).join(' · ')}</p>
        </div>
        <p className="lp-print-meta">Prepared {formatDate(todayIso(), 'long')}</p>
      </header>

      <dl className="lp-print-figures">
        {figures.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
            {f.note && <p>{f.note}</p>}
          </div>
        ))}
      </dl>

      <h2>Annual summary</h2>
      <AnnualTable rows={annual} currency={currency} estimatedYears={estimatedYears} frameless />

      <div className="lp-print-notes">
        {estimatedYears.size > 0 && <p>Years marked “Includes estimated” contain past payments reconstructed from the original schedule.</p>}
        <p>{cumulativeNote}</p>
        <p>{DISCLAIMER_TEXT}</p>
      </div>
    </section>
  );
}
