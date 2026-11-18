import { LISTS } from './todo-config.js?v=20261118-1';

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

export function normalizeTask(task) {
  if (!task) return task;
  return { ...task, ...(task.event_time ? { event_time: String(task.event_time).slice(0, 5) } : {}) };
}

export function isPastEvent(task, now = new Date()) {
  const date = parseDate(task.due_date);
  if (!date) return false;
  if (task.event_time) {
    const [hour, minute] = String(task.event_time).split(':').map(Number);
    date.setHours(hour, minute, 0, 0);
    return date < now;
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date < today;
}

export function compareTaskDates(a, b) {
  const date = task => +(parseDate(task.due_date) || Infinity);
  const first = date(a), second = date(b);
  const dates = first === second ? 0 : first < second ? -1 : 1;
  return dates || String(a.event_time || '99:99').localeCompare(String(b.event_time || '99:99'));
}

export function sortTasks(tasks, mode = 'priority') {
  const urgency = task => Number(task.urgency) || 0;
  return [...tasks].sort((a, b) => {
    const dates = compareTaskDates(a, b);
    return (['date', 'schedule'].includes(mode) ? dates || urgency(b) - urgency(a) : urgency(b) - urgency(a) || dates);
  });
}

export function validateTask(fields, list = {}) {
  const content = fields.content.trim();
  if (!content) throw new Error('Enter a task before saving.');
  const urgency = fields.urgency === '' || fields.urgency == null ? null : Number(fields.urgency);
  if (urgency !== null && ![1, 2, 3].includes(urgency)) throw new Error('Urgency must be 1, 2, or 3.');
  const due_date = fields.due_date || null;
  if (due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(due_date) || !parseDate(due_date))) throw new Error('Choose a valid due date.');
  const result = { content, due_date, urgency };
  if (list.kind === 'schedule' && fields.focus_list) throw new Error('Only To-Do tasks can be pinned to a priority list.');
  if (list.kind === 'schedule' && !due_date) throw new Error('Choose a date for this scheduled event.');
  if ('event_time' in fields) {
    const time = fields.event_time ? String(fields.event_time) : null;
    if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(time)) throw new Error('Choose a valid event time.');
    if (time && !due_date) throw new Error('Choose a date before adding a time.');
    result.event_time = list.kind === 'todo' ? null : time?.slice(0, 5) || null;
  }
  if ('focus_list' in fields) {
    if (fields.focus_list != null && fields.focus_list !== '' && !['doing', 'must'].includes(fields.focus_list)) throw new Error('Choose a valid priority list.');
    result.focus_list = fields.focus_list || null;
  }
  return result;
}

