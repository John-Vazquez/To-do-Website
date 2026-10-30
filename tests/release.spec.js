import { test, expect } from '@playwright/test';

test('release loads matching styles and module graph despite stale unversioned assets', async ({ page }) => {
  const assets = new Set();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (/\/(?:todo(?:-data|-demo|-config)?\.js|todostyles\.css)$/.test(url.pathname)) {
      assets.add(url.pathname + url.search);
      // Emulate the previous release still present under the old URLs.
      if (!url.searchParams.has('v')) return route.fulfill({
        contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: url.pathname.endsWith('.css') ? 'body { color: red }' : 'throw new Error("Stale release loaded");'
      });
    }
    return route.continue();
  });
  await page.goto('/todo.html?demo');
  await expect(page.locator('#connection-status')).toContainText('Demo ready');
  await expect(page.locator('.list-card')).toHaveCount(14);
  await expect(page.locator('.toolbar')).toHaveCSS('display', 'flex');
  await expect(page.locator('.sr-only')).toHaveCSS('position', 'absolute');
  expect(errors).toEqual([]);
  expect([...assets].sort()).toEqual([
    '/todo-config.js?v=20261030-3', '/todo-data.js?v=20261030-3',
    '/todo-demo.js?v=20261030-3', '/todo.js?v=20261030-3',
    '/todostyles.css?v=20261030-3'
  ].sort());
});
