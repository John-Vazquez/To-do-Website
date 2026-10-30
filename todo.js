import { LISTS, SUPABASE_URL, SUPABASE_KEY } from './todo-config.js';
import { TaskStore, arrangeLists, createSupabaseRepository, dateInputValue, parseDate, sortTasks, validateTask } from './todo-data.js';
import { createDemoRepository } from './todo-demo.js';

const $ = selector => document.querySelector(selector);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.local');
const params = new URLSearchParams(location.search);
const demo = params.has('demo') || (local && params.get('source') !== 'live');
const readOnly = local && !demo;
const cards = new Map();
let lists = LISTS.map(list => ({ ...list, available: false }));
let store;
let loading = false;
let dialogState;
const editor = $('#editor');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, label, action, className = 'icon-button') {
  const node = el('button', className, text);
  node.type = 'button'; node.setAttribute('aria-label', label); node.title = label;
  node.addEventListener('click', action); return node;
}
function showError(node, error) {
  node.hidden = !error;
  node.textContent = error ? error.message || String(error) : '';
}
function makeField(label, input) {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', 'field-label', label), input); return wrapper;
}
function urgencySelect() {
  const input = el('select'); input.name = 'urgency';
  for (const [value, label] of [['', 'No urgency'], ['1', '1 · Low'], ['2', '2 · Medium'], ['3', '3 · High']]) {
    const option = el('option', '', label); option.value = value; input.append(option);
  }
  return input;
}
function taskFields({ content = '', due_date = '', urgency = '' } = {}, multiline = false) {
  const text = el(multiline ? 'textarea' : 'input'); text.name = 'content'; text.value = content; text.required = true;
  text.placeholder = 'What needs doing?'; text.autocomplete = 'off'; if (multiline) text.rows = 3;
  const date = el('input'); date.name = 'due_date'; date.type = 'date'; date.value = dateInputValue(due_date);
  if (due_date && !date.value) { date.type = 'text'; date.value = due_date; }
  const priority = urgencySelect(); priority.value = urgency == null ? '' : String(urgency);
  const fields = el('div', multiline ? 'edit-fields' : 'add-fields');
  fields.append(makeField('Task', text), makeField('Due date', date), makeField('Urgency', priority));
  return { fields, text, date, priority };
}
function formValues(form) { return Object.fromEntries(new FormData(form)); }
function snapshot() { return JSON.stringify(formValues($('#editor-form'))); }

