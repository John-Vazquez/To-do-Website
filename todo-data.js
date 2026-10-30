import { LISTS } from './todo-config.js';

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
    lists: () => pages(() => client.from('lists').select('id,title').order('id')),
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
      return checked(client.from('lists').update({ title }).eq('id', listId).select('id,title').single());
    }
  };
}

export function arrangeLists(rows) {
  const existing = new Map(rows.map(row => [row.id, row]));
  const known = LISTS.map(list => ({ ...list, title: list.fixed ? list.title : existing.get(list.id)?.title ?? list.title, available: existing.has(list.id) }));
  const ids = new Set(LISTS.map(list => list.id));
  const extra = rows.filter(row => !ids.has(row.id)).sort((a, b) => String(a.id).localeCompare(String(b.id))).map(row => ({ ...row, key: row.id, available: true }));
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
  async exclusive(listId, action) {
    if (this.pending.has(listId)) throw new Error('A change to this list is still saving. Please wait.');
    this.pending.add(listId); // Reserve before the first asynchronous operation.
    try { return await this.lock(listId, action); }
    finally { this.pending.delete(listId); }
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
        if (latest.length >= list.limit) throw new Error('Must Do Today is limited to 3 tasks. Complete or remove one first.');
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
}
