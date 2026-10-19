/**
 * Engine parity through the UI: each calculator, rendered with its example values, shows the figures
 * the engine's own calculator returns for the same input (bundled rules, the UI's current year).
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  baristaFire,
  coastFire,
  compoundInterest,
  contribution401k,
  feeImpact,
  fiNumber,
  inflationPurchasingPower,
  lumpSumVsRecurring,
  matchOptimizer,
  retirementAge,
  rothVsTraditional,
  savingsGap,
  spendingPlanner,
  ssClaimingComparison,
  withdrawal,
  type CalculatorId,
  type SsClaimingComparisonInput,
  type WithdrawalInput,
} from '@rn/engine';
import { renderWithProfile } from '@/test/renderWithProfile';
import { figure, okValue, uiCtx as ctx } from '@/test/calculatorHelpers';
import { formatCents, formatPercent } from '@/lib/format';
import { CalculatorsPage } from './CalculatorsPage';
import * as D from './defaults';

const money = (c: number) => formatCents(c);
const pct = (r: number) => formatPercent(r, 2);

async function open(id: CalculatorId) {
  await renderWithProfile(<CalculatorsPage />, { path: `/calculators?c=${id}` });
}

describe('calculator engine parity (example values)', () => {
  it('compound interest', async () => {
    await open('compoundInterest');
    const r = okValue(compoundInterest(D.compoundInterestDefaults(), ctx));
    expect(await figure('Ending balance')).toBe(money(r.totals.endingBalance));
    expect(await figure('Total contributions')).toBe(money(r.totals.totalContributions));
    expect(await figure('Total growth after fees')).toBe(money(r.totals.totalGrowth));
  });

  it('fee impact', async () => {
    await open('feeImpact');
    const r = okValue(feeImpact(D.feeImpactDefaults(), ctx));
    expect(await figure('Lifetime cost of fees')).toBe(money(r.lifetimeCost));
    expect(await figure('Lifetime cost in today’s dollars')).toBe(money(r.lifetimeCostReal));
    expect(await figure('Fees charged')).toBe(money(r.feesCharged));
    expect(await figure('Ending balance without fees')).toBe(money(r.withoutFees.endingBalance));
  });

  it('lump sum vs recurring', async () => {
    await open('lumpSumVsRecurring');
    const r = okValue(lumpSumVsRecurring(D.lumpSumDefaults(), ctx));
    expect(await figure('Lump sum: ending balance')).toBe(money(r.lumpSum.endingBalance));
    expect(await figure('Recurring: ending balance')).toBe(money(r.recurring.endingBalance));
    expect(await figure('Lump sum minus recurring')).toBe(money(r.difference));
    expect(await figure('Recurring amount per year')).toBe(money(r.recurringAnnualAmount));
  });

  it('inflation and purchasing power', async () => {
    await open('inflationPurchasingPower');
    const input = D.inflationDefaults();
    const r = okValue(inflationPurchasingPower(input, ctx));
    expect(await figure(`Cost in ${input.years} years of today’s amount`)).toBe(money(r.futureCost));
    expect(await figure(`Today’s value of the future amount in ${input.years} years`)).toBe(money(r.todaysValue));
  });

  it('401(k) contributions, with after-limit amounts not available under the bundled rules', async () => {
    await open('contribution401k');
    const r = okValue(contribution401k(D.contribution401kDefaults(), ctx));
    expect(await figure('Balance at retirement')).toBe(money(r.totals.balanceAtRetirement));
    expect(await figure('Your contributions')).toBe(money(r.totals.employeeContributions));
    expect(await figure('Employer contributions')).toBe(money(r.totals.employerContributions));
    expect(await figure('Employer match before limits')).toBe(money(r.yearOne.matchBeforeLimits.total));
    expect(r.yearOne.capped).toBeNull();
    expect(screen.getByText('Not available yet: needs verified rules')).toBeInTheDocument();
    expect(screen.getByText('401(k)/403(b)/457(b) employee deferral limit')).toBeInTheDocument();
    expect(screen.getByText('Before plan limits (unverified)')).toBeInTheDocument();
  });

  it('employer match', async () => {
    await open('matchOptimizer');
    const r = okValue(matchOptimizer(D.matchOptimizerDefaults(), ctx));
    expect(await figure('Deferral that captures the full match')).toBe(pct(r.pctToCaptureFullMatch));
    expect(await figure('Full match per year')).toBe(money(r.maxPossibleMatch));
    expect(await figure('Match left unclaimed per year')).toBe(money(r.unclaimedAtCurrentRate));
    expect(await figure('Additional deferral for the full match')).toBe(money(r.additionalDeferralNeeded));
    expect(screen.getByText('Before plan limits', { selector: 'span' })).toBeInTheDocument();
  });

  it('Roth vs traditional, with the after-tax comparison not available under the bundled rules', async () => {
    await open('rothVsTraditional');
    const r = okValue(rothVsTraditional(D.rothVsTraditionalDefaults(), ctx));
    expect(await figure('Roth minus traditional, before tax')).toBe(money(r.beforeTaxDifferenceReal));
    expect(r.afterTaxDifferenceReal).toBeNull();
    expect(await figure('Roth minus traditional, after tax')).toBe('Not available yet');
    expect(screen.getByText('Not available yet: needs verified rules')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Roth and traditional side by side' })).toHaveTextContent(
      money(r.traditional.endingBalance),
    );
  });

  it('retirement age', async () => {
    await open('retirementAge');
    const r = okValue(retirementAge(D.retirementAgeDefaults(), ctx));
    expect(r.earliestAge).not.toBeNull();
    expect(await figure('Earliest retirement age that lasts')).toBe(String(r.earliestAge));
    expect(await figure(`Retiring at ${r.shown.retirementAge}: ending balance`)).toBe(
      money(r.shown.outcome.endingBalanceReal),
    );
  });

  it('savings gap', async () => {
    await open('savingsGap');
    const r = okValue(savingsGap(D.savingsGapDefaults(), ctx));
    expect(r.search).toBe('found');
    expect(await figure('Extra yearly contribution')).toBe(money(r.extraAnnualContribution ?? -1));
    expect(await figure('Total yearly contribution')).toBe(money(r.totalAnnualContribution ?? -1));
  });

  it('Coast FIRE', async () => {
    await open('coastFire');
    const r = okValue(coastFire(D.coastFireDefaults(), ctx));
    expect(await figure('Coast number (balance today)')).toBe(money(r.coastNumber ?? -1));
    expect(await figure('Gap to the coast number')).toBe(money(r.gap ?? -1));
    expect(await figure('Coasts with no further contributions')).toBe(r.coasts ? 'Yes' : 'No');
  });

  it('Barista FIRE', async () => {
    await open('baristaFire');
    const r = okValue(baristaFire(D.baristaFireDefaults(), ctx));
    expect(await figure('Minimum part-time pay per year')).toBe(money(r.minimumPartTimeIncome ?? -1));
    expect(await figure('Part-time pay over the phase')).toBe(money(r.totalPartTimeIncome));
  });

  it('FI number', async () => {
    await open('fiNumber');
    const r = okValue(fiNumber(D.fiNumberDefaults(), ctx));
    expect(await figure('FI number')).toBe(money(r.sustainable.fiNumber ?? -1));
    expect(await figure('Starting withdrawal rate it supports')).toBe(
      pct(r.sustainable.sustainableRateAtFiNumber ?? -1),
    );
    expect(await figure('Rule-of-thumb balance')).toBe(money(r.ruleOfThumb?.fiNumber ?? -1));
  });

  it('withdrawal, fixed rate', async () => {
    await open('withdrawal');
    const r = okValue(withdrawal(D.withdrawalDefaults() as WithdrawalInput, ctx));
    if (r.mode !== 'fixedPercentage') throw new Error('mode');
    expect(await figure('First-year spending')).toBe(money(r.annualSpending));
    expect(await figure('Ending balance')).toBe(money(r.endingBalance));
    expect(await figure('Years fully funded')).toBe(String(r.longevity.yearsFullyFunded));
  });

  it('spending planner', async () => {
    await open('spendingPlanner');
    const r = okValue(spendingPlanner(D.spendingPlannerDefaults(), ctx));
    expect(await figure('Total spending need')).toBe(money(r.totalSpendingNeed));
    expect(await figure('Total spending need in today’s dollars')).toBe(money(r.totalSpendingNeedReal));
  });

  it('Social Security claiming (amounts at each claiming age)', async () => {
    await open('ssClaimingComparison');
    const r = okValue(ssClaimingComparison(D.ssClaimingDefaults() as SsClaimingComparisonInput, ctx));
    const best = r.options.find((o) => o.claimAge.years === r.highestTotal?.years);
    expect(await figure('Its total')).toBe(money(best?.cumulativeThroughAge ?? -1));
    const table = screen.getByRole('region', { name: 'Social Security by claiming age' });
    for (const o of r.options) expect(table).toHaveTextContent(money(o.cumulativeThroughAge));
  });
});
