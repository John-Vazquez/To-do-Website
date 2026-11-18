import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LISTS } from '../todo-config.js';
const source = await readFile(new URL('../todo-demo.js', import.meta.url), 'utf8');
const card = (page, index) => page.locator(`[data-list-id="${LISTS[index].id}"]`);
const editor = page => page.locator('#editor');
async function taskAction(page, label) {
 const target=page.getByRole('button',{name:label,exact:true});
 await target.locator('xpath=ancestor::li').hover(); await target.click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  let fixture = source;
  for (const method of ['lists','tasks','create','update','remove','rename','createList']) fixture=fixture.replace(new RegExp(`async ${method}\\(([^)]*)\\) \\{`),`async ${method}($1) { if (window.__fail === '${method}') throw new Error('Fixture ${method} denied');`);
  await page.route(/\/todo-demo\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:fixture}));
  await page.goto('/todo.html?demo'); await expect(page.locator('#connection-status')).toContainText('Demo ready');
});
test('compact overview stacks pinned lists and fits a bounded desktop canvas',async({page},info)=>{
 await expect(page.locator('.list-card')).toHaveCount(15); await expect(page.locator('#focus-lists .list-card')).toHaveCount(2);
 await expect(page.locator('#list-panel')).toHaveCount(0);
 await expect(page.locator('#focus-lists .list-card').nth(0)).toHaveAttribute('data-list-id',LISTS[0].id);
 await expect(page.locator('#focus-lists .list-card').nth(1)).toHaveAttribute('data-list-id',LISTS[1].id);
 const first=await card(page,0).boundingBox(), second=await card(page,1).boundingBox();
 expect(second.y).toBeGreaterThanOrEqual(first.y+first.height); expect(second.width).toBe(first.width);
 await expect(card(page,0).locator('.inline-add')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(info.project.name==='desktop-chromium') { expect(await page.locator('main').evaluate(x=>x.getBoundingClientRect().width)).toBeLessThanOrEqual(1180); expect(await page.locator('#other-lists').evaluate(x=>getComputedStyle(x).gridTemplateColumns.split(' ').length)).toBe(3); }
});
test('task rows reveal edit and delete without a completion checkbox',async({page},info)=>{
 const row=card(page,2).locator('.task-row').filter({hasText:'Review weekly priorities'});
 await expect(row.locator('input[type=checkbox]')).toHaveCount(0);
 await expect(row.getByRole('button',{name:'Edit Review weekly priorities'})).toBeVisible();
 await expect(row.getByRole('button',{name:'Delete Review weekly priorities'})).toBeVisible();
 if(info.project.name==='desktop-chromium') await expect(row.locator('.task-actions')).toHaveCSS('opacity','0');
 await row.hover(); await expect(row.locator('.task-actions')).toHaveCSS('opacity','1');
 await taskAction(page,'Edit Review weekly priorities'); await expect(editor(page).getByLabel('Task',{exact:true})).toHaveValue('Review weekly priorities');
});
test('deletion requires its own confirmation and list title opens rename only',async({page})=>{
 await page.getByRole('button',{name:'Rename This week'}).click(); await expect(editor(page).getByLabel('List title')).toHaveValue('This week'); await editor(page).getByRole('button',{name:'Cancel'}).click();
 await taskAction(page,'Delete Review weekly priorities');
 await expect(editor(page).locator('#delete-panel')).toBeVisible(); await editor(page).getByRole('button',{name:'Keep task'}).click();
 await expect(card(page,2).getByText('Review weekly priorities')).toBeVisible();
 await taskAction(page,'Delete Review weekly priorities'); await editor(page).getByRole('button',{name:'Delete permanently'}).click();
 await expect(card(page,2).getByText('Review weekly priorities')).toHaveCount(0);
});
test('plus button adds a task and more expands the card inline',async({page})=>{
 await card(page,3).getByRole('button',{name:'+19 more'}).click(); await expect(card(page,3).locator('.task-row')).toHaveCount(24);
 await card(page,2).getByRole('button',{name:'Add task to This week'}).click(); await editor(page).getByLabel('Task',{exact:true}).fill('Added from card'); await editor(page).getByRole('button',{name:'Save'}).click(); await expect(card(page,2).getByText('Added from card')).toBeVisible();
});
test('edited tasks save and failed saves leave the editor open',async({page})=>{
 const row=card(page,2).locator('.task-row').filter({hasText:'Review weekly priorities'}); await taskAction(page,'Edit Review weekly priorities'); await editor(page).getByLabel('Task',{exact:true}).fill('Edited title'); await editor(page).getByRole('button',{name:'Save'}).click(); await expect(card(page,2).getByText('Edited title')).toBeVisible();
 await page.evaluate(()=>window.__fail='create'); await card(page,2).getByRole('button',{name:'Add task to This week'}).click(); await editor(page).getByLabel('Task',{exact:true}).fill('Keep this draft'); await editor(page).getByRole('button',{name:'Save'}).click(); await expect(page.locator('#editor-error')).toContainText('Fixture create denied'); await expect(editor(page).getByLabel('Task',{exact:true})).toHaveValue('Keep this draft');
});

test('categories and scheduled lists can be managed from the page', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add Category' }).click();
  await editor(page).getByLabel('Category name').fill('Home');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Rename category Home' }).click();
  await editor(page).getByLabel('Category name').fill('Household');
  await editor(page).getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Add list to Household' }).click();
  await editor(page).getByLabel('List title').fill('Visits');
  await expect(editor(page).getByLabel('Category').locator('option:checked')).toHaveText('Household');
  await editor(page).getByLabel('List type').selectOption('schedule');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  for (const [title, time] of [['Afternoon visit', '15:00'], ['Morning visit', '09:00']]) {
    await page.getByRole('button', { name: 'Add event to Household · Visits' }).click();
    await editor(page).getByLabel('Event', { exact: true }).fill(title);
    await expect(editor(page).getByLabel('Date', { exact: true })).toHaveJSProperty('required', true);
    await editor(page).getByLabel('Date', { exact: true }).fill('2099-06-16');
    await editor(page).getByLabel('Time (optional)').fill(time);
    await editor(page).getByRole('button', { name: 'Save' }).click();
    await expect(editor(page)).not.toBeVisible();
  }
  await expect(page.locator('#categories .schedule-card').filter({ hasText: 'Visits' }).locator('.task-title'))
    .toHaveText(['Morning visit', 'Afternoon visit']);

  await page.getByRole('button', { name: 'Rename Visits' }).click();
  await editor(page).getByLabel('List title').fill('House visits');
  await editor(page).getByLabel('Category').selectOption('');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#other-lists').getByRole('button', { name: 'Rename House visits' })).toBeVisible();
  await expect(page.locator('#other-lists').getByText('Morning visit')).toBeVisible();
});

test('pinning and completion use the original task in both views', async ({ page }) => {
  const task = 'Review weekly priorities';
  await taskAction(page, `Edit ${task}`);
  await editor(page).getByLabel('Pin to focus list').selectOption('must');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  const original = card(page, 2).locator('.task-row').filter({ hasText: task });
  const pinned = card(page, 1).locator('.task-row').filter({ hasText: task });
  await expect(pinned).toBeVisible();
  await expect(pinned).toHaveAttribute('data-task-id', await original.getAttribute('data-task-id'));
  await pinned.getByRole('button', { name: `Edit ${task}` }).click();
  await editor(page).getByLabel('Completed').check();
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(original).toHaveCount(0);
  await expect(pinned).toHaveCount(0);
});
