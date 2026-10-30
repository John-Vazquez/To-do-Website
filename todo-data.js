import { LISTS } from './todo-config.js?v=20261030-3';

export function parseDate(value, year = new Date().getFullYear()) {
  if (!value) return null;
  const text = String(value).trim();
  const short = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (short || iso) {
    const [y, m, d] = short ? [year, +short[1], +short[2]] : [+iso[1], +iso[2], +iso[3]];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  const date = new Date(text); // Read legacy free-form dates without rewriting them.
  return Number.isNaN(+date) ? null : date;
}

export function dateInputValue(raw) {
  const date = parseDate(raw);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}

export function sortTasks(tasks, mode = 'priority') {
  const due = task => +(parseDate(task.due_date) || Infinity);
  const urgency = task => Number(task.urgency) || 0;
  return [...tasks].sort((a, b) => {
    const dates = due(a) === due(b) ? 0 : due(a) < due(b) ? -1 : 1;
    return (mode === 'date' ? dates || urgency(b) - urgency(a) : urgency(b) - urgency(a) || dates);
  });
}

export function validateTask(fields) {
  const content = fields.content.trim();
  if (!content) throw new Error('Enter a task before saving.');
  const urgency = fields.urgency === '' || fields.urgency == null ? null : Number(fields.urgency);
  if (urgency !== null && ![1, 2, 3].includes(urgency)) throw new Error('Urgency must be 1, 2, or 3.');
  const due_date = fields.due_date || null;
  if (due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(due_date) || !parseDate(due_date))) throw new Error('Choose a valid due date.');
  return { content, due_date, urgency };
}

async function checked(query) {
  const result = await query;
  if (result.error) throw new Error(result.error.message || 'Supabase rejected the request.');
  return result.data;
}

export function createSupabaseRepository(client, { readOnly = false } = {}) {
  function writable() {
    if (readOnly) throw new Error('Live preview is read-only. Use the demo to try changes.');
  }
  async function pages(makeQuery) {
    const rows = [];
    for (let start = 0; ; start += 500) {
      const page = await checked(makeQuery().range(start, start + 499));
      if (!Array.isArray(page)) throw new Error('Supabase returned an invalid list response.');
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  return {
    lists: () => pages(() => client.from('lists').select('id,title,is_archived,sort_order').order('sort_order', { nullsFirst: false }).order('id')),
    tasks: listId => pages(() => client.from('tasks').select('*').eq('list_id', listId).order('id')),
    async create(listId, fields) {
      writable();
      return checked(client.from('tasks').insert([{ list_id: listId, ...fields }]).select('*').single());
    },
    async update(task, fields) {
      writable();
      return checked(client.from('tasks').update(fields).eq('id', task.id).eq('list_id', task.list_id).select('*').single());
    },
    async remove(task) {
      writable();
      return checked(client.from('tasks').delete().eq('id', task.id).eq('list_id', task.list_id).select('id').single());
    },
    async rename(listId, title) {
      writable();
      return checked(client.from('lists').update({ title }).eq('id', listId).select('id,title,is_archived,sort_order').single());
    },
    async createList(id, title) {
      writable();
      return checked(client.from('lists').insert([{ id, title }]).select('id,title,is_archived,sort_order').single());
    },
    async saveListMetadata(rows) {
      writable();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const saved=await checked(client.from('lists').update({ is_archived: !!row.archived, sort_order: row.fixed ? null : i }).eq('id', row.id).select('id').single());
        if (saved.id !== row.id) throw new Error('Supabase returned a different list after saving metadata.');
      }
    },
    async saveListOrder(rows) {
      writable();
      for (let i=0;i<rows.length;i++) { const saved=await checked(client.from('lists').update({ sort_order:i }).eq('id',rows[i].id).select('id').single()); if (saved.id!==rows[i].id) throw new Error('Supabase returned a different list after saving order.'); }
    },
    async saveListArchive(row, archived) {
      writable();
      const saved=await checked(client.from('lists').update({ is_archived:!!archived }).eq('id',row.id).select('id').single());
      if (saved.id!==row.id) throw new Error('Supabase returned a different list after saving archive state.');
      return saved;
    }
  };
}

export function arrangeLists(rows) {
  const existing = new Map(rows.map(row => [row.id, row]));
  const known = LISTS.map(list => ({ ...list, title: list.fixed ? list.title : existing.get(list.id)?.title ?? list.title, archived: !list.fixed && existing.get(list.id)?.is_archived === true, sort_order: existing.get(list.id)?.sort_order, syncedMetadata: Object.hasOwn(existing.get(list.id) || {}, 'is_archived'), available: existing.has(list.id) }));
  const ids = new Set(LISTS.map(list => list.id));
  const extra = rows.filter(row => !ids.has(row.id)).sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || String(a.id).localeCompare(String(b.id))).map(row => ({ ...row, key: row.id, archived: row.is_archived === true, syncedMetadata:Object.hasOwn(row,'is_archived'), available: true }));
  return [...known, ...extra];
}

