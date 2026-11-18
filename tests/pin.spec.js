import { test, expect } from '@playwright/test';
const token = 'a'.repeat(64);
test('direct live navigation gates data, rejects wrong PIN, unlocks, and locks', async ({page}) => {
  const requests = [];
  await page.route('https://walsvybskelqhgvpdagj.supabase.co/**',async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const respond = (value,status=200) => route.fulfill({status,json:value});
    if (body.action === 'unlock') return body.pin === '0123' ? respond({token,expiresAt:new Date(Date.now()+3600000).toISOString()}) : respond({error:'Incorrect PIN.'},401);
    if(body.action === 'lock') return respond({locked:true});
    if(body.action === 'data') { expect(route.request().headers().authorization).toBe(`Bearer ${token}`); return respond({data:[]}); }
    return respond({error:'Expired'},401);
  });
  await page.goto('/todo.html?source=live');
  await expect(page.locator('#pin-gate')).toBeVisible(); await expect(page.locator('#main')).toBeHidden();
  expect(requests).toHaveLength(0);
  await page.locator('#pin-input').fill('9999'); await page.locator('#pin-submit').click();
  await expect(page.locator('#pin-error')).toHaveText('Incorrect PIN.');
  expect(requests.filter(r=>r.action==='data')).toHaveLength(0);
  await page.locator('#pin-input').fill('0123'); await page.locator('#pin-submit').click();
  await expect(page.locator('#main')).toBeVisible(); await expect(page.locator('#connection-status')).toContainText('read only');
  await page.locator('.menu summary').click(); await page.locator('#pin-lock').click();
  await expect(page.locator('#pin-gate')).toBeVisible(); await expect(page.locator('#main')).toBeHidden();
  expect(await page.evaluate(()=>sessionStorage.getItem('todo-pin-session'))).toBeNull();
});
test('expired saved sessions return to the gate without fetching task data',async ({page})=>{
  await page.addInitScript(token=>sessionStorage.setItem('todo-pin-session',token),token);
  const actions=[];
  await page.route('https://walsvybskelqhgvpdagj.supabase.co/**',route=>{actions.push(route.request().postDataJSON().action);return route.fulfill({status:401,json:{error:'Expired'}});});
  await page.goto('/todo.html?source=live');
  await expect(page.locator('#pin-error')).toContainText('expired');
  await expect(page.locator('#main')).toBeHidden(); expect(actions).toEqual(['session']);
});
