/**
 * M5 features: priorities, decisions, objectives, colony loss, colony log.
 * Where no player command can reach a state on demand (a trader decision, a lost colony), the test
 * writes that state into the live GameState first. Each such helper is marked TEST SETUP ONLY in
 * helpers.ts; everything the test asserts afterwards goes through the real UI.
 */
import { expect, test } from './fixtures';
import { forceColonyLost, gotoQuickstart, injectTraderDecision, waitFrames } from './helpers';


/** Page-side reads used by these tests. */
async function colonyLog(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __frontierColony: { getState(): { eventLog: { message: string }[] } } }).__frontierColony.getState();
    return s.eventLog.map((e) => e.message);
  });
}

async function woodcuttingPriority(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const s = (window as unknown as { __frontierColony: { getState(): { colony: { priorities: Record<string, number> } } } }).__frontierColony.getState();
    return s.colony.priorities.woodcutting ?? -1;
  });
}

test.describe('M5 priorities', () => {
  test('clicking a priority level updates the sim state and the job row', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-m5-priorities' });
    await page.getByTestId('tool-priorities').click();
    await expect(page.getByTestId('priorities-panel')).toBeVisible();

    await page.getByTestId('priority-woodcutting-0').click();
    await expect.poll(() => woodcuttingPriority(page)).toBe(0);
    await expect(page.getByTestId('job-woodcutting')).toHaveClass(/is-off/);

    await page.getByTestId('priority-woodcutting-3').click();
    await expect.poll(() => woodcuttingPriority(page)).toBe(3);
    await expect(page.getByTestId('job-woodcutting')).not.toHaveClass(/is-off/);

    await page.getByTestId('priorities-reset').click();
    await expect(page.getByTestId('priorities-reset')).toBeVisible();
  });
});

test.describe('M5 objectives', () => {
  test('the objectives widget is visible with a current objective', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-m5-objectives' });
    await expect(page.getByTestId('objectives')).toBeVisible();
    await expect(page.getByTestId('objective-current')).not.toBeEmpty();
    await expect(page.getByTestId('objectives-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('objectives-toggle').click();
    await expect(page.getByTestId('objectives-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('M5 decisions', () => {
  test('declining a trader decision closes the card and logs the decline', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-m5-decline' });
    await injectTraderDecision(page, { giveWood: 5, getStone: 3 });
    const card = page.getByTestId('decision');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('decision-title')).not.toBeEmpty();

    await page.getByTestId('decision-decline').click();
    await expect(card).toBeHidden();
    await expect.poll(() => colonyLog(page)).toContainEqual("Declined the trader's offer.");
  });

  test('accepting a trader decision closes the card and logs the trade', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-m5-accept' });
    await injectTraderDecision(page, { giveWood: 5, getStone: 3 });
    await expect(page.getByTestId('decision')).toBeVisible();

    await page.getByTestId('decision-accept').click();
    await expect(page.getByTestId('decision')).toBeHidden();
    await expect.poll(async () => (await colonyLog(page)).some((m) => m.startsWith('Traded '))).toBe(true);
  });

  test('the colony log lists entries and filters them', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-m5-log' });
    await injectTraderDecision(page, { giveWood: 5, getStone: 3 });
    await page.getByTestId('decision-accept').click();
    await expect.poll(async () => (await colonyLog(page)).some((m) => m.startsWith('Traded '))).toBe(true);

    await page.getByTestId('tool-events').click();
    await expect(page.getByTestId('events-panel')).toBeVisible();
    await expect(page.getByTestId('log-list')).toBeVisible();
    await expect(page.getByTestId('log-entry').first()).toBeVisible();
    await expect(page.getByTestId('log-list')).toContainText('Traded');

    // The "Good" filter keeps the trade (severity good) and hides the info-level decision text.
    await page.getByTestId('log-filter-good').click();
    await expect(page.getByTestId('log-filter-good')).toHaveAttribute('aria-pressed', 'true');
    const entries = page.getByTestId('log-entry');
    await expect(entries.first()).toBeVisible();
    const count = await entries.count();
    for (let i = 0; i < count; i++) await expect(entries.nth(i)).toHaveClass(/log__entry--good/);
  });
});

test.describe('M5 colony loss', () => {
  test('a lost colony shows the game-over overlay, and "new game" returns to the menu', async ({ page }) => {
    await gotoQuickstart(page, { seed: 'qa-m5-lost' });
    await waitFrames(page, 2);
    await forceColonyLost(page);

    await expect(page.getByTestId('gameover')).toBeVisible();
    await expect(page.getByTestId('gameover-reason')).toContainText('The frontier has claimed');

    await page.getByTestId('gameover-new').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('new-game-form')).toBeVisible();
    await expect(page.getByTestId('gameover')).toBeHidden();
  });
});
