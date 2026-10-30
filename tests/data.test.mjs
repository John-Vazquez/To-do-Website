import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LISTS } from '../todo-config.js';
import { TaskStore, arrangeLists, createSupabaseRepository, dateInputValue, parseDate, sortTasks, validateTask } from '../todo-data.js';

const must = LISTS[1];
const task = (id, list_id = must.id, rest = {}) => ({ id, list_id, content: id, due_date: null, urgency: null, ...rest });
function fixture(initial = []) {
  let rows = structuredClone(initial), inserts = 0;
  const repo = {
    async tasks(id) { return structuredClone(rows.filter(row => row.list_id === id)); },
    async create(id, fields) { inserts++; await new Promise(resolve => setTimeout(resolve, 15)); const row = task(`new-${inserts}`, id, fields); rows.push(row); return structuredClone(row); },
    async update(original, fields) { const row = rows.find(row => row.id === original.id); Object.assign(row, fields); return structuredClone(row); },
    async remove(original) { rows = rows.filter(row => row.id !== original.id); return { id: original.id }; },
    async rename(id, title) { return { id, title }; }
  };
  return { repo, count: () => inserts };
}

test('all 14 legacy identifiers and original custom-list order remain supported; extra lists append', () => {
  const rows = LISTS.map((list, i) => ({ id: list.id, title: `Saved title ${i}` })).reverse();
  const arranged = arrangeLists([...rows, { id: 'extra', title: 'Extra' }]);
  assert.equal(new Set(LISTS.map(list => list.id)).size, 14);
  assert.deepEqual(arranged.slice(0, 14).map(list => list.id), LISTS.map(list => list.id));
  assert.equal(arranged[0].title, 'Doing Right Now'); assert.equal(arranged[1].title, 'Must Do Today');
  for (let i = 2; i < 14; i++) assert.equal(arranged[i].title, `Saved title ${i}`);
  assert.equal(arranged[14].title, 'Extra');
  assert.equal(arrangeLists([])[2].available, false);
});
test('tasks stay associated with the correct list during create, edit, delete, and rename', async () => {
  const { repo } = fixture(LISTS.map(list => task(list.key, list.id)));
  const store = new TaskStore(repo);
  for (const list of LISTS) { await store.load(list.id); assert.equal(store.tasks.get(list.id)[0].id, list.key); }
  const created = await store.create(LISTS[2], { content: 'New task', due_date: '2026-12-01', urgency: '3' });
  await store.update(created, { content: 'Edited' });
  assert.equal(store.tasks.get(LISTS[2].id).at(-1).content, 'Edited');
  await store.remove(created); assert.equal(store.tasks.get(LISTS[2].id).length, 1);
  const list = { ...LISTS[2] }; await store.rename(list, 'Groceries'); assert.equal(list.title, 'Groceries');
});
test('Must Do Today reserves pending creates and rechecks the server before inserting', async () => {
  const { repo, count } = fixture([task('one'), task('two')]); const store = new TaskStore(repo); await store.load(must.id);
  const first = store.create(must, { content: 'third' });
  await assert.rejects(store.create(must, { content: 'repeated click' }), /still saving/);
  await first; await assert.rejects(store.create(must, { content: 'fourth' }), /limited to 3/);
  assert.equal(count(), 1); assert.equal(store.pending.size, 0);
  // A different browser has filled the list since our last load.
  store.tasks.set(must.id, []);
  await assert.rejects(store.create(must, { content: 'stale count' }), /limited to 3/); assert.equal(count(), 1);
});
test('same-origin cross-tab locks serialize separate stores', async () => {
  const { repo, count } = fixture([task('one'), task('two')]); let chain = Promise.resolve();
  const lock = (_id, action) => { const next = chain.then(action); chain = next.catch(() => {}); return next; };
  const a = new TaskStore(repo, { lock }), b = new TaskStore(repo, { lock }); await a.load(must.id); await b.load(must.id);
  const results = await Promise.allSettled([a.create(must, { content: 'A' }), b.create(must, { content: 'B' })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(count(), 1);
});
test('unlimited lists retain all records; failure does not delete rows or claim success', async () => {
  const list = LISTS[0], { repo } = fixture(Array.from({ length: 1200 }, (_, i) => task(String(i), list.id)));
  const store = new TaskStore(repo); await store.load(list.id); await store.create(list, { content: 'More' }); assert.equal(store.tasks.get(list.id).length, 1201);
  const original = store.tasks.get(list.id)[0]; repo.remove = async () => { throw new Error('permission denied'); };
  await assert.rejects(store.remove(original), /permission denied/); assert.equal(store.tasks.get(list.id).length, 1201);
  repo.update = async () => null; await assert.rejects(store.update(original, { content: 'oops' }), /No matching/);
  assert.equal(store.tasks.get(list.id)[0].content, '0');
  const renamed = { ...list }; repo.rename = async () => { throw new Error('offline'); };
  await assert.rejects(store.rename(renamed, 'Changed'), /offline/); assert.equal(renamed.title, list.title);
});
test('uncertain insert failures block retries until a successful reconciliation read', async () => {
  const list = LISTS[2], { repo, count } = fixture(); const original = repo.create;
  const store = new TaskStore(repo); await store.load(list.id);
  repo.create = async () => { throw new Error('network lost'); };
  await assert.rejects(store.create(list, { content: 'draft' }), /check for the task/);
  await assert.rejects(store.create(list, { content: 'draft' }), /previous task/); assert.equal(count(), 0);
  await store.load(list.id); repo.create = original; await store.create(list, { content: 'draft' }); assert.equal(count(), 1);
});
test('urgency and chronological sorting handle nulls, invalid legacy values and year boundaries', () => {
  const rows = [task('undated'), task('jan', must.id, { due_date: '2027-01-01' }), task('high', must.id, { urgency: 3 }), task('dec', must.id, { due_date: '2026-12-31' }), task('invalid', must.id, { due_date: 'not a date' })];
  assert.deepEqual(sortTasks(rows).map(row => row.id), ['high', 'dec', 'jan', 'undated', 'invalid']);
  assert.deepEqual(sortTasks(rows, 'date').map(row => row.id), ['dec', 'jan', 'high', 'undated', 'invalid']);
  assert.equal(dateInputValue('2026-10-30'), '2026-10-30'); assert.equal(dateInputValue('1/2'), `${new Date().getFullYear()}-01-02`);
  assert.equal(parseDate('02/30'), null); assert.equal(parseDate('2026-02-29'), null);
  assert.equal(rows[0].id, 'undated');
});
test('validation rejects blank tasks, invalid dates and invalid urgency', () => {
  assert.throws(() => validateTask({ content: ' ' }), /Enter a task/);
  assert.throws(() => validateTask({ content: 'Task', due_date: '2026-02-30' }), /valid due/);
  assert.throws(() => validateTask({ content: 'Task', urgency: '4' }), /Urgency/);
  assert.deepEqual(validateTask({ content: ' Task ' }), { content: 'Task', urgency: null, due_date: null });
});

function fakeClient(respond) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      order(column) { call.order = column; return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      range(start, end) { call.range = [start, end]; return query; },
      insert(value) { call.operation = 'insert'; call.value = value; return query; },
      update(value) { call.operation = 'update'; call.value = value; return query; },
      delete() { call.operation = 'delete'; return query; },
      single() { call.single = true; return query; },
      then(resolve, reject) { return Promise.resolve(respond(call)).then(resolve, reject); }
    }; return query;
  } };
}
test('Supabase pagination loads every row and mutations verify returned rows with scoped filters', async () => {
  const client = fakeClient(call => call.operation ? { data: { id: 'id', list_id: 'list' }, error: null } : { data: Array.from({ length: call.range[0] === 0 ? 500 : 7 }, (_, i) => task(String(i), 'list')), error: null });
  const repo = createSupabaseRepository(client); assert.equal((await repo.tasks('list')).length, 507);
  assert.deepEqual(client.calls[1].range, [500, 999]);
  await repo.create('list', { content: 'New' }); await repo.update(task('id', 'list'), { content: 'Changed' }); await repo.remove(task('id', 'list')); await repo.rename('list', 'Title');
  for (const call of client.calls.slice(2)) assert.equal(call.single, true);
  assert.deepEqual(client.calls[3].filters, [['id', 'id'], ['list_id', 'list']]);
  assert.deepEqual(client.calls[4].filters, [['id', 'id'], ['list_id', 'list']]);
});
test('read-only live preview rejects every mutation before calling Supabase', async () => {
  const client = fakeClient(() => ({ data: [], error: null })), repo = createSupabaseRepository(client, { readOnly: true });
  await assert.rejects(repo.create('id', {}), /read-only/); await assert.rejects(repo.update(task('id'), {}), /read-only/);
  await assert.rejects(repo.remove(task('id')), /read-only/); await assert.rejects(repo.rename('id', 'new'), /read-only/); assert.equal(client.calls.length, 0);
});
test('Supabase errors propagate rather than yielding a false success', async () => {
  const repo = createSupabaseRepository(fakeClient(() => ({ data: null, error: { message: 'RLS denied' } })));
  await assert.rejects(repo.tasks('id'), /RLS denied/); await assert.rejects(repo.update(task('id'), {}), /RLS denied/);
});
test('PWA manifest and PNG icons are valid at their declared dimensions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../todo.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, './todo.html'); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, './');
  for (const icon of [...manifest.icons, { src: 'icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = await readFile(new URL('../' + icon.src, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
