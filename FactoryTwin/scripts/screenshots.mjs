// Captures key states into docs/ for visual verification (no pixel diffs).
// Usage: npm run build && npx vite preview --port 4173 &  then  npm run screenshots
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const shots = [
  ['overview', '?t=9.4&paused=1'],
  ['top-view', '?t=9.4&paused=1&cam=top'],
  ['selected-machine', '?t=9.4&paused=1&select=station:cell-1&cam=focus'],
  ['product-lifecycle', '?t=9.42&paused=1&select=product:P400&cam=focus'],
  ['failure-state', '?scenario=breakdown&t=3.4&paused=1&select=station:cell-1&cam=focus&tab=incidents'],
  ['dashboard', '?t=30&paused=1&tab=dashboard'],
  ['scenario-1-normal', '?scenario=normal&t=34&paused=1&tab=dashboard'],
  ['scenario-2-breakdown', '?scenario=breakdown&t=6&paused=1&tab=dashboard'],
  ['scenario-3-optimized', '?scenario=optimized&t=34&paused=1&tab=dashboard'],
  ['experiments', '?t=8&paused=1&tab=experiments'],
];

mkdirSync('docs', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, query] of shots) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(BASE + '/' + query);
  await page.waitForTimeout(Number(process.env.SHOT_WAIT ?? 14000));
  await page.screenshot({ path: `docs/${name}.png`, timeout: 240000 });
  console.log('saved', name);
  await page.close();
}
await browser.close();
