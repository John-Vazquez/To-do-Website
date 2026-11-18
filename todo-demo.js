import { LISTS } from './todo-config.js?v=20261118-1';

// Entirely invented data. Kept in memory only; reload resets the demo.
export function createDemoRepository() {
  const titles = ['Doing Right Now', 'Must Do Today', 'This week', 'Work & projects', 'Things to buy', 'Doctor appointments', 'Things to return', 'Paintball', 'Things to sell', 'Appointments', 'Discrete II', 'Calc III', 'Cyber Analysis', 'Topics in Cyber'];
  const categories = [{ id: 'demo-doctors', title: 'Doctors' }];
  const lists = LISTS.map((list, index) => ({ id: list.id, title: titles[index], category_id: index === 5 ? categories[0].id : null, kind: 'todo' }));
  lists.push({ id: 'demo-doctors-schedule', title: 'Schedule', category_id: categories[0].id, kind: 'schedule' });
  const today = new Date();
  const date = offset => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const samples = [
    [['Finish the application update', null, 3], ['Book the appointment I’ve been putting off', date(0), null]],
    [['Send the project notes', date(0), 2], ['Pick up the prescription', date(0), null]],
    [['Review weekly priorities', date(2), null], ['Check the car registration', date(4), 1]],
    [['Review the next release checklist', date(1), 2], ['Write down ideas for the new project', null, null]],
    [['Toothpaste and milk', null, null], ['A notebook for the desk', null, 1]],
    [['Schedule the annual checkup', date(7), null]],
    [['Return the unopened adapter', date(3), null]],
    [['Check gear before the weekend', date(2), null]],
    [['Take photos of the spare equipment', null, null]],
    [['Confirm the next appointment', date(5), null]],
    [], [], [], []
  ];
  let tasks = samples.flatMap((items, index) => items.map(([content, due_date, urgency], n) => ({ id: `demo-${index}-${n}`, list_id: lists[index].id, content, due_date, urgency, is_done: false, created_at: '2026-10-01T12:00:00Z' })));
  tasks.push({ id: 'demo-completed', list_id: lists[2].id, content: 'Completed sample task', is_done: true, due_date: date(-2), urgency: null });
  tasks.push(...Array.from({ length: 22 }, (_, index) => ({ id: `long-${index}`, list_id: lists[3].id, content: index === 0 ? 'Review compatibility requirements for the next application update, including existing task metadata and older clients' : `Project task ${index + 1}`, due_date: index === 1 ? date(-1) : index === 2 ? date(12) : null, urgency: index % 4 === 0 ? 2 : null, is_done: false })));
  tasks.push({ id: 'demo-doctors-event', list_id: 'demo-doctors-schedule', content: 'Annual checkup', due_date: date(3), event_time: '10:30', focus_list: null, urgency: null, is_done: false });
  tasks = tasks.map(task => ({ event_time: null, focus_list: null, ...task }));
  const titleText = title => { if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a title.'); return title.trim(); };
  const copy = value => structuredClone(value);
  const wait = async () => new Promise(resolve => setTimeout(resolve, 120));
  return {
    async categories() { await wait(); return copy(categories); },
    async createCategory(title) { await wait(); const row = { id: crypto.randomUUID(), title: titleText(title) }; categories.push(row); return copy(row); },
    async renameCategory(id, title) { await wait(); const row = categories.find(row => row.id === id); if (!row) throw new Error('Category no longer exists.'); row.title = titleText(title); return copy(row); },
    async focusTasks(focus) { await wait(); return copy(tasks.filter(task => task.focus_list === focus && task.is_done !== true)); },
    async lists() { await wait(); return copy(lists); },
    async tasks(id) { await wait(); return copy(tasks.filter(task => task.list_id === id)); },
    async create(id, fields) { await wait(); const task = { id: crypto.randomUUID(), list_id: id, is_done: false, event_time: null, focus_list: null, ...fields }; tasks.push(task); return copy(task); },
    async update(task, fields) { await wait(); const row = tasks.find(row => row.id === task.id); if (!row) throw new Error('Task no longer exists.'); Object.assign(row, fields); return copy(row); },
    async remove(task) { await wait(); tasks = tasks.filter(row => row.id !== task.id); return { id: task.id }; },
    async rename(id, title) { await wait(); const row = lists.find(row => row.id === id); row.title = title; return copy(row); },
    async createList(id, title, options = {}) { await wait(); if (typeof title !== 'string') { options = title || {}; title = id; id = crypto.randomUUID(); } const row = { id, title: titleText(title), category_id: options.category_id || null, kind: options.kind || 'todo' }; lists.push(row); return copy(row); },
    async updateList(id, fields) { await wait(); const row = lists.find(row => row.id === id); if (!row) throw new Error('List no longer exists.'); const patch = { ...fields }; if ('title' in patch) patch.title = titleText(patch.title); Object.assign(row, patch); return copy(row); }
  };
}
