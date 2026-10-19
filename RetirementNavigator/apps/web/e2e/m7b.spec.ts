import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { appUrl, expectNoAxeViolations, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('M7b data, insights and print', () => {
  test('export JSON, delete everything, import it back; CSV downloads; nothing leaves the device', async ({
    page,
  }, testInfo) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/data'));
    await expect(page.getByRole('heading', { level: 1, name: 'Data & Privacy' })).toBeVisible();

    const [json] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON' }).click(),
    ]);
    expect(json.suggestedFilename()).toMatch(/^retirement-navigator-export-\d{4}-\d{2}-\d{2}\.json$/);
    const exportPath = testInfo.outputPath('export.json');
    await json.saveAs(exportPath);
    const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as { profiles: unknown[] };
    expect(exported.profiles.length).toBeGreaterThan(0);

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    const csvPath = testInfo.outputPath('forecast.csv');
    await csv.saveAs(csvPath);
    expect(readFileSync(csvPath, 'utf8').split('\r\n')[0]).toMatch(/^Year,Phase,/);

    await page.getByRole('button', { name: 'Delete all my data' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete all your data?' });
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page).toHaveURL(/#\/welcome/);
    // Everything the app stored is gone, also after a reload.
    await page.reload();
    await expect(page).toHaveURL(/#\/welcome/);
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('retirement-navigator');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const counts: number[] = [];
      for (const name of Array.from(db.objectStoreNames)) {
        counts.push(
          await new Promise<number>((resolve) => {
            const req = db.transaction(name).objectStore(name).count();
            req.onsuccess = () => resolve(req.result);
          }),
        );
      }
      db.close();
      return { counts, theme: localStorage.getItem('rn-theme') };
    });
    expect(stored.counts.every((n) => n === 0)).toBe(true);
    expect(stored.theme).toBeNull();

    await page.goto(appUrl('/data'));
    await expect(page.getByRole('heading', { level: 1, name: 'Data & Privacy' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Export file (.json)').setInputFiles(exportPath);
    await page.getByRole('button', { name: 'Replace all data' }).click({ timeout: 15_000 });
    await expect(page.getByText(/^Imported \d+ profile/).first()).toBeVisible({ timeout: 15_000 });
    await page.goto(appUrl('/'));
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  test('a malformed import shows its problems and changes nothing', async ({ page }, testInfo) => {
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/data'));
    const bad = testInfo.outputPath('bad.json');
    writeFileSync(bad, '{ "format": "retirement-navigator-export", ');
    await page.getByLabel('Export file (.json)').setInputFiles(bad);
    await expect(page.getByText(/not valid JSON/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace all data' })).toHaveCount(0);
  });

  test('insights and the printable summary are accessible in both themes', async ({ page }) => {
    test.setTimeout(120_000);
    await onboardWithSample(page, 1);
    for (const path of ['/insights', '/print']) {
      for (const theme of ['Light theme', 'Dark theme']) {
        await page.goto(appUrl(path));
        await page.getByRole('radio', { name: theme }).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (path === '/insights')
          await expect(page.getByText(/^In this model/).first()).toBeVisible({ timeout: 20_000 });
        await expectNoAxeViolations(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
      }
    }
    // Print media hides the app chrome and keeps the disclaimers.
    await page.goto(appUrl('/print'));
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation').first()).toBeHidden();
    await expect(page.getByText(/not guarantees/).first()).toBeVisible();
  });
});