// Shared operations are independent of the DOM and any future AI provider.
export class TaskStore {
  constructor(repository, { lock = async (_id, action) => action() } = {}) {
    this.repository = repository;
    this.lock = lock;
    this.tasks = new Map();
    this.pending = new Set();
    this.uncertainCreates = new Set();
  }
  async load(listId) {
    const tasks = await this.repository.tasks(listId);
    this.tasks.set(listId, tasks);
    this.uncertainCreates.delete(listId);
    return tasks;
  }
  async exclusive(listId, action) { return this.exclusiveMany([listId], action); }
  async exclusiveMany(listIds, action) {
    const ids = [...new Set(listIds)].sort();
    if (ids.some(id => this.pending.has(id))) throw new Error('A change to this list is still saving. Please wait.');
    ids.forEach(id => this.pending.add(id));
    const acquire = index => index === ids.length ? action() : this.lock(ids[index], () => acquire(index + 1));
    try { return await acquire(0); }
    finally { ids.forEach(id => this.pending.delete(id)); }
  }
  async create(list, fields) {
    const valid = validateTask(fields);
    if (!this.tasks.has(list.id)) throw new Error('Load this list before adding a task.');
    if (this.uncertainCreates.has(list.id)) throw new Error('Reload this list and check whether the previous task was saved before trying again.');
    return this.exclusive(list.id, async () => {
      if (list.limit) {
        // Refresh under the browser's cross-tab lock before counting.
        const latest = await this.repository.tasks(list.id);
        this.tasks.set(list.id, latest);
        if (activeTasks(latest).length >= list.limit) throw new Error('Must Do Today is limited to 3 active tasks. Complete or move one first.');
      }
      let task;
      try {
        task = await this.repository.create(list.id, valid);
        if (!task?.id || task.list_id !== list.id) throw new Error('The saved task could not be confirmed.');
      } catch (error) {
        // No automatic INSERT retries: the server may have committed before a
        // response was lost. Reconcile by reading before another attempt.
        this.uncertainCreates.add(list.id);
        throw new Error(`${error.message} Reload the list and check for the task before retrying.`);
      }
      this.tasks.set(list.id, [...this.tasks.get(list.id), task]);
      return task;
    });
  }
  async update(task, fields) {
    if ('list_id' in fields || 'is_done' in fields) throw new Error('Use changeTask for moves or completion so capacity is checked.');
    return this.exclusive(task.list_id, async () => {
      const saved = await this.repository.update(task, fields);
      if (saved?.id !== task.id || saved.list_id !== task.list_id) throw new Error('No matching task was saved. Reload and try again.');
      this.tasks.set(task.list_id, this.tasks.get(task.list_id).map(row => row.id === task.id ? saved : row));
      return saved;
    });
  }
  async remove(task) {
    return this.exclusive(task.list_id, async () => {
      const saved = await this.repository.remove(task);
      if (saved?.id !== task.id) throw new Error('No matching task was removed. Reload and try again.');
      this.tasks.set(task.list_id, this.tasks.get(task.list_id).filter(row => row.id !== task.id));
    });
  }
  async rename(list, title) {
    if (!title.trim()) throw new Error('Enter a list title.');
    return this.exclusive(list.id, async () => {
      const saved = await this.repository.rename(list.id, title.trim());
      if (saved?.id !== list.id || saved.title !== title.trim()) throw new Error('The new title could not be confirmed.');
      list.title = saved.title;
    });
  }
  async changeTask(task, fields, destination) {
    if (!destination?.available || destination.archived) throw new Error('Choose an available, unarchived destination list.');
    if (!this.tasks.has(destination.id)) throw new Error('Load the destination list before moving a task.');
    return this.exclusiveMany([task.list_id, destination.id], async () => {
      const becomingActive = (fields.is_done ?? task.is_done) !== true;
      if (destination.limit && becomingActive && (task.list_id !== destination.id || task.is_done === true)) {
        const latest = await this.repository.tasks(destination.id);
        this.tasks.set(destination.id, latest);
        if (activeTasks(latest).filter(row => row.id !== task.id).length >= destination.limit) throw new Error('Must Do Today is limited to 3 active tasks. Complete or move one first.');
      }
      const patch = { ...fields, ...(destination.id !== task.list_id ? { list_id: destination.id } : {}) };
      const saved = await this.repository.update(task, patch);
      if (saved?.id !== task.id || saved.list_id !== destination.id) throw new Error('No matching task was saved. Reload and try again.');
      this.tasks.set(task.list_id, this.tasks.get(task.list_id).filter(row => row.id !== task.id));
      this.tasks.set(destination.id, [...this.tasks.get(destination.id), saved]);
      return saved;
    });
  }
  async setDone(task, done, list) { return this.changeTask(task, { is_done: Boolean(done) }, list); }
  async bulkCreate(list, text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Enter one task per line.');
    const completed = [];
    // Sequential creates honor capacity and pending reservations. Successful lines
    // are reported so a partial failure cannot reinsert them on retry.
    for (let index = 0; index < lines.length; index++) {
      try { completed.push(await this.create(list, { content: lines[index] })); }
      catch (error) { error.remaining = lines.slice(index).join('\n'); error.savedCount = completed.length; throw error; }
    }
    return completed;
  }
  async createList(id, title) {
    if (!title.trim()) throw new Error('Enter a list title.');
    return this.exclusive('__lists__', async () => {
      const saved = await this.repository.createList(id, title.trim());
      if (saved?.id !== id || saved.title !== title.trim()) throw new Error('List creation could not be confirmed. Refresh before retrying.');
      this.tasks.set(id, []);
      return { ...saved, key: id, available: true };
    });
  }
}