function validateTaskPatch(task, fields, list = {}) {
  const input = { ...task, ...fields };
  if (!('due_date' in fields)) input.due_date = dateInputValue(task.due_date) || null;
  const valid = validateTask(input, list);
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, key in valid ? valid[key] : value]));
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
  const listColumns = 'id,title,is_archived,sort_order,category_id,kind';
  return {
    categories: () => pages(() => client.from('categories').select('id,title').order('title').order('id')),
    async createCategory(title) { writable(); return checked(client.from('categories').insert([{ title: validTitle(title, 'category') }]).select('id,title').single()); },
    async renameCategory(id, title) { writable(); return checked(client.from('categories').update({ title: validTitle(title, 'category') }).eq('id', id).select('id,title').single()); },
    async focusTasks(focus) { return activeTasks(await pages(() => client.from('tasks').select('*').eq('focus_list', focus).order('id'))); },
    lists: () => pages(() => client.from('lists').select(listColumns).order('sort_order', { nullsFirst: false }).order('id')),
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
      return checked(client.from('lists').update({ title }).eq('id', listId).select(listColumns).single());
    },
    async createList(id, title, options = {}) {
      writable();
      if (typeof title !== 'string') { options = title || {}; title = id; id = crypto.randomUUID(); }
      const fields = validListFields({ title, category_id: options.category_id ?? null, kind: options.kind || 'todo' });
      return checked(client.from('lists').insert([{ id, ...fields }]).select(listColumns).single());
    },
    async updateList(id, fields) {
      writable();
      return checked(client.from('lists').update(validListFields(fields)).eq('id', id).select(listColumns).single());
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

function validTitle(title, type = 'list') {
  if (typeof title !== 'string' || !title.trim()) throw new Error(`Enter a ${type} title.`);
  return title.trim();
}

function validListFields(fields) {
  const result = {};
  if ('title' in fields) result.title = validTitle(fields.title);
  if ('category_id' in fields) result.category_id = fields.category_id || null;
  if ('kind' in fields) {
    if (!['todo', 'schedule'].includes(fields.kind)) throw new Error('Choose To-Do or Schedule for the list type.');
    result.kind = fields.kind;
  }
  return result;
}

export function arrangeLists(rows) {
  const existing = new Map(rows.map(row => [row.id, row]));
  const known = LISTS.map(list => ({ ...list, category_id: list.fixed ? null : existing.get(list.id)?.category_id ?? null, kind: list.fixed ? 'todo' : existing.get(list.id)?.kind || 'todo', title: list.fixed ? list.title : existing.get(list.id)?.title ?? list.title, archived: !list.fixed && existing.get(list.id)?.is_archived === true, sort_order: existing.get(list.id)?.sort_order, syncedMetadata: Object.hasOwn(existing.get(list.id) || {}, 'is_archived'), available: existing.has(list.id) }));
  const ids = new Set(LISTS.map(list => list.id));
  const extra = rows.filter(row => !ids.has(row.id)).sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || String(a.id).localeCompare(String(b.id))).map(row => ({ ...row, category_id: row.category_id ?? null, kind: row.kind || 'todo', key: row.id, archived: row.is_archived === true, syncedMetadata:Object.hasOwn(row,'is_archived'), available: true }));
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
    const tasks = (await this.repository.tasks(listId)).map(normalizeTask);
    this.tasks.set(listId, tasks);
    this.uncertainCreates.delete(listId);
    return tasks;
  }
  async exclusive(listId, action) { return this.exclusiveMany([listId], action); }
  async exclusiveMany(listIds, action) {
    const ids = [...new Set(listIds)].sort();
    if (ids.some(id => this.pending.has(id))) throw new Error('A change to this list is still saving. Please wait.');
    ids.forEach(id => this.pending.add(id));
    // Priority capacity spans lists, so writes that can add an active Must task
    // share one cross-tab lock instead of nesting per-list locks.
    const locks = ids.includes('__focus_must__') ? ['__focus_must__'] : ids;
    const acquire = index => index === locks.length ? action() : this.lock(locks[index], () => acquire(index + 1));
    try { return await acquire(0); }
    finally { ids.forEach(id => this.pending.delete(id)); }
  }
  async checkMustCapacity(task, fields, destination) {
    const mustId = LISTS.find(list => list.key === 'must').id;
    const active = (fields.is_done ?? task?.is_done) !== true;
    const focus = 'focus_list' in fields ? fields.focus_list : task?.focus_list;
    const counts = active && (destination.id === mustId || (destination.kind !== 'schedule' && focus === 'must'));
    if (!counts) return;
    const physical = await this.repository.tasks(mustId);
    if (this.tasks.has(mustId)) this.tasks.set(mustId, physical.map(normalizeTask));
    const pinned = this.repository.focusTasks ? await this.repository.focusTasks('must') : [...this.tasks.values()].flat().filter(row => row.focus_list === 'must');
    const rows = new Map([...physical, ...pinned].filter(row => row.is_done !== true && row.id !== task?.id).map(row => [row.id, row]));
    if (rows.size >= 3) throw new Error('Must Do Today is limited to 3 active tasks. Complete, unpin, or move one first.');
  }
  async setFocus(task, focus, list = {}) {
    if (list.kind === 'schedule') throw new Error('Only To-Do tasks can be pinned to a priority list.');
    return this.update(task, { focus_list: focus || null });
  }
  async create(list, fields) {
    const valid = validateTask(fields, list);
    if (!this.tasks.has(list.id)) throw new Error('Load this list before adding a task.');
    if (this.uncertainCreates.has(list.id)) throw new Error('Reload this list and check whether the previous task was saved before trying again.');
    return this.exclusiveMany([list.id, '__focus_must__'], async () => {
      await this.checkMustCapacity(null, valid, list);
      let task;
      try {
        task = normalizeTask(await this.repository.create(list.id, valid));
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
    return this.exclusiveMany([task.list_id, '__focus_must__'], async () => {
      await this.checkMustCapacity(task, fields, { id: task.list_id });
      const patch = validateTaskPatch(task, fields);
      const saved = normalizeTask(await this.repository.update(task, patch));
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
    if (!destination?.available || (destination.archived && destination.id !== task.list_id)) throw new Error('Choose an available, unarchived destination list.');
    if (destination.archived && task.is_done === true && fields.is_done === false) throw new Error('Restore this archived list before reopening its tasks.');
    if (!this.tasks.has(destination.id)) throw new Error('Load the destination list before moving a task.');
    return this.exclusiveMany([task.list_id, destination.id, '__focus_must__'], async () => {
      await this.checkMustCapacity(task, fields, destination);
      const moving = destination.id !== task.list_id;
      const edited = ['content', 'due_date', 'event_time', 'urgency', 'focus_list'].some(key => key in fields);
      const valid = edited ? validateTaskPatch(task, { ...fields, ...(moving && destination.kind === 'schedule' ? { focus_list: null } : {}) }, destination) : {};
      if (destination.kind === 'schedule' && !(fields.due_date ?? task.due_date)) throw new Error('Choose a date before moving this task to a Schedule.');
      const patch = { ...fields, ...valid, ...(moving ? { list_id: destination.id, ...(destination.kind === 'todo' ? { event_time: null } : {}), ...(destination.kind === 'schedule' ? { focus_list: null } : {}) } : {}) };
      const saved = normalizeTask(await this.repository.update(task, patch));
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
  async createList(id, title, options = {}) {
    if (typeof title !== 'string') { options = title || {}; title = id; id = crypto.randomUUID(); }
    if (!title.trim()) throw new Error('Enter a list title.');
    return this.exclusive('__lists__', async () => {
      const saved = await this.repository.createList(id, title.trim(), options);
      if (saved?.id !== id || saved.title !== title.trim()) throw new Error('List creation could not be confirmed. Refresh before retrying.');
      this.tasks.set(id, []);
      return { ...saved, category_id: saved.category_id ?? null, kind: saved.kind || options.kind || 'todo', key: id, available: true };
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
      const group = list.kind === 'schedule' && isPastEvent(task, now) ? 'Past events' : date < today ? 'Overdue' : +date === +today ? 'Today' : date <= week ? 'Next 7 days' : 'Later';
      groups[group] ||= [];
      groups[group].push({ list, task });
    }
  }
  for (const rows of Object.values(groups)) rows.sort((a, b) => compareTaskDates(a.task, b.task));
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
