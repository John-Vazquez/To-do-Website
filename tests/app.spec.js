import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { LISTS } from '../todo-config.js';
const card = (page, index) => page.locator(`[data-list-id="${LISTS[index].id}"]`);
const dialog = page => page.locator('#editor');
const source = await readFile(new URL('../todo-demo.js', import.meta.url), 'utf8');
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let fixture = source;
  for (const method of ['lists', 'tasks', 'create', 'update', 'remove', 'rename', 'createList']) fixture = fixture.replace(new RegExp(`async ${method}\\(([^)]*)\\) \\{`), `async ${method}($1) { if (window.__fail === '${method}') throw new Error('Fixture ${method} denied');`);
  await page.route('**/todo-demo.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
  await page.goto('/todo.html?demo'); await expect(page.locator('#connection-status')).toContainText('Demo ready');
});
async function quickAdd(page, title, index = 2) {
  await page.locator('#quick-add').click(); await dialog(page).getByLabel('Task', { exact: true }).fill(title); await dialog(page).getByLabel('List', { exact: true }).selectOption(LISTS[index].id); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog(page)).not.toBeVisible();
}
test('all legacy lists, dense layout and compact/expanded persistence', async ({ page }, info) => {
  await expect(page.locator('.list-card')).toHaveCount(14);
  for (let i = 0; i < 14; i++) await expect(card(page, i)).toHaveCount(1);
  await expect(card(page, 3).locator('.task-row')).toHaveCount(5); await expect(card(page, 3).getByRole('button', { name: '+19 more', exact: true })).toBeVisible();
  await expect(card(page, 10).locator('input')).toHaveCount(0);
  const pinned = await page.locator('.pinned').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, left: node.getBoundingClientRect().left })));
  if (info.project.name === 'desktop-chromium') {
    expect(pinned[0].top).toBe(pinned[1].top);
    expect(await page.locator('#other-lists .list-card').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().bottom < 900).length)).toBeGreaterThanOrEqual(6);
    expect(await page.locator('.list-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(3);
  }
  await page.locator('#expanded').click(); await expect(card(page, 3).locator('.task-row')).toHaveCount(24);
  await page.reload(); await expect(page.locator('#connection-status')).toContainText('Demo ready'); await expect(page.locator('#expanded')).toHaveAttribute('aria-pressed', 'true'); await expect(card(page, 3).locator('.task-row')).toHaveCount(24);
});
test('Quick Add remembers destination; task details preserve metadata and move identity', async ({ page }) => {
  await quickAdd(page, 'Unique quick task', 2);
  const id = await card(page, 2).locator('.task-row').filter({ hasText: 'Unique quick task' }).getAttribute('data-task-id');
  await card(page, 2).getByRole('button', { name: 'Unique quick task', exact: true }).click();
  await dialog(page).getByLabel('Deadline').fill('2027-01-12'); await dialog(page).getByLabel('Urgency').selectOption('3'); await dialog(page).getByLabel('List', { exact: true }).selectOption(LISTS[0].id); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page, 2).getByText('Unique quick task', { exact: true })).toHaveCount(0);
  const row = card(page, 0).locator(`[data-task-id="${id}"]`); await expect(row).toContainText('U3'); await expect(row).toContainText('Jan 12');
  await page.locator('#quick-add').click(); await expect(dialog(page).getByLabel('List', { exact: true })).toHaveValue(LISTS[2].id); await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
});
test('full list opens all tasks, supports bulk add, editing, discard and explicit deletion', async ({ page }) => {
  await card(page, 3).getByRole('button', { name: 'Open Work & projects', exact: true }).click();
  await expect(page.locator('#list-panel .task-row')).toHaveCount(24);
  await page.locator('#list-bulk').click(); await dialog(page).getByLabel('Tasks', { exact: true }).fill('Bulk one\nBulk two\n\nBulk three'); await dialog(page).getByRole('button', { name: 'Add tasks', exact: true }).click();
  await expect(page.locator('#list-panel .task-row')).toHaveCount(27);
  await page.locator('#list-panel').getByRole('button', { name: 'Bulk one', exact: true }).click(); await dialog(page).getByLabel('Task', { exact: true }).fill('Unsaved edit'); await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.locator('#discard-panel')).toBeVisible(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('#list-panel').getByRole('button', { name: 'Unsaved edit', exact: true }).click(); await page.locator('#delete-task').click(); await expect(page.locator('#delete-panel')).toBeVisible(); await page.locator('#confirm-delete').click(); await expect(page.locator('#list-panel').getByRole('button', { name: 'Unsaved edit', exact: true })).toHaveCount(0);
});
test('overview completion, Undo, completed visibility and reopening are non-destructive', async ({ page }) => {
  const title = 'Review weekly priorities';
  await card(page, 2).getByRole('checkbox', { name: `Complete ${title}`, exact: true }).check();
  await expect(card(page, 2).getByText(title, { exact: true })).toHaveCount(0); await expect(page.locator('#undo')).toBeVisible(); await page.locator('#undo').click(); await expect(card(page, 2).getByRole('button', { name: title, exact: true })).toBeVisible();
  await card(page, 2).getByRole('checkbox', { name: `Complete ${title}`, exact: true }).check(); await card(page, 2).getByRole('button', { name: 'Open This week', exact: true }).click(); await page.locator('#show-completed').check();
  await expect(page.locator('#list-panel').getByRole('checkbox', { name: `Reopen ${title}`, exact: true })).toBeVisible(); await page.locator('#list-panel').getByRole('checkbox', { name: `Reopen ${title}`, exact: true }).uncheck(); await expect(page.locator('#list-panel').getByRole('checkbox', { name: `Complete ${title}`, exact: true })).toBeVisible();
});
test('search spans lists, opens matching task and includes completed only on request', async ({ page }) => {
  await page.locator('#search').fill('prescription'); await expect(page.locator('#search-results')).toContainText('Must Do Today'); await page.locator('#search-results .result').click(); await expect(dialog(page).getByLabel('Task', { exact: true })).toHaveValue('Pick up the prescription'); await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click(); await page.locator('#close-list').click();
  await page.locator('#search').fill('Completed sample task'); await expect(page.locator('#search-results')).toHaveText('No matches.'); await page.locator('#search-completed').check(); await expect(page.locator('#search-results')).toContainText('Completed sample task');
});
test('Must Do Today guards duplicate submissions, moves, reopening and partial bulk', async ({ page }) => {
  const form = card(page, 1).locator('form'); await form.locator('input').fill('Third priority');
  await form.evaluate(node => { node.dispatchEvent(new Event('submit', { cancelable: true })); node.dispatchEvent(new Event('submit', { cancelable: true })); }); await expect(card(page, 1).locator('.task-row')).toHaveCount(3);
  await quickAdd(page, 'Move candidate', 2); await card(page, 2).getByRole('button', { name: 'Move candidate', exact: true }).click(); await dialog(page).getByLabel('List', { exact: true }).selectOption(LISTS[1].id); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#editor-error')).toContainText('3 active tasks'); await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await card(page, 1).getByRole('checkbox', { name: 'Complete Third priority', exact: true }).check(); await expect(card(page, 1).locator('.task-row')).toHaveCount(2);
  await card(page, 1).getByRole('button', { name: 'Open Must Do Today', exact: true }).click(); await page.locator('#list-bulk').click(); await dialog(page).getByLabel('Tasks', { exact: true }).fill('Bulk fits\nBulk overflows'); await dialog(page).getByRole('button', { name: 'Add tasks', exact: true }).click(); await expect(page.locator('#editor-error')).toContainText('1 tasks saved'); await expect(dialog(page).getByLabel('Tasks', { exact: true })).toHaveValue('Bulk overflows');
});
test('Upcoming groups dated tasks and links to original task/list', async ({ page }) => {
  await page.locator('#upcoming').click(); const body = page.locator('#collection-body');
  for (const group of ['Overdue', 'Today', 'Next 7 days', 'Later']) await expect(body.getByRole('heading', { name: new RegExp(`^${group}`) })).toBeVisible();
  await expect(body).toContainText('Work & projects'); await body.locator('.result').filter({ hasText: 'Pick up the prescription' }).click(); await expect(dialog(page).getByLabel('Task', { exact: true })).toHaveValue('Pick up the prescription');
});
test('list creation, rename, reorder, archive, restore and pinned protections work', async ({ page }) => {
  await page.locator('#add-list').click(); await dialog(page).getByLabel('List title').fill('New custom list'); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Open New custom list', exact: true }).click(); await page.locator('#rename-list').click(); await dialog(page).getByLabel('List title').fill('Renamed list'); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#list-panel-title')).toHaveText('Renamed list'); await page.locator('#close-list').click();
  await page.locator('summary').click(); await page.locator('#manage-lists').click();
  await expect(page.getByRole('button', { name: 'Archive Doing Right Now', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Move up Work & projects', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Renamed list', exact: true }).click(); await expect(page.getByRole('button', { name: 'Open Renamed list', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Restore Renamed list', exact: true }).click(); await expect(page.locator('#other-lists').getByRole('button', { name: 'Open Renamed list', exact: true })).toHaveCount(1); await page.locator('#close-collection').click();
  await expect(page.locator('#other-lists .list-card').first()).toHaveAttribute('data-list-id', LISTS[3].id);
});
test('failed inserts, updates and deletes preserve drafts and records; refresh reconciles', async ({ page }) => {
  await page.evaluate(() => window.__fail = 'create'); await page.locator('#quick-add').click(); await dialog(page).getByLabel('Task', { exact: true }).fill('Keep draft'); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#editor-error')).toContainText('Fixture create denied'); await expect(dialog(page).getByLabel('Task', { exact: true })).toHaveValue('Keep draft'); await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.evaluate(() => window.__fail = null); await page.locator('summary').click(); await page.locator('#refresh').click(); await expect(page.locator('#quick-add')).toBeEnabled();
  await card(page, 0).getByRole('button', { name: 'Finish the application update', exact: true }).click(); await dialog(page).getByLabel('Task', { exact: true }).fill('Keep edits'); await page.evaluate(() => window.__fail = 'update'); await dialog(page).getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('#editor-error')).toContainText('Fixture update denied'); await expect(dialog(page).getByLabel('Task', { exact: true })).toHaveValue('Keep edits');
  await page.evaluate(() => window.__fail = 'remove'); await page.locator('#delete-task').click(); await page.locator('#confirm-delete').click(); await expect(page.locator('#editor-error')).toContainText('Fixture remove denied'); await expect(card(page, 0).getByRole('button', { name: 'Finish the application update', exact: true })).toHaveCount(1);
});
test('responsive editor, long names, PWA and screenshots meet review requirements', async ({ page }, info) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.list-card').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
  const mobile = info.project.name === 'iphone-webkit', desktop = info.project.name === 'desktop-chromium';
  const directory = new URL('../docs/screenshots/', import.meta.url); await mkdir(directory, { recursive: true });
  if (desktop || mobile) await page.screenshot({ path: new URL(mobile ? 'mobile-overview.png' : 'desktop-compact.png', directory).pathname.replace(/^\/(\w:)/, '$1') });
  if (desktop) { await page.locator('#expanded').click(); await page.screenshot({ path: new URL('desktop-expanded.png', directory).pathname.replace(/^\/(\w:)/, '$1') }); }
  await card(page, 3).getByRole('button', { name: 'Open Work & projects', exact: true }).click(); await expect(page.locator('#list-panel .task-row')).toHaveCount(24);
  if (mobile) { const box = await page.locator('#list-panel').boundingBox(); expect(box.width).toBe(390); expect(box.x).toBe(0); }
  if (desktop || mobile) await page.screenshot({ path: new URL(mobile ? 'mobile-list-editor.png' : 'desktop-list-editor.png', directory).pathname.replace(/^\/(\w:)/, '$1') });
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', 'todo.webmanifest'); expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
