import { expect, test } from './fixtures';
import { advance, gotoQuickstart, readGame } from './helpers';

test('one in-game day: settlers move, do something, and their needs change', async ({ page }) => {
  await gotoQuickstart(page, { seed: 'qa-autonomy' });
  const start = await readGame(page);
  expect(start.settlers.length).toBeGreaterThan(0);

  // One in-game day is 1800 ticks (180 real seconds at 1x). Sample every 60 ticks.
  const kinds = new Set<string>();
  const moved = new Set<number>();
  let last = start;
  for (let i = 0; i < 30; i++) {
    await advance(page, 60);
    last = await readGame(page);
    for (const s of last.settlers) {
      kinds.add(s.activity.kind);
      const s0 = start.settlers.find((x) => x.id === s.id);
      if (s0 && (Math.abs(s0.pos.x - s.pos.x) > 0.01 || Math.abs(s0.pos.y - s.pos.y) > 0.01)) moved.add(s.id);
    }
  }

  expect(last.day).toBeGreaterThanOrEqual(2);
  expect(moved.size, 'at least one settler moved away from its start tile').toBeGreaterThan(0);

  const nonIdle = [...kinds].filter((k) => k !== 'idle');
  expect(nonIdle.length, `activities seen: ${[...kinds].join(', ')}`).toBeGreaterThan(0);

  const needsChanged = last.settlers.some((s) => {
    const s0 = start.settlers.find((x) => x.id === s.id);
    if (!s0) return false;
    return (Object.keys(s.needs) as (keyof typeof s.needs)[]).some((k) => s.needs[k] !== s0.needs[k]);
  });
  expect(needsChanged, 'at least one need changed for at least one settler').toBe(true);

  const faulted = await page.evaluate(() => (window as unknown as { __frontierColony: { isFaulted(): boolean } }).__frontierColony.isFaulted());
  expect(faulted).toBe(false);
});
