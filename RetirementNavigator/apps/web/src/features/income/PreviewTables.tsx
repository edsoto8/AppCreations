import type { AccumulationPreview, PersonPreviewRow } from '@rn/engine';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { UnverifiedNotice, UnverifiedValue } from '@/components/UnverifiedNotice';
import { DollarBasisToggle } from '@/components/DollarBasisToggle';
import { toBasis } from '@/lib/dollarBasis';
import { useProfileStore } from '@/state/profileStore';
import { formatCents, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages)];
}

export function SavingsPreview({
  rows,
  inflation,
  personName,
  unverified,
}: {
  rows: PersonPreviewRow[];
  inflation: number;
  personName: string;
  unverified: AccumulationPreview['unverified'];
}) {
  const basis = useProfileStore((s) => s.dollarBasis);
  const limitsUnverified = rows.some((r) => r.compensation.working && r.contributions === null);
  const money = (cents: number, t: number) => formatCents(toBasis(cents, t, inflation, basis));
  const warnings = uniqueMessages(rows.flatMap((r) => r.warnings.map((w) => `${w.year ?? ''} ${w.message}`.trim())));
  const workplaceMissing = unverified.filter((u) => u.features.includes('workplaceLimits'));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Next 10 years for {personName}</CardTitle>
            <CardDescription>
              {basis === 'todays' ? 'In today’s dollars (year-1 prices).' : 'In future (nominal) dollars.'} Updates as
              you edit.
            </CardDescription>
          </div>
          <DollarBasisToggle />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {limitsUnverified ? <UnverifiedNotice missing={workplaceMissing} feature="Contribution limits" /> : null}
        <Table label={`10-year income and savings preview for ${personName}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="text-right">Salary</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Total pay</TableHead>
              <TableHead className="text-right">Real raise</TableHead>
              <TableHead className="text-right">You contribute</TableHead>
              <TableHead className="text-right">Employer</TableHead>
              <TableHead className="text-right">Total saved</TableHead>
              <TableHead className="text-right">Saved % of pay</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const t = i + 1;
              const c = r.contributions;
              const employee = c ? c.traditional + c.roth : r.requestedTraditional + r.requestedRoth;
              const employer = c ? c.employerMatch + c.employerFlat : r.matchBeforeLimits.total;
              return (
                <TableRow key={r.year} className={cn(!r.compensation.working && 'text-muted-foreground')}>
                  <TableCell>{r.year}</TableCell>
                  <TableCell>{r.age}</TableCell>
                  <TableCell className="text-right">{money(r.compensation.baseSalary, t)}</TableCell>
                  <TableCell className="text-right">{money(r.compensation.bonus, t)}</TableCell>
                  <TableCell className="text-right">{money(r.compensation.totalCompensation, t)}</TableCell>
                  <TableCell className="text-right">
                    {t === 1 || !r.compensation.working ? '—' : formatPercent(r.compensation.realRaise, 2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(employee, t)}
                    {!c && r.compensation.working ? (
                      <span className="sr-only"> (before limits, unverified)</span>
                    ) : null}
                    {!c && r.compensation.working ? <span aria-hidden="true">*</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(employer, t)}
                    {!c && r.compensation.working ? <span aria-hidden="true">*</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.totalSaved === null ? <UnverifiedValue label="Unverified" /> : money(r.totalSaved, t)}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.savingsRate === null ? '—' : formatPercent(r.savingsRate, 1)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {limitsUnverified ? (
          <p className="text-xs text-muted-foreground">
            * Requested amounts and the match before plan limits; limits are not applied because their values are
            unverified.
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <Alert variant="attention">
            <AlertTriangle aria-hidden="true" />
            <ul className="flex list-none flex-col gap-1">
              {warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CashFlowCheck({ preview, inflation }: { preview: AccumulationPreview; inflation: number }) {
  const basis = useProfileStore((s) => s.dollarBasis);
  const money = (cents: number | null, t: number) =>
    cents === null ? '—' : formatCents(toBasis(cents, t, inflation, basis));
  const taxMissing = preview.unverified.filter((u) =>
    u.features.some((f) => f === 'federalIncomeTax' || f === 'payrollTax'),
  );
  const infeasible = preview.cashFlow.filter((r) => r.infeasible);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Does the plan fit take-home pay?</CardTitle>
        <CardDescription>
          Household pay minus estimated taxes, contributions and current spending. A negative result means the savings
          plan is not feasible as entered; it is flagged, not hidden.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {taxMissing.length > 0 ? <UnverifiedNotice missing={taxMissing} feature="The take-home pay check" /> : null}
        {infeasible.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <p>
              In this model, take-home pay does not cover contributions plus spending in{' '}
              {infeasible.map((r) => r.year).join(', ')}.
            </p>
          </Alert>
        ) : null}
        <Table label="Household take-home pay check">
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Gross pay</TableHead>
              <TableHead className="text-right">Estimated taxes</TableHead>
              <TableHead className="text-right">Take-home pay</TableHead>
              <TableHead className="text-right">Contributions</TableHead>
              <TableHead className="text-right">Spending</TableHead>
              <TableHead className="text-right">Left over</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.cashFlow.map((r, i) => (
              <TableRow key={r.year}>
                <TableCell>{r.year}</TableCell>
                <TableCell className="text-right">{money(r.grossPay, i + 1)}</TableCell>
                <TableCell className="text-right">
                  {r.taxes ? money(r.taxes.totalTax, i + 1) : <UnverifiedValue label="Unverified" />}
                </TableCell>
                <TableCell className="text-right">{money(r.netPay, i + 1)}</TableCell>
                <TableCell className="text-right">{money(r.employeeContributions, i + 1)}</TableCell>
                <TableCell className="text-right">{money(r.spending, i + 1)}</TableCell>
                <TableCell className={cn('text-right font-medium', r.infeasible && 'text-destructive')}>
                  {money(r.surplus, i + 1)}
                  {r.infeasible ? <span className="sr-only"> (shortfall)</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Taxes are simplified estimates (federal, Social Security and Medicare, flat state rate).
        </p>
      </CardContent>
    </Card>
  );
}
