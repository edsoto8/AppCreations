import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatPercent } from '@/lib/format';
import { BASELINE_SERIES_COLOR } from './seriesPalette';
import { SERIES } from './chartTheme';

interface InterestSavingsBarsProps {
  baselineInterest: number;
  scenarioInterest: number;
  interestSaved: number;
  /** 0–100, from the engine. */
  percentReduction: number;
  currency: string;
  baselineLabel?: string;
  scenarioLabel?: string;
}

/**
 * Two bars on one scale: remaining interest without and with the plan. The plan's bar is the
 * interest colour; the part it no longer pays sits beside it (2px surface gap) as a light positive
 * wash labelled "saved", so the saving reads as the gap between the two lengths.
 */
export function InterestSavingsBars({
  baselineInterest,
  scenarioInterest,
  interestSaved,
  percentReduction,
  currency,
  baselineLabel = 'Without extra payments',
  scenarioLabel = 'With this plan',
}: InterestSavingsBarsProps) {
  const max = Math.max(baselineInterest, scenarioInterest, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const fmt = (v: number) => formatCurrency(v, currency);
  return (
    <div className="grid gap-5" role="group" aria-label="Remaining interest comparison">
      <Row label={baselineLabel} value={fmt(baselineInterest)}>
        <Segment width={pct(baselineInterest)} color={BASELINE_SERIES_COLOR} opacity={0.55} tip={`${baselineLabel}: ${fmt(baselineInterest)} interest`} rounded />
      </Row>
      <Row label={scenarioLabel} value={fmt(scenarioInterest)} strong>
        <Segment width={pct(scenarioInterest)} color={SERIES.interest} tip={`${scenarioLabel}: ${fmt(scenarioInterest)} interest`} rounded={interestSaved <= 0} />
        {interestSaved > 0 && (
          <Segment
            width={pct(interestSaved)}
            color="var(--positive)"
            opacity={0.18}
            tip={`Saved: ${fmt(interestSaved)} (${formatPercent(percentReduction, 1)} less interest)`}
            rounded
            label="saved"
          />
        )}
      </Row>
      <p className="text-sm text-muted-foreground">
        {interestSaved > 0 ? (
          <>
            You keep <span className="font-semibold text-positive">{fmt(interestSaved)}</span> — {formatPercent(percentReduction, 1)} less remaining
            interest.
          </>
        ) : (
          'No interest saved yet. Add an extra payment to see the difference.'
        )}
      </p>
    </div>
  );
}

function Row({ label, value, strong, children }: { label: string; value: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
        <span className={strong ? 'num font-semibold' : 'num text-muted-foreground'}>{value}</span>
      </div>
      <div className="flex h-5 w-full gap-[2px]">{children}</div>
    </div>
  );
}

function Segment({
  width,
  color,
  opacity = 1,
  tip,
  rounded,
  label,
}: {
  width: string;
  color: string;
  opacity?: number;
  tip: string;
  rounded?: boolean;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          aria-label={tip}
          className="relative h-full overflow-visible outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          style={{ width, minWidth: 3, borderRadius: rounded ? '0 4px 4px 0' : 0 }}
        >
          <div className="absolute inset-0 transition-[filter] hover:brightness-110" style={{ backgroundColor: color, opacity, borderRadius: 'inherit' }} />
          {label && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-medium text-positive @container">
              <span className="hidden @[3.5rem]:inline">{label}</span>
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function InterestSavingsTable(props: InterestSavingsBarsProps) {
  const fmt = (v: number) => formatCurrency(v, props.currency);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Remaining interest</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>{props.baselineLabel ?? 'Without extra payments'}</TableCell>
          <TableCell className="text-right">{fmt(props.baselineInterest)}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>{props.scenarioLabel ?? 'With this plan'}</TableCell>
          <TableCell className="text-right">{fmt(props.scenarioInterest)}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Interest saved</TableCell>
          <TableCell className="text-right">
            {fmt(props.interestSaved)} ({formatPercent(props.percentReduction, 1)})
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
