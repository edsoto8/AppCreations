import { expect, test } from '@playwright/test';
import { appUrl, onboardWithSample, trackConsoleErrors, trackOutboundRequests } from './helpers';

test.describe('M8 account management', () => {
  test('add, edit and delete an account; the dashboard follows; it all survives a reload', async ({ page }) => {
    const outbound = trackOutboundRequests(page);
    const errors = trackConsoleErrors(page);
    await onboardWithSample(page, 1);
    await page.goto(appUrl('/'));
    const savings = page.getByRole('heading', { name: 'Current savings' }).locator('..').locator('..');
    const before = await savings.textContent();

    await page.goto(appUrl('/accounts'));
    await page.getByRole('button', { name: 'Add account' }).click();
    const add = page.getByRole('dialog');
    await add.getByLabel('Account type', { exact: true }).selectOption('cash');
    await add.getByLabel('Account name', { exact: true }).fill('Emergency fund');
    await add.getByLabel('Current balance', { exact: true }).fill('25000');
    await add.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByText('Emergency fund').first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit Emergency fund' }).click();
    const edit = page.getByRole('dialog');
    await edit.getByLabel('Current balance', { exact: true }).fill('30000');
    await edit.getByRole('button', { name: 'Save changes' }).click();

    await page.goto(appUrl('/'));
    await expect.poll(async () => savings.textContent()).not.toBe(before);

    await page.waitForTimeout(500); // debounced save
    await page.reload();
    await page.goto(appUrl('/accounts'));
    await expect(page.getByText('Emergency fund').first()).toBeVisible();
    await page.getByRole('button', { name: 'Delete Emergency fund' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText('Emergency fund')).toHaveCount(0);
    expect(outbound()).toEqual([]);
    expect(errors()).toEqual([]);
  });
});
