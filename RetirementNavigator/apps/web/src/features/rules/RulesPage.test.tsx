import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RULES, type RulesSet, type TaxYearRules } from '@rn/engine';
import { RulesPage } from './RulesPage';

/** Independent walk of the rules set: a leaf is an object with a string `status` and a `value` key. */
function leaves(node: unknown): { status: string }[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return [];
  const record = node as Record<string, unknown>;
  if (typeof record.status === 'string' && 'value' in record) return [{ status: record.status }];
  return Object.values(record).flatMap(leaves);
}

function renderPage(rules?: RulesSet) {
  return render(
    <MemoryRouter>
      <RulesPage rules={rules} />
    </MemoryRouter>,
  );
}

const DEFERRAL_LABEL = '401(k)/403(b)/457(b) employee deferral limit';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

describe('RulesPage', () => {
  it('summarises status counts that match the bundled rules', () => {
    renderPage();
    const all = [...leaves(RULES.standing), ...leaves(RULES.years)];
    const count = (s: string) => all.filter((l) => l.status === s).length;
    expect(all.length).toBeGreaterThan(0);

    const summary = screen.getByRole('region', { name: 'Summary' });
    const stat = (label: string) => within(summary).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(stat('Total')).toHaveTextContent(String(all.length));
    expect(stat('Verified')).toHaveTextContent(String(count('verified')));
    expect(stat('Unverified')).toHaveTextContent(String(count('unverified')));
    expect(stat('Not yet published')).toHaveTextContent(String(count('notPublished')));
    expect(within(summary).getByText(/never fills in an unverified value/)).toBeInTheDocument();
    expect(screen.getByText(`Showing ${all.length} of ${all.length} rules`)).toBeInTheDocument();
  });

  it('shows the 2026 elective deferral as unverified, with its candidate labeled as not used', () => {
    const rule = RULES.years['2026']?.workplace.electiveDeferral;
    if (rule?.status !== 'unverified' || !rule.candidate) throw new Error('fixture expectation: unverified candidate');
    renderPage();

    const year2026 = screen.getByRole('region', { name: 'Tax year 2026' });
    const item = within(year2026).getByRole('article', { name: DEFERRAL_LABEL });
    expect(within(item).getByText('Unverified')).toBeInTheDocument();
    expect(within(item).getByText('2026:workplace.electiveDeferral')).toBeInTheDocument();
    expect(within(item).getByText(rule.unverifiedReason)).toBeInTheDocument();
    expect(within(item).getByText('Candidate (not verified, not used in calculations)')).toBeInTheDocument();
    expect(within(item).getByText(usd.format(rule.candidate.value / 100))).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: /IRS Notice 2025-67/ })).toHaveAttribute(
      'href',
      rule.candidate.source.url,
    );
    expect(within(item).getByText('Indexed')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderPage();
    const pendingCount = leaves(RULES).filter((l) => l.status === 'notPublished').length;

    await user.selectOptions(screen.getByLabelText('Status'), 'notPublished');
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(pendingCount);
    for (const a of articles) expect(within(a).getByText('Not yet published')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tax year 2026' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tax year 2027' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'verified');
    const verifiedCount = leaves(RULES).filter((l) => l.status === 'verified').length;
    if (verifiedCount === 0) expect(screen.getByText('No rules match these filters.')).toBeInTheDocument();
    else expect(screen.getAllByRole('article')).toHaveLength(verifiedCount);
  });

  it('searches by label, combined with the status filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Search by name'), 'deferral');

    expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
    for (const a of screen.getAllByRole('article')) expect(a).toHaveAccessibleName(/deferral/i);
    expect(screen.getAllByRole('article', { name: DEFERRAL_LABEL })).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('Status'), 'unverified');
    const year2026 = screen.getByRole('region', { name: 'Tax year 2026' });
    expect(within(year2026).getByRole('article', { name: DEFERRAL_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tax year 2027' })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search by name'));
    await user.type(screen.getByLabelText('Search by name'), 'zzz no such rule');
    expect(screen.getByText('No rules match these filters.')).toBeInTheDocument();
  });

  it('links every source to irs.gov, ssa.gov or federalregister.gov in a new tab', () => {
    renderPage();
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    const hrefs = links.map((l) => l.getAttribute('href') ?? '');
    for (const href of hrefs)
      expect(href).toMatch(/^https:\/\/(www\.|www-origin\.|eitc\.)?(irs\.gov|ssa\.gov|federalregister\.gov)\//);
    expect(hrefs.some((h) => h.includes('irs.gov'))).toBe(true);
    expect(hrefs.some((h) => h.includes('ssa.gov'))).toBe(true);
    for (const l of links) {
      expect(l).toHaveAttribute('target', '_blank');
      expect(l).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('renders a verified rule with its value, source, retrieval date and details', () => {
    const rules = structuredClone(RULES);
    const year = rules.years['2026'];
    if (!year) throw new Error('2026 rules missing');
    // Synthetic test fixture (not a real limit): exercises the verified display path.
    year.workplace.electiveDeferral = {
      status: 'verified',
      value: 1_234_500,
      source: {
        publication: 'Test publication',
        url: 'https://www.irs.gov/test',
        locator: 'Table 1',
        retrievedOn: '2026-01-15',
        method: 'primary-document',
      },
      secondSource: null,
      indexation: 'indexed',
      rounding: { mode: 'down', incrementDollars: 500 },
      sunsetYear: null,
      notes: 'Synthetic note',
    } as unknown as TaxYearRules['workplace']['electiveDeferral'];
    renderPage(rules);

    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Verified', { selector: 'dt' }).nextElementSibling).toHaveTextContent('1');

    const item = within(screen.getByRole('region', { name: 'Tax year 2026' })).getByRole('article', {
      name: DEFERRAL_LABEL,
    });
    expect(within(item).getByText('Verified')).toBeInTheDocument();
    expect(within(item).getByText('$12,345')).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: /Test publication/ })).toHaveAttribute(
      'href',
      'https://www.irs.gov/test',
    );
    expect(within(item).getByText('Jan 15, 2026')).toBeInTheDocument();
    expect(within(item).getByText('Rounded down to a multiple of $500')).toBeInTheDocument();
    expect(within(item).getByText('Synthetic note')).toBeInTheDocument();
    expect(within(item).queryByText(/Candidate/)).not.toBeInTheDocument();
  });
});
