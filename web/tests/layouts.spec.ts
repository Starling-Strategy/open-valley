import { test, expect } from '@playwright/test';

const readingRoutes = ['/about', '/newsletter', '/updates', '/updates/the-community-we-create', '/learn', '/learn/methodology', '/story'];
if (process.env.LAYOUT_DOCUMENT_ID) readingRoutes.push(`/library/${process.env.LAYOUT_DOCUMENT_ID}`);
const wideRoutes = ['/', '/district', '/meetings', '/library', '/ask', '/homes', '/data', '/explore', '/schools'];

for (const width of [320, 390, 768, 1024, 1440, 2000]) {
  test(`shared templates align and fit at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    for (const route of [...readingRoutes, ...wideRoutes]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const layout = page.locator('#main-content > .page-layout');
      await expect(layout).toHaveCount(1);
      const bounds = await layout.boundingBox();
      expect(bounds).not.toBeNull();
      expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2), route).toBeLessThanOrEqual(1);
      expect(bounds!.x, route).toBeGreaterThanOrEqual(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
      for (const element of await page.locator('h1, .page-header, .newsletter-card, .conversation, .source-page').all()) {
        const box = await element.boundingBox();
        expect(box!.x, route).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, route).toBeLessThanOrEqual(width);
      }
      if (route !== '/') {
        const header = page.locator('.page-header');
        const headerBounds = await header.boundingBox();
        const layoutTop = bounds!.y + await layout.evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
        // A document's back link precedes its header; all other pages share a top inset.
        if (!route.startsWith('/library/')) expect(headerBounds!.y, route).toBeCloseTo(layoutTop, 0);
      }
      if (readingRoutes.includes(route)) {
        expect(bounds!.width, route).toBeLessThanOrEqual(768);
        const header = await layout.locator('.page-header').boundingBox();
        expect(header!.x, route).toBeCloseTo(bounds!.x, 0);
        const body = layout.locator('.article-content, .article-list').first();
        if (await body.count()) {
          const bodyBounds = await body.boundingBox();
          expect(bodyBounds!.x, route).toBeCloseTo(bounds!.x, 0);
          expect(bodyBounds!.width, route).toBeCloseTo(bounds!.width, 0);
        }
      } else {
        expect(bounds!.width, route).toBe(Math.min(width - 40, 1200));
      }
      for (const selector of ['.site-header .site-container', '.site-footer .site-container']) {
        const chrome = await page.locator(selector).boundingBox();
        expect(Math.abs(chrome!.x + chrome!.width / 2 - width / 2), selector).toBeLessThanOrEqual(1);
      }
    }
    expect(errors).toEqual([]);
  });
}
