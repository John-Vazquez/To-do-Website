import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LISTS } from '../todo-config.js';

const card = (page, index) => page.locator(`[data-list-id="${LISTS[index].id}"]`);
const demoSource = await readFile(new URL('../todo-demo.js', import.meta.url), 'utf8');
test.beforeEach(async ({ page }) => {
  // All browser tests are isolated from Supabase and all external services.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const source = demoSource
    .replace('async lists() {', "async lists() { if (window.__fail === 'lists') throw new Error('Fixture connection unavailable');")
    .replace('async tasks(id) {', "async tasks(id) { if (window.__fail === 'tasks') throw new Error('Fixture task loading denied');")
    .replace('async create(id, fields) {', "async create(id, fields) { if (window.__fail === 'create') throw new Error('Fixture insert denied');")
    .replace('async update(task, fields) {', "async update(task, fields) { if (window.__fail === 'update') throw new Error('Fixture update denied');")
    .replace('async remove(task) {', "async remove(task) { if (window.__fail === 'remove') throw new Error('Fixture delete denied');")
    .replace('async rename(id, title) {', "async rename(id, title) { if (window.__fail === 'rename') throw new Error('Fixture rename denied');");
  await page.route('**/todo-demo.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
  await page.goto('/todo.html');
  await expect(page.locator('#connection-status')).toContainText('Demo ready');
});

test('every list loads in order, correct titles and task associations remain intact', async ({ page }) => {
  await expect(page.locator('.list-card')).toHaveCount(14);
  await expect(page.locator('.list-card h2, .list-card h3')).toHaveText(['Doing Right Now', 'Must Do Today', 'This week', 'Work & projects', 'Things to buy', 'Doctor appointments', 'Things to return', 'Paintball', 'Things to sell', 'Appointments', 'Discrete II', 'Calc III', 'Cyber Analysis', 'Topics in Cyber']);
  await expect(card(page, 0).locator('.task-content')).toContainText(['Finish the application update', 'Book the appointment']);
  await expect(card(page, 4).locator('.task-content')).toHaveText(['A notebook for the desk', 'Toothpaste and milk']);
  for (let i = 10; i < 14; i++) await expect(card(page, i).locator('.empty-state')).toBeVisible();
  await expect(page.locator('.list-card').first()).toHaveAttribute('data-list-id', LISTS[0].id);
  await expect(page.locator('.list-card').nth(1)).toHaveAttribute('data-list-id', LISTS[1].id);
});

test('create, edit, unsaved edit protection, completion and deletion work', async ({ page }) => {
  const view = card(page, 2), form = view.locator('form');
  await form.getByLabel('Task', { exact: true }).fill('A new task');
  await form.getByLabel('Due date').fill('2026-12-10'); await form.getByLabel('Urgency').selectOption('3');
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect(view.locator('.task-content')).toContainText(['A new task']);
  await view.getByRole('button', { name: 'Edit A new task', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Task', { exact: true }).fill('An edited task');
  await page.keyboard.press('Escape'); await expect(page.locator('#discard-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await expect(view.locator('.task-content')).toContainText(['An edited task']);
  await view.getByRole('button', { name: 'Complete An edited task', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('removes the task permanently');
  await page.getByRole('button', { name: 'Complete & remove', exact: true }).click();
  await expect(view.getByText('An edited task', { exact: true })).toHaveCount(0);
  const title = 'Make a little time to plan the week';
  await view.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(view.getByText(title, { exact: true })).toHaveCount(0);
});

test('repeated submit events cannot duplicate inserts and Must Do Today stops at three', async ({ page }) => {
  const view = card(page, 1), form = view.locator('form');
  await form.getByLabel('Task', { exact: true }).fill('Third priority');
  await form.evaluate(node => { node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect(view.locator('.task-row')).toHaveCount(3); await expect(view.locator('.list-state')).toHaveText('Task saved.');
  await form.getByLabel('Task', { exact: true }).fill('Fourth priority');
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect(view.locator('.error')).toContainText('limited to 3'); await expect(view.locator('.task-row')).toHaveCount(3);
  await expect(form.getByLabel('Task', { exact: true })).toHaveValue('Fourth priority');
});

test('failed operations keep drafts, tasks and titles; successful reconciliation permits retry', async ({ page }) => {
  const view = card(page, 2), form = view.locator('form');
  await page.evaluate(() => window.__fail = 'create');
  await form.getByLabel('Task', { exact: true }).fill('Keep this draft'); await form.getByRole('button', { name: 'Add task' }).click();
  await expect(view.locator('.error')).toContainText('Fixture insert denied'); await expect(form.getByLabel('Task', { exact: true })).toHaveValue('Keep this draft');
  await expect(view.locator('.task-row')).toHaveCount(2);
  await page.evaluate(() => window.__fail = null); await view.getByRole('button', { name: 'Reload This week' }).click();
  await expect(view.locator('.error')).not.toBeVisible(); await form.getByRole('button', { name: 'Add task' }).click();
  await expect(view.locator('.task-row')).toHaveCount(3);
  await view.getByRole('button', { name: 'Edit Keep this draft', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Task', { exact: true }).fill('Do not lose this edit');
  await page.evaluate(() => window.__fail = 'update'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor-error')).toContainText('Fixture update denied');
  await expect(page.getByRole('dialog').getByLabel('Task', { exact: true })).toHaveValue('Do not lose this edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await view.getByRole('button', { name: 'Delete Keep this draft', exact: true }).click();
  await page.evaluate(() => window.__fail = 'remove'); await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.locator('#editor-error')).toContainText('Fixture delete denied'); await expect(view.locator('.task-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await view.getByRole('button', { name: 'Rename This week', exact: true }).click(); await page.getByLabel('List title', { exact: true }).fill('Changed title');
  await page.evaluate(() => window.__fail = 'rename'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor-error')).toContainText('Fixture rename denied'); await expect(view.locator('h3')).toHaveText('This week');
  await page.evaluate(() => window.__fail = null); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(view.locator('h3')).toHaveText('Changed title');
});

test('refresh errors are visible and do not erase add-form drafts', async ({ page }) => {
  await card(page, 2).getByLabel('Task', { exact: true }).fill('Unsaved draft');
  await page.evaluate(() => window.__fail = 'lists'); await page.getByRole('button', { name: 'Refresh lists' }).click();
  await expect(page.locator('#global-error')).toContainText('Fixture connection unavailable');
  await expect(card(page, 2).getByLabel('Task', { exact: true })).toHaveValue('Unsaved draft');
  await page.evaluate(() => window.__fail = 'tasks'); await page.getByRole('button', { name: 'Refresh lists' }).click();
  await expect(card(page, 2).locator('.error')).toContainText('Fixture task loading denied');
  await expect(card(page, 2).locator('.task-row')).toHaveCount(2);
});

test('sorting control changes chronological versus urgency order', async ({ page }) => {
  const view = card(page, 4), form = view.locator('form');
  await form.getByLabel('Task', { exact: true }).fill('Dated task'); await form.getByLabel('Due date').fill('2027-01-01');
  await form.getByRole('button', { name: 'Add task' }).click(); await expect(view.locator('.task-row')).toHaveCount(3);
  await expect(view.locator('.task-content').first()).toHaveText('A notebook for the desk');
  await view.getByLabel('Sort Things to buy').selectOption('date'); await expect(view.locator('.task-content').first()).toHaveText('Dated task');
});

test('desktop and iPhone layouts retain all cards without horizontal overflow', async ({ page }, testInfo) => {
  const widths = testInfo.project.name.startsWith('iphone') ? [390, 320] : [1280, 1024];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const columns = await page.locator('.list-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(width > 700 ? 2 : 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('.list-card').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
  }
  if (testInfo.project.name.startsWith('iphone')) {
    expect(await card(page, 0).getByLabel('Task', { exact: true }).evaluate(node => getComputedStyle(node).fontSize)).toBe('16px');
    expect(await card(page, 0).locator('.task-row button').first().evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
});

test('PWA metadata loads and no private data is cached in a service worker or storage', async ({ page, request }) => {
  const response = await request.get('/todo.webmanifest'); expect(response.ok()).toBe(true);
  const manifest = await response.json(); expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get('/' + icon.src)).ok()).toBe(true);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icons/apple-touch-icon.png');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
