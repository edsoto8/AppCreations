import type { DollarBasis, Household, ProjectionResult } from '@rn/engine';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DataTableDisclosure } from './DataTableDisclosure';
import { agesLabel, basisName, inBasis, phaseLabel } from './viewModel';

/** "Forecast details": every baseline row, collapsible, in the selected dollar basis. */
export function ForecastDetails({
  result,
  household,
  basis,
  beforeLimits,
}: {
  result: ProjectionResult;
  household: Household;
  basis: DollarBasis;
  beforeLimits: boolean;
}) {
  const unit = basisName(basis);
  const anyForfeited = result.rows.some((r) => r.flows.forfeited > 0);
  return (
    <Card aria-labelledby="details-title">
      <CardHeader>
        <CardTitle id="details-title">Forecast details</CardTitle>
        <CardDescription>
          Every year of the baseline forecast in {unit}
          {result.granularity === 'monthly' ? ', computed month by month' : ''}. Retirement-year withdrawals and income
          are before taxes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DataTableDisclosure label="year-by-year table">
          <Table label={`Forecast details by year, ${unit}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="text-right">Portfolio start</TableHead>
                <TableHead className="text-right">Contributions{beforeLimits ? '*' : ''}</TableHead>
                <TableHead className="text-right">Growth (net)</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Withdrawals</TableHead>
                {anyForfeited ? <TableHead className="text-right">Forfeited (unvested)</TableHead> : null}
                <TableHead className="text-right">Spending need</TableHead>
                <TableHead className="text-right">Shortfall</TableHead>
                <TableHead className="text-right">Portfolio end</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => {
                const money = (cents: number) => formatCents(inBasis(cents, row, basis));
                const marked = beforeLimits && row.flows.contributions > 0;
                return (
                  <TableRow key={row.year} className={cn(row.depleted && 'bg-destructive/5')}>
                    <TableCell>{row.year}</TableCell>
                    <TableCell>{agesLabel(row, household)}</TableCell>
                    <TableCell>{phaseLabel(row.phase)}</TableCell>
                    <TableCell className="text-right">{money(row.totals.portfolioStart)}</TableCell>
                    <TableCell className="text-right">
                      {money(row.flows.contributions)}
                      {marked ? <span aria-hidden="true">*</span> : null}
                      {marked ? <span className="sr-only"> (as elected, before plan limits, unverified)</span> : null}
                    </TableCell>
                    <TableCell className="text-right">{money(row.flows.growthNet)}</TableCell>
                    <TableCell className="text-right">{money(row.flows.feeDrag)}</TableCell>
                    <TableCell className="text-right">{money(row.flows.withdrawals)}</TableCell>
                    {anyForfeited ? <TableCell className="text-right">{money(row.flows.forfeited)}</TableCell> : null}
                    <TableCell className="text-right">{money(row.flows.spendingNeed)}</TableCell>
                    <TableCell className={cn('text-right', row.flows.shortfall > 0 && 'font-medium text-destructive')}>
                      {money(row.flows.shortfall)}
                      {row.flows.shortfall > 0 ? <span className="sr-only"> (not funded)</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-medium">{money(row.totals.portfolioEnd)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            {beforeLimits ? '* As elected, before plan limits (unverified). ' : ''}
            Fees are the growth given up to expense ratios (already subtracted from net growth). Spending in working
            years is paid from pay, so withdrawals start in retirement.
          </p>
        </DataTableDisclosure>
      </CardContent>
    </Card>
  );
}