function buildCards() {
  cards.clear(); $('#focus-lists').replaceChildren(); $('#other-lists').replaceChildren();
  for (const list of lists) {
    const card = el('section', `list-card ${list.key === 'doing' ? 'doing-card' : list.key === 'must' ? 'must-card' : ''}`);
    card.dataset.listId = list.id; card.setAttribute('aria-labelledby', `title-${list.key}`);
    const heading = el('div', 'card-heading');
    const titleGroup = el('div', 'title-group');
    const title = el(list.fixed ? 'h2' : 'h3', '', list.title); title.id = `title-${list.key}`;
    const count = el('span', 'task-count', '…'); titleGroup.append(title, count); heading.append(titleGroup);
    if (!list.fixed) {
      const rename = button('✎', `Rename ${list.title}`, () => openRename(list)); rename.dataset.mutate = ''; heading.append(rename);
    }
    const sort = el('select', 'sort-select'); sort.setAttribute('aria-label', `Sort ${list.title}`);
    for (const [value, label] of [['priority', 'Urgency first'], ['date', 'Due date first']]) {
      const option = el('option', '', label); option.value = value; sort.append(option);
    }
    sort.addEventListener('change', () => renderTasks(list)); heading.append(sort);
    const taskList = el('ul', 'task-list'); taskList.setAttribute('aria-label', `${list.title} tasks`);
    const hint = el('p', 'list-hint', list.key === 'doing' ? 'Your attention goes here.' : list.key === 'must' ? 'Three priorities. A little more focus.' : ''); hint.hidden = !hint.textContent;
    const state = el('p', 'list-state', 'Loading tasks…'); state.setAttribute('role', 'status');
    const error = el('p', 'error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const reload = button('Reload list', `Reload ${list.title}`, () => loadList(list), 'quiet reload-list'); reload.hidden = true;
    const form = el('form', 'add-form'); form.setAttribute('aria-label', `Add to ${list.title}`);
    const fields = taskFields();
    const add = el('button', 'primary add-button', '+ Add task'); add.type = 'submit'; add.dataset.mutate = '';
    fields.fields.append(add); form.append(fields.fields);
    form.querySelectorAll('input, select').forEach(input => input.dataset.mutate = '');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (store.pending.has(list.id) || !cards.get(list.id).loaded || readOnly) return;
      const values = formValues(form);
      try {
        const promise = store.create(list, values);
        setBusy(list, true, 'Saving task…'); await promise;
        form.reset(); showError(error, null); reload.hidden = true; renderTasks(list); state.textContent = 'Task saved.';
      } catch (failure) {
        showError(error, failure); reload.hidden = false; state.textContent = 'Task was not confirmed saved. Your draft is still here.';
        renderTasks(list);
      } finally { setBusy(list, false); fields.text.focus(); }
    });
    card.append(heading, hint, taskList, state, error, reload, form);
    cards.set(list.id, { card, title, count, taskList, state, error, reload, form, sort, loaded: false });
    (list.fixed ? $('#focus-lists') : $('#other-lists')).append(card); setBusy(list, true);
  }
}
function setBusy(list, busy, message) {
  const view = cards.get(list.id); view.card.setAttribute('aria-busy', String(busy));
  view.card.querySelectorAll('[data-mutate]').forEach(node => node.disabled = busy || view.loading || readOnly || !view.loaded || !list.available);
  view.reload.disabled = busy || view.loading; if (message) view.state.textContent = message;
}
function renderTasks(list) {
  const view = cards.get(list.id), tasks = store.tasks.get(list.id) || [];
  view.count.textContent = list.limit ? `${tasks.length} / ${list.limit}` : String(tasks.length);
  view.taskList.replaceChildren();
  for (const task of sortTasks(tasks, view.sort.value)) {
    const row = el('li', 'task-row'); row.dataset.taskId = task.id;
    const complete = button('✓', `Complete ${task.content}`, () => openRemove(list, task, true), 'icon-button complete-button'); complete.dataset.mutate = '';
    const body = el('div', 'task-body'); body.append(el('span', 'task-content', task.content));
    const meta = el('div', 'task-meta');
    if (task.urgency) meta.append(el('span', `priority priority-${task.urgency}`, `${['', 'Low', 'Medium', 'High'][task.urgency] || task.urgency} urgency`));
    if (task.due_date) {
      const date = parseDate(task.due_date), today = new Date(); today.setHours(0, 0, 0, 0);
      const overdue = date && date < today, sameDay = date && +date === +today;
      const formatted = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }) : task.due_date;
      const badge = el('span', `due-date ${overdue || sameDay ? 'due-soon' : ''}`, `${overdue ? 'Overdue · ' : sameDay ? 'Today · ' : ''}${formatted}`);
      badge.title = String(task.due_date); meta.append(badge);
    }
    if (meta.childElementCount) body.append(meta);
    const edit = button('✎', `Edit ${task.content}`, () => openEdit(list, task)); edit.dataset.mutate = '';
    const remove = button('×', `Delete ${task.content}`, () => openRemove(list, task, false), 'icon-button delete-button'); remove.dataset.mutate = '';
    row.append(complete, body, edit, remove); view.taskList.append(row);
  }
  if (!tasks.length && view.loaded) view.taskList.append(el('li', 'empty-state', 'A little breathing room. Add a task below.'));
  setBusy(list, store.pending.has(list.id));
}
async function loadList(list) {
  if (!list.available || store.pending.has(list.id)) return;
  const view = cards.get(list.id); if (view.loading) return;
  view.loading = true; setBusy(list, true, 'Loading tasks…');
  try {
    await store.load(list.id); view.loaded = true;
    showError(view.error, null); view.reload.hidden = true; renderTasks(list); view.state.textContent = '';
  } catch (failure) {
    showError(view.error, new Error(`Could not load this list: ${failure.message}`)); view.reload.hidden = false; view.state.textContent = 'Refresh to try again.';
  } finally { view.loading = false; setBusy(list, false); }
}
async function loadAll() {
  if (loading || store?.pending.size) return;
  loading = true; $('#reload-all').disabled = true; showError($('#global-error'), null);
  try {
    if (!store) {
      let repository;
      if (demo) repository = createDemoRepository();
      else {
        // Exact version; demo makes no CDN or DB calls.
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
        repository = createSupabaseRepository(createClient(SUPABASE_URL, SUPABASE_KEY), { readOnly });
      }
      const lock = navigator.locks ? (id, action) => navigator.locks.request(`todo-list:${id}`, action) : undefined;
      store = new TaskStore(repository, { lock });
    }
    const nextLists = arrangeLists(await store.repository.lists());
    if (cards.size && lists.length === nextLists.length && lists.every((list, index) => list.id === nextLists[index].id)) {
      lists.forEach((list, index) => { Object.assign(list, nextLists[index]); updateTitle(list); });
    } else {
      if (hasDrafts()) throw new Error('Your list collection changed. Keep a copy of your draft before reloading the page.');
      lists = nextLists; buildCards();
    }
    await Promise.all(lists.map(async list => {
      if (list.available) await loadList(list);
      else { const view = cards.get(list.id); view.state.textContent = 'List unavailable. Its original identifier is preserved.'; setBusy(list, false); }
    }));
    const failed = lists.some(list => list.available && !cards.get(list.id).error.hidden);
    $('#connection-status').textContent = failed ? 'Some lists could not load. See the message on each list.' : demo ? 'Demo ready · changes stay in this tab' : readOnly ? 'Live lists loaded · read-only preview' : 'Connected to Supabase';
  } catch (failure) {
    showError($('#global-error'), new Error(`Could not load your lists: ${failure.message}`));
    $('#connection-status').textContent = 'Connection failed. Your drafts have been kept.';
  } finally { loading = false; $('#reload-all').disabled = false; }
}
function updateTitle(list) {
  const view = cards.get(list.id); view.title.textContent = list.title;
  view.form.setAttribute('aria-label', `Add to ${list.title}`); view.sort.setAttribute('aria-label', `Sort ${list.title}`);
  view.taskList.setAttribute('aria-label', `${list.title} tasks`);
  view.reload.setAttribute('aria-label', `Reload ${list.title}`); view.reload.title = `Reload ${list.title}`;
  const rename = view.card.querySelector('.card-heading [data-mutate]');
  if (rename) { rename.setAttribute('aria-label', `Rename ${list.title}`); rename.title = `Rename ${list.title}`; }
}
function openDialog({ title, description, fields, saveText = 'Save changes', action, list, destructive = false }) {
  if (editor.open || readOnly || store.pending.has(list.id)) return;
  $('#editor-heading').textContent = title; $('#editor-description').textContent = description;
  $('#editor-fields').replaceChildren(...(fields ? [fields] : []));
  $('#editor-save').textContent = saveText; $('#editor-save').className = destructive ? 'danger' : 'primary';
  $('#discard-panel').hidden = true; showError($('#editor-error'), null);
  dialogState = { action, list, saveText, saving: false, opener: document.activeElement };
  dialogState.initial = snapshot(); editor.showModal();
  (fields?.querySelector('textarea, input') || $('#editor-cancel')).focus();
}
function openEdit(list, task) {
  const { fields, date, priority, text } = taskFields(task, true);
  const originalDate = date.value, originalPriority = priority.value, originalText = text.value;
  openDialog({ title: 'Edit task', description: list.title, fields, list, action: async () => {
    const values = formValues($('#editor-form')), patch = {};
    if (values.content !== originalText) { if (!values.content.trim()) throw new Error('Enter a task before saving.'); patch.content = values.content.trim(); }
    if (values.due_date !== originalDate) patch.due_date = validateTask({ content: 'valid', due_date: values.due_date }).due_date;
    if (values.urgency !== originalPriority) patch.urgency = validateTask({ content: 'valid', urgency: values.urgency }).urgency;
    // Unchanged legacy dates and other columns are never rewritten.
    if (Object.keys(patch).length) await store.update(task, patch);
    renderTasks(list); cards.get(list.id).state.textContent = 'Changes saved.';
  } });
}
function openRename(list) {
  const input = el('input'); input.name = 'title'; input.required = true; input.value = list.title;
  openDialog({ title: 'Rename list', description: 'Keep a name that makes sense to you.', fields: makeField('List title', input), list, action: async () => {
    await store.rename(list, input.value); updateTitle(list); cards.get(list.id).state.textContent = 'List title saved.';
  } });
}
function openRemove(list, task, complete) {
  openDialog({ title: complete ? 'Complete this task?' : 'Delete this task?', description: 'This removes the task permanently. Completion history and undo are not available yet.', fields: el('p', 'confirm-task', task.content), saveText: complete ? 'Complete & remove' : 'Delete task', list, destructive: true, action: async () => {
    await store.remove(task); renderTasks(list); cards.get(list.id).state.textContent = complete ? 'Task completed and removed.' : 'Task deleted.';
  } });
}
function closeEditor(force = false) {
  if (!dialogState || dialogState.saving) return;
  if (!force && snapshot() !== dialogState.initial) { $('#discard-panel').hidden = false; $('#keep-editing').focus(); return; }
  const { opener, list } = dialogState; editor.close(); dialogState = null;
  if (opener?.isConnected) opener.focus(); else cards.get(list.id).form.querySelector('input')?.focus();
}
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault(); if (dialogState.saving) return;
  const state = dialogState; state.saving = true;
  $('#editor-save').textContent = 'Saving…'; showError($('#editor-error'), null);
  $('#editor-form').setAttribute('aria-busy', 'true');
  $('#editor-form').querySelectorAll('button').forEach(node => node.disabled = true);
  // Inert blocks input without dropping values from FormData.
  $('#editor-fields').inert = true;
  try { await state.action(); state.saving = false; closeEditor(true); }
  catch (failure) { showError($('#editor-error'), failure); }
  finally {
    state.saving = false; $('#editor-fields').inert = false;
    $('#editor-form').querySelectorAll('button').forEach(node => node.disabled = false);
    $('#editor-form').setAttribute('aria-busy', 'false'); $('#editor-save').textContent = state.saveText;
    setBusy(state.list, false);
  }
});
editor.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#editor-close').addEventListener('click', () => closeEditor());
$('#editor-cancel').addEventListener('click', () => closeEditor());
$('#discard-changes').addEventListener('click', () => closeEditor(true));
$('#keep-editing').addEventListener('click', () => { $('#discard-panel').hidden = true; $('#editor-fields').querySelector('input, textarea')?.focus(); });
$('#reload-all').addEventListener('click', () => loadAll());
function hasDrafts() { return [...cards.values()].some(view => Object.values(formValues(view.form)).some(Boolean)); }
window.addEventListener('beforeunload', event => {
  if (hasDrafts() || store?.pending.size || dialogState?.saving || (dialogState && snapshot() !== dialogState.initial)) { event.preventDefault(); event.returnValue = ''; }
});
$('#today-label').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
if (demo || readOnly) {
  $('#mode-notice').hidden = false;
  $('#mode-notice').textContent = demo ? 'SAFE DEMO · Sample tasks only. Try anything; reload resets your changes. Your Supabase data is untouched.' : 'LIVE PREVIEW · Read only. Your production tasks cannot be changed from this local preview.';
}
buildCards(); loadAll();
