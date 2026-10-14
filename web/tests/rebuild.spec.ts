import { test, expect } from '@playwright/test';

test('new entry points and original essay links work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Our community.');
  await page.getByRole('link', { name: 'Why I’m building this →' }).click();
  await expect(page.getByRole('heading', { name: 'Start with the education.' })).toBeVisible();
  await page.goto('/updates/the-community-we-create');
  await expect(page.getByRole('link', { name: 'Read the original essay ↗' })).toHaveAttribute('href', 'https://maconphillips.com/the-community-we-create/');
});

test('starter question fills the real composer and provider errors remain visible', async ({ page }) => {
  await page.goto('/ask');
  const starter = 'What is the Cabot feasibility study meant to establish?';
  await page.getByRole('button', { name: starter }).click();
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue(starter);
  test.skip(!process.env.REBUILD_LIVE_PREVIEW, 'Submitting requires the privately configured preview');
  await page.route('**/api/ask', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Evidence is temporarily unavailable.' }) }));
  await page.getByRole('button', { name: 'Ask Open Valley ↑' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Evidence is temporarily unavailable.' })).toBeVisible();
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue(starter);
});

test('live meeting filters preserve snapshot labels and direct original links', async ({ page }) => {
  test.skip(!process.env.REBUILD_LIVE_PREVIEW, 'Requires the collection read model');
  await page.goto('/meetings');
  await page.getByLabel('Board or committee').selectOption('Outreach Committee');
  await page.getByLabel('Find a date or body').fill('2026-09');
  const rows = page.locator('.meeting-row');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) await expect(row.getByRole('heading')).toHaveText('Outreach Committee');
  for (const link of await page.locator('.meeting-links a').all()) await expect(link).toHaveAttribute('href', /^https:\/\/(docs\.google\.com|drive\.google\.com|huusd\.org)\//);
  await page.getByLabel('Find a date or body').fill('1900-01');
  await expect(page.getByText('No matching meeting records.')).toBeVisible();
});

test('district selection works independently of map tiles', async ({ page }) => {
  test.skip(!process.env.REBUILD_LIVE_PREVIEW, 'Requires reviewed publication');
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/district');
  const school = page.getByRole('button', { name: /Warren Elementary School/ }).first();
  await school.click();
  await expect(school).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.selected-fact')).toContainText('latest attending count');
  await expect(page.locator('.selected-fact').getByRole('link', { name: 'Original enrollment source ↗' })).toHaveAttribute('href', /^https:\/\//);
});

for (const width of [320, 390, 1440]) {
  test(`rebuild fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/ask', '/district', '/meetings', '/updates']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