export const activeTasks = tasks => tasks.filter(task => task.is_done !== true);
export function upcomingTasks(lists, tasks, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(today); week.setDate(week.getDate() + 7);
  const groups = { Overdue: [], Today: [], 'Next 7 days': [], Later: [] };
  for (const list of lists.filter(list => !list.archived)) {
    for (const task of sortTasks(activeTasks(tasks.get(list.id) || []), 'date')) {
      const date = parseDate(task.due_date); if (!date) continue;
      const group = date < today ? 'Overdue' : +date === +today ? 'Today' : date <= week ? 'Next 7 days' : 'Later';
      groups[group].push({ list, task });
    }
  }
  for (const rows of Object.values(groups)) rows.sort((a, b) => +parseDate(a.task.due_date) - +parseDate(b.task.due_date));
  return groups;
}
export function searchTasks(lists, tasks, query, includeDone = false) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return lists.flatMap(list => {
    const listMatch = list.title.toLocaleLowerCase().includes(term);
    const matches = (tasks.get(list.id) || []).filter(task => (includeDone || task.is_done !== true) && (listMatch || String(task.content).toLocaleLowerCase().includes(term)));
    return [...(listMatch ? [{ list, task: null }] : []), ...matches.map(task => ({ list, task }))];
  });
}

// Preferences contain IDs and UI settings only, never private task text.
export class Preferences {
  constructor(storage) {
    this.storage = storage;
    try { const value = JSON.parse(storage?.getItem('todo.preferences.v2') || '{}'); this.value = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { this.value = {}; }
  }
  set(key, value) {
    this.value[key] = value;
    try { this.storage?.setItem('todo.preferences.v2', JSON.stringify(this.value)); return true; } catch { return false; }
  }
  arrange(lists) {
    const order = Array.isArray(this.value.order) ? this.value.order : [];
    const archived = Array.isArray(this.value.archived) ? this.value.archived : [];
    lists.forEach(list => { if (!list.syncedMetadata) list.archived = !list.fixed && archived.includes(list.id); });
    return lists.map((list, index) => ({ list, index })).sort((a, b) => {
      if (a.list.fixed || b.list.fixed) return Number(Boolean(b.list.fixed)) - Number(Boolean(a.list.fixed)) || a.index - b.index;
      const rank = item => item.list.syncedMetadata ? (item.list.sort_order ?? Infinity) : order.includes(item.list.id) ? order.indexOf(item.list.id) : order.length + item.index;
      return (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || a.index - b.index;
    }).map(item => item.list);
  }
  importBrowserListPreferences(lists) {
    const order = Array.isArray(this.value.order) ? this.value.order : [];
    const archived = new Set(Array.isArray(this.value.archived) ? this.value.archived : []);
    const ordered = lists.filter(x => !x.fixed).sort((a,b) => {
      const rank = id => order.includes(id) ? order.indexOf(id) : order.length + lists.indexOf(lists.find(x=>x.id===id));
      return rank(a.id)-rank(b.id);
    });
    ordered.forEach((list, i) => { list.sort_order=i; list.archived=archived.has(list.id); });
    return [...lists.filter(list => list.fixed), ...ordered];
  }
  archive(list, archived) {
    if (list.fixed) throw new Error('Pinned lists cannot be archived.');
    const ids = new Set(Array.isArray(this.value.archived) ? this.value.archived : []);
    archived ? ids.add(list.id) : ids.delete(list.id);
    const persisted = this.set('archived', [...ids]); list.archived = archived; return persisted;
  }
}
