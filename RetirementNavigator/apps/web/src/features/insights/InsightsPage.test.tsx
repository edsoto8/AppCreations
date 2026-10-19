import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeInsights, HouseholdSchema, projectHousehold, RULES, SAMPLE_PROFILES, type Household } from '@rn/engine';
import { renderWithProfile, TEST_YEAR } from '@/test/renderWithProfile';
import { useProfileStore } from '@/state/profileStore';
import { useScenarioStore } from '@/state/scenarioStore';
import { CURRENT_YEAR } from '@/app/env';
import { InsightsPage } from './InsightsPage';
import { describeInsightOp, metricView } from './insightModel';

const ctx = { currentYear: CURRENT_YEAR, rules: RULES };

function couple(): Household {
  return SAMPLE_PROFILES.find((p) => p.id === 'midCareerCouple')!.build(TEST_YEAR);
}

function expectedInsights(household: Household) {
  const r = computeInsights(household, ctx);
  if (r.status !== 'ok') throw new Error('insights failed');
  expect(r.value.length).toBeGreaterThan(0);
  return r.value;
}

describe('InsightsPage', () => {
  it('renders each engine insight: body, metric, what was changed, assumptions and tone', async () => {
    const household = couple();
    await renderWithProfile(<InsightsPage />, { path: '/insights' });
    const insights = expectedInsights(household);
    await screen.findByRole('region', { name: insights[0]!.title });

    for (const insight of insights) {
      const card = screen.getByRole('region', { name: insight.title });
      expect(within(card).getByText(insight.body)).toBeInTheDocument();
      const m = metricView(insight);
      expect(within(card).getByText(`${m.label} · Today’s dollars`)).toBeInTheDocument();
      expect(within(card).getByText('Baseline').nextElementSibling).toHaveTextContent(m.baseline);
      expect(within(card).getByText('What-if').nextElementSibling).toHaveTextContent(m.whatIf);
      expect(within(card).getByText('Change').nextElementSibling).toHaveTextContent(m.delta);

      // Assumptions disclosure: a native <details>, keyboard operable through its <summary>.
      const summary = within(card).getByText('Assumptions');
      expect(summary.tagName).toBe('SUMMARY');
      const details = summary.closest('details')!;
      for (const a of insight.assumptions) expect(within(details).getByText(a)).toBeInTheDocument();

      const changed = within(card).getByRole('heading', { name: 'What was changed' }).nextElementSibling!;
      const lines = within(changed as HTMLElement).getAllByRole('listitem');
      expect(lines.map((li) => li.textContent)).toEqual(
        insight.whatIfOps.map((op) => describeInsightOp(op, household)),
      );

      if (insight.tone === 'attention') expect(within(card).getByText('Attention')).toBeInTheDocument();
      else expect(within(card).queryByText('Attention')).not.toBeInTheDocument();
    }
    expect(screen.getByText(/model-dependent educational estimates/)).toBeInTheDocument();
  });

  it('shows the before-limits / before-taxes badges and the healthcare note from the baseline', async () => {
    const base = couple();
    const household = HouseholdSchema.parse({
      ...base,
      people: base.people.map((p) => ({ ...p, retirementAge: 60 })),
    });
    await renderWithProfile(<InsightsPage />, { household, path: '/insights' });
    const insights = expectedInsights(household);
    const card = await screen.findByRole('region', { name: insights[0]!.title });
    const baseline = projectHousehold(household, ctx);
    if (baseline.status !== 'ok') throw new Error('projection failed');
    const limits = baseline.value.excludedFeatures.some((f) =>
      ['workplaceLimits', 'iraLimits', 'hsaLimits', 'rothIraEligibility'].includes(f),
    );
    const taxes = baseline.value.rows.some((r) => r.phase === 'retirement' && r.tax === null);
    expect(within(card).queryByText('Before plan limits (unverified)') !== null).toBe(limits);
    expect(within(card).queryByText('Before taxes') !== null).toBe(taxes);
    const note = baseline.value.warnings.find((w) => w.code === 'healthcarePreMedicareUserEntered');
    expect(note).toBeDefined();
    expect(screen.getByRole('note', { name: 'Healthcare before Medicare' })).toHaveTextContent(note!.message);
  });

  it('“Save as scenario” creates a custom scenario with the insight’s ops', async () => {
    const user = userEvent.setup();
    const household = couple();
    await renderWithProfile(<InsightsPage />, { path: '/insights' });
    const insights = expectedInsights(household);
    const target = insights[insights.length - 1]!;
    const card = await screen.findByRole('region', { name: target.title });
    await user.click(within(card).getByRole('button', { name: 'Save as scenario' }));
    await within(card).findByText(`Saved as “Insight: ${target.title}”.`);

    const profileId = useProfileStore.getState().activeId!;
    const saved = Object.values(useScenarioStore.getState().scenarios).map((d) => d.scenario);
    const mine = saved.filter((s) => s.name === `Insight: ${target.title}`);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ baseProfileId: profileId, preset: null, presetParams: {} });
    expect(mine[0]!.ops).toEqual(target.whatIfOps);
    expect(within(card).getByRole('link', { name: 'Open Scenarios' })).toHaveAttribute('href', '/scenarios');
  });
});
