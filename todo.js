import { LISTS, SUPABASE_URL, SUPABASE_KEY } from './todo-config.js?v=20261030-2';
import { TaskStore, Preferences, activeTasks, arrangeLists, createSupabaseRepository, dateInputValue, parseDate, searchTasks, sortTasks, upcomingTasks, validateTask } from './todo-data.js?v=20261030-2';
import { createDemoRepository } from './todo-demo.js?v=20261030-2';

const $ = selector => document.querySelector(selector);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.local');
const params = new URLSearchParams(location.search);
const demo = params.has('demo') || (local && params.get('source') !== 'live');
// Public hosted writes are explicitly enabled by the owner; local live previews stay read-only.
const readOnly = !demo && (local || params.get('source') === 'live');
let storage; try { storage = localStorage; } catch { /* Browser preferences optional. */ }
const prefs = new Preferences(storage);
let viewMode = prefs.value.view === 'expanded' ? 'expanded' : 'compact';
let lists = [], store, panelList, dialogState, undoTaskId, collectionMode, refreshing = false;
const loaded = new Set(), errors = new Map(), drafts = new Map();

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function button(text, action, className = '', label = text) { const node = el('button', className, text); node.type = 'button'; node.setAttribute('aria-label', label); node.addEventListener('click', action); return node; }
function errorAt(node, error) { node.hidden = !error; node.textContent = error ? error.message || String(error) : ''; }
function notify(text, undoId) { $('#notification').hidden = false; $('#notification-text').textContent = text; undoTaskId = undoId; $('#undo').hidden = !undoId; }
function remember(key, value) { if (!prefs.set(key, value)) notify('Browser storage is unavailable. Preferences will last for this tab only.'); }
function listById(id) { return lists.find(list => list.id === id); }
function currentTask(id) { for (const tasks of store.tasks.values()) { const task = tasks.find(task => task.id === id); if (task) return task; } }
function writable(list) { return !readOnly && list?.available && !list.archived && loaded.has(list.id) && !store.pending.has(list.id) && !refreshing; }
function field(label, input) { const node = el('label', 'field'); input.setAttribute('aria-label', label); node.append(el('span', '', label), input); return node; }
function input(name, value = '', type = 'text') { const node = el('input'); node.name = name; node.type = type; node.value = value; return node; }
function destinationSelect(id) { const select = el('select'); select.name = 'list_id'; for (const list of lists.filter(list => list.available && !list.archived)) { const option = el('option', '', list.title); option.value = list.id; select.append(option); } select.value = id; return select; }
function values() { return Object.fromEntries(new FormData($('#editor-form'))); }
function snapshot() { return JSON.stringify(values()); }
function taskFields(task, destination) {
  const fields = el('div', 'task-fields');
  const text = el('textarea'); text.name = 'content'; text.rows = 3; text.required = true; text.value = task?.content || '';
  const date = input('due_date', dateInputValue(task?.due_date), 'date');
  if (task?.due_date && !date.value) { date.type = 'text'; date.value = task.due_date; }
  const urgency = el('select'); urgency.name = 'urgency';
  for (const [value, label] of [['', 'None'], ['1', '1 · Low'], ['2', '2 · Medium'], ['3', '3 · High']]) { const option = el('option', '', label); option.value = value; urgency.append(option); }
  urgency.value = task?.urgency == null ? '' : String(task.urgency);
  fields.append(field('Task', text), field('List', destinationSelect(destination)), field('Deadline', date), field('Urgency', urgency));
  if (task) { const done = input('is_done', 'true', 'checkbox'); done.checked = task.is_done === true; fields.append(field('Completed', done)); }
  return fields;
}
function taskMeta(task) {
  const meta = el('span', 'task-meta');
  if (task.urgency) meta.append(el('span', `urgency u${task.urgency}`, `U${task.urgency}`));
  if (task.due_date) { const date = parseDate(task.due_date), today = new Date(); today.setHours(0, 0, 0, 0); const due = el('span', `deadline ${date && date <= today ? 'due' : ''}`, date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }) : task.due_date); due.title = String(task.due_date); meta.append(due); }
  return meta;
}
function taskRow(task, list, full = false) {
  const row = el('li', `task-row ${task.is_done === true ? 'is-done' : ''}`); row.dataset.taskId = task.id;
  const check = input('complete', '', 'checkbox'); check.checked = task.is_done === true; check.setAttribute('aria-label', `${task.is_done === true ? 'Reopen' : 'Complete'} ${task.content}`); check.disabled = !writable(list);
  check.addEventListener('change', async () => {
    const done = check.checked; check.disabled = true; row.setAttribute('aria-busy', 'true');
    try { const saved = await store.setDone(task, done, list); notify(done ? 'Task completed.' : 'Task reopened.', done ? saved.id : null); }
    catch (failure) { check.checked = !done; errors.set(list.id, failure); errorAt($('#global-error'), failure); }
    finally { render(); }
  });
  const title = button(task.content, () => openTask(currentTask(task.id) || task), 'task-title');
  if (full) title.classList.add('full-title');
  row.append(check, title, taskMeta(task)); return row;
}
async function run(list, action) {
  errorAt($('#global-error'), null); errors.delete(list?.id);
  try { const promise = action(); render(); await promise; }
  catch (failure) { if (list) errors.set(list.id, failure); errorAt($('#global-error'), failure); }
  finally { render(); }
}
function buildCard(list) {
  const tasks = sortTasks(activeTasks(store.tasks.get(list.id) || []));
  const card = el('article', `list-card ${list.fixed ? `pinned ${list.key}` : ''}`); card.dataset.listId = list.id;
  const heading = el('header', 'card-heading'), h = el('h3');
  h.append(button(list.title, () => openList(list), 'list-title', `Open ${list.title}`));
  const count = el('span', 'count', list.limit ? `${tasks.length}/${list.limit}` : String(tasks.length));
  heading.append(h, count, button('+', () => openQuickAdd(list), 'card-add', `Add task to ${list.title}`));
  heading.lastChild.disabled = !writable(list); card.append(heading);
  const rows = el('ul', 'task-list');
  const visible = viewMode === 'compact' && !list.fixed ? tasks.slice(0, 5) : tasks;
  visible.forEach(task => rows.append(taskRow(task, list)));
  if (tasks.length) card.append(rows);
  if (tasks.length > visible.length) card.append(button(`+${tasks.length - visible.length} more`, () => openList(list), 'more-link'));
  const failure = errors.get(list.id);
  if (failure) card.append(el('p', 'error', failure.message));
  if (!loaded.has(list.id)) card.append(el('p', 'card-state', list.available ? 'Loading…' : 'List unavailable'));
  if (list.fixed) {
    const form = el('form', 'inline-add'); form.setAttribute('aria-label', `Quick add to ${list.title}`);
    const text = input('content', drafts.get(list.id) || ''); text.placeholder = 'Add a task…'; text.setAttribute('aria-label', `New task for ${list.title}`); text.required = true; text.autocomplete = 'off';
    text.addEventListener('input', () => drafts.set(list.id, text.value));
    const add = el('button', '', 'Add'); add.type = 'submit'; text.disabled = add.disabled = !writable(list);
    form.append(text, add); form.addEventListener('submit', event => { event.preventDefault(); if (!writable(list)) return; const content = text.value; run(list, async () => { await store.create(list, { content }); drafts.delete(list.id); }); }); card.append(form);
  } else if (!tasks.length && loaded.has(list.id)) card.classList.add('empty');
  return card;
}
function render() {
  if (!store) return;
  lists = prefs.arrange(lists);
  const activeLists = lists.filter(list => !list.archived);
  $('#focus-lists').replaceChildren(...activeLists.filter(list => list.fixed).map(buildCard));
  $('#other-lists').replaceChildren(...activeLists.filter(list => !list.fixed).map(buildCard));
  $('#other-count').textContent = `${activeLists.filter(list => !list.fixed).length} lists`;
  $('#overview-count').textContent = `${activeLists.reduce((count, list) => count + activeTasks(store.tasks.get(list.id) || []).length, 0)} active tasks`;
  for (const mode of ['compact', 'expanded']) $('#' + mode).setAttribute('aria-pressed', String(viewMode === mode));
  $('#quick-add').disabled = $('#add-list').disabled = readOnly || refreshing || !loaded.size;
  renderSearch(); if ($('#list-panel').open) renderList(); if ($('#collection').open) renderCollection();
}
function renderSearch() {
  if (!store) return;
  const term = $('#search').value.trim(); $('#search-section').hidden = !term;
  const results = searchTasks(lists, store.tasks, term, $('#search-completed').checked);
  const nodes = results.map(({ task, list }) => resultButton(list, task));
  $('#search-results').replaceChildren(...(nodes.length ? nodes : [el('p', 'muted', 'No matches.')]));
}
function resultButton(list, task) {
  const result = button('', () => { openList(list); if (task) openTask(currentTask(task.id) || task); }, 'result');
  result.append(el('span', '', task?.content || list.title), el('small', '', `${list.title}${list.archived ? ' · Archived' : ''}${task?.is_done ? ' · Completed' : ''}`));
  if (task) result.append(taskMeta(task)); return result;
}
function openList(list) {
  panelList = list; $('#show-completed').checked = false; $('#list-sort').value = 'priority';
  renderList(); if (!$('#list-panel').open) $('#list-panel').showModal();
}
function renderList() {
  const list = panelList; if (!list) return;
  const tasks = store.tasks.get(list.id) || [], active = activeTasks(tasks), done = tasks.filter(task => task.is_done === true);
  $('#list-panel-title').textContent = list.title;
  $('#list-panel-count').textContent = `${active.length} active · ${done.length} completed${list.archived ? ' · Archived' : ''}`;
  $('#rename-list').hidden = list.fixed; $('#rename-list').disabled = $('#list-add').disabled = $('#list-bulk').disabled = !writable(list);
  errorAt($('#list-panel-error'), errors.get(list.id));
  const body = $('#list-panel-body'), rows = el('ul', 'task-list editor-list');
  sortTasks(active, $('#list-sort').value).forEach(task => rows.append(taskRow(task, list, true)));
  if (!active.length) rows.append(el('li', 'muted', 'No active tasks.'));
  body.replaceChildren(rows);
  if ($('#show-completed').checked) { const completed = el('ul', 'task-list editor-list'); sortTasks(done, $('#list-sort').value).forEach(task => completed.append(taskRow(task, list, true))); body.append(el('h3', 'completed-heading', `Completed (${done.length})`), completed); }
}
function openEditor({ title, description = '', fields, saveText = 'Save', action, task }) {
  if ($('#editor').open) return;
  $('#editor-heading').textContent = title; $('#editor-description').textContent = description;
  $('#editor-fields').replaceChildren(fields); $('#editor-save').textContent = saveText;
  $('#discard-panel').hidden = $('#delete-panel').hidden = true; errorAt($('#editor-error'), null);
  $('#delete-task').hidden = !task || readOnly; $('#editor-save').disabled = readOnly;
  dialogState = { action, task, busy: false, initial: snapshot(), saveText, opener: document.activeElement };
  $('#editor').showModal(); fields.querySelector('input, textarea, select')?.focus();
}
function openQuickAdd(list) {
  const id = list?.id || (lists.find(list => list.id === prefs.value.destination && !list.archived)?.id) || LISTS[0].id;
  openEditor({ title: 'Add task', fields: taskFields(null, id), action: async () => {
    const data = values(), destination = listById(data.list_id);
    if (!writable(destination)) throw new Error('The destination is unavailable or still loading.');
    await store.create(destination, data); remember('destination', destination.id); notify('Task added.');
  } });
}
function openTask(task) {
  const fields = taskFields(task, task.list_id), originals = Object.fromEntries(new FormData(wrapForm(fields)));
  openEditor({ title: 'Task details', description: readOnly ? 'Live data · read only' : '', fields, task, action: async () => {
    const data = values(), patch = {};
    if (data.content !== originals.content) { if (!data.content.trim()) throw new Error('Enter a task before saving.'); patch.content = data.content.trim(); }
    if (data.due_date !== originals.due_date) patch.due_date = validateTask({ content: 'valid', due_date: data.due_date }).due_date;
    if (data.urgency !== originals.urgency) patch.urgency = validateTask({ content: 'valid', urgency: data.urgency }).urgency;
    if (Boolean(data.is_done) !== (task.is_done === true)) patch.is_done = Boolean(data.is_done);
    const destination = listById(data.list_id);
    if (Object.keys(patch).length || destination?.id !== task.list_id) await store.changeTask(task, patch, destination);
    notify('Task saved.');
  } });
}
function wrapForm(fields) { const form = el('form'); form.append(fields); return form; }
function openBulk() {
  const text = el('textarea'); text.name = 'lines'; text.rows = 9; text.required = true; text.placeholder = 'One task per line';
  openEditor({ title: `Bulk add · ${panelList.title}`, description: 'Each non-empty line becomes a separate task.', fields: field('Tasks', text), saveText: 'Add tasks', action: async () => {
    try { const added = await store.bulkCreate(panelList, text.value); notify(`${added.length} tasks added.`); }
    catch (failure) { if (failure.remaining != null) text.value = failure.remaining; failure.message = `${failure.savedCount || 0} tasks saved. ${failure.message}`; throw failure; }
  } });
}
function openRename() {
  const text = input('title', panelList.title); text.required = true;
  openEditor({ title: 'Rename list', fields: field('List title', text), action: () => store.rename(panelList, text.value) });
}
function openNewList() {
  const text = input('title'); text.required = true; const id = crypto.randomUUID(); let uncertain = false;
  openEditor({ title: 'Add list', fields: field('List title', text), action: async () => {
    if (uncertain) throw new Error('List creation was not confirmed. Close this dialog and refresh data before retrying.');
    if (!text.value.trim()) throw new Error('Enter a list title.');
    try { const list = await store.createList(id, text.value); lists.push(list); loaded.add(list.id); notify('List created.'); }
    catch (error) { uncertain = true; throw new Error(`${error.message} Refresh data and check for the list before retrying.`); }
  } });
}
function closeEditor(force = false) {
  if (!dialogState || dialogState.busy) return;
  if (!force && snapshot() !== dialogState.initial) { $('#discard-panel').hidden = false; $('#keep-editing').focus(); return; }
  const opener = dialogState.opener; $('#editor').close(); dialogState = null;
  if (opener?.isConnected) opener.focus(); else if ($('#list-panel').open) $('#list-add').focus(); else $('#quick-add').focus();
}
async function saveEditor(remove = false) {
  const state = dialogState; if (!state || state.busy || readOnly) return;
  state.busy = true; errorAt($('#editor-error'), null); $('#editor-fields').inert = true;
  $('#editor-form').querySelectorAll('button').forEach(node => node.disabled = true); $('#editor-save').textContent = 'Saving…';
  try { if (remove) { await store.remove(state.task); notify('Task permanently deleted.'); } else await state.action(); state.busy = false; closeEditor(true); }
  catch (failure) { errorAt($('#editor-error'), failure); }
  finally { state.busy = false; $('#editor-fields').inert = false; $('#editor-form').querySelectorAll('button').forEach(node => node.disabled = false); $('#editor-save').textContent = state.saveText; render(); }
}
function openCollection(mode) { collectionMode = mode; renderCollection(); if (!$('#collection').open) $('#collection').showModal(); }
function renderCollection() {
  $('#collection-title').textContent = collectionMode === 'upcoming' ? 'Upcoming tasks' : 'Manage lists';
  const body = $('#collection-body'); body.replaceChildren();
  if (collectionMode === 'upcoming') {
    const groups = upcomingTasks(lists, store.tasks);
    for (const [group, rows] of Object.entries(groups)) { const section = el('section', 'upcoming-group'); section.append(el('h3', '', `${group} (${rows.length})`)); rows.forEach(({ list, task }) => section.append(resultButton(list, task))); if (!rows.length) section.append(el('p', 'muted', 'No tasks.')); body.append(section); }
  } else {
    body.append(el('p', 'notice', demo || readOnly ? 'Order and archive are saved in this browser only. Archiving hides a list from the overview; its tasks remain stored and searchable.' : 'Order and archive sync across devices. Import this browser’s saved preferences explicitly with the button below.'));
    if (!demo && !readOnly && (prefs.value.order || prefs.value.archived)) body.append(button('Import this browser’s order and archive settings', async () => { try { const imported=prefs.importBrowserListPreferences(lists); await store.repository.saveListMetadata(imported); lists = arrangeLists(await store.repository.lists()); render(); } catch (error) { await refresh(); notify(`Could not import preferences; server state reloaded: ${error.message}`); } }));
    const ordinary = lists.filter(list => !list.fixed);
    for (const list of lists) {
      const row = el('div', 'manage-row'); row.append(button(list.title, () => openList(list), 'manage-title'));
      if (list.fixed) row.append(el('span', 'muted', 'Pinned'));
      else {
        const index = ordinary.indexOf(list);
        for (const [offset, text, label] of [[-1, '↑', 'Move up'], [1, '↓', 'Move down']]) {
          const move = button(text, async () => { const ids = ordinary.map(list => list.id), target = index + offset; [ids[index], ids[target]] = [ids[target], ids[index]]; remember('order', ids); if (!demo && !readOnly) { try { const reordered = ids.map(id => listById(id)); await store.repository.saveListOrder(reordered); lists = arrangeLists(await store.repository.lists()); } catch (error) { await refresh(); notify(`Could not save order; server order reloaded: ${error.message}`); } } render(); }, '', `${label} ${list.title}`);
          move.disabled = index + offset < 0 || index + offset >= ordinary.length; row.append(move);
        }
        row.append(button(list.archived ? 'Restore' : 'Archive', async () => { const nextArchived=!list.archived; if (!demo && !readOnly) { try { await store.repository.saveListArchive(list,nextArchived); list.archived=nextArchived; lists=arrangeLists(await store.repository.lists()); } catch (error) { await refresh(); notify(`Could not save archive state; server state reloaded: ${error.message}`); } } else { if (!prefs.archive(list,nextArchived)) notify('Archive preference could not be saved; it lasts for this tab.'); } render(); }, '', `${list.archived ? 'Restore' : 'Archive'} ${list.title}`));
      }
      body.append(row);
    }
  }
}
async function refresh() {
  if (refreshing || store?.pending.size) return;
  refreshing = true; $('#refresh').disabled = true; $('#quick-add').disabled = $('#add-list').disabled = $('#upcoming').disabled = true; errorAt($('#global-error'), null); $('#connection-status').textContent = 'Loading…';
  try {
    if (!store) {
      let repository;
      if (demo) repository = createDemoRepository();
      else {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
        const client = createClient(SUPABASE_URL, SUPABASE_KEY);
        repository = createSupabaseRepository(client, { readOnly });
      }
      const lock = navigator.locks ? (id, action) => navigator.locks.request(`todo-list:${id}`, action) : undefined;
      store = new TaskStore(repository, { lock });
    }
    const rows = await store.repository.lists();
    const next = arrangeLists(rows);
    next.forEach(list => { if (list.available) list.syncedMetadata = !demo && rows.some(row => Object.hasOwn(row, 'is_archived')); });
    lists = next.map(list => Object.assign(listById(list.id) || {}, list));
    render();
    await Promise.all(lists.filter(list => list.available).map(async list => {
      try { await store.load(list.id); loaded.add(list.id); errors.delete(list.id); }
      catch (failure) { errors.set(list.id, failure); }
    }));
    $('#connection-status').textContent = errors.size ? 'Some lists failed to load. Refresh to retry.' : demo ? 'Demo ready · in-memory sample data' : readOnly ? 'Live preview · read only' : 'Live data · synced';
    if (errors.size) errorAt($('#global-error'), 'Some lists could not load. Refresh data from the menu to retry.');
  } catch (failure) { errorAt($('#global-error'), `Could not load lists: ${failure.message}`); $('#connection-status').textContent = 'Connection failed'; }
  finally { refreshing = false; $('#refresh').disabled = false; $('#upcoming').disabled = !loaded.size; render(); }
}
$('#editor-form').addEventListener('submit', event => { event.preventDefault(); saveEditor(); });
$('#editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
for (const id of ['editor-close', 'editor-cancel']) $('#' + id).addEventListener('click', () => closeEditor());
$('#discard-changes').onclick = () => closeEditor(true);
$('#keep-editing').onclick = () => { $('#discard-panel').hidden = true; $('#editor-fields').querySelector('input,textarea')?.focus(); };
$('#delete-task').onclick = () => { $('#delete-panel').hidden = false; $('#keep-task').focus(); };
$('#keep-task').onclick = () => { $('#delete-panel').hidden = true; };
$('#confirm-delete').onclick = () => saveEditor(true);
for (const id of ['close-list', 'close-list-footer']) $('#' + id).onclick = () => $('#list-panel').close();
$('#close-collection').onclick = () => $('#collection').close();
$('#list-add').onclick = () => openQuickAdd(panelList); $('#list-bulk').onclick = openBulk; $('#rename-list').onclick = openRename;
$('#list-sort').onchange = $('#show-completed').onchange = renderList;
$('#quick-add').onclick = () => openQuickAdd(); $('#add-list').onclick = openNewList;
$('#upcoming').onclick = () => openCollection('upcoming');
$('#manage-lists').onclick = () => { $('.menu').open = false; openCollection('manage'); };
$('#refresh').onclick = () => { $('.menu').open = false; refresh(); };
$('#search').addEventListener('input', renderSearch); $('#search-completed').onchange = renderSearch;
for (const mode of ['compact', 'expanded']) $('#' + mode).onclick = () => { viewMode = mode; remember('view', mode); render(); };
$('#dismiss-notification').onclick = () => { $('#notification').hidden = true; undoTaskId = null; };
$('#undo').onclick = async () => { const task = currentTask(undoTaskId); if (!task) { notify('Task no longer available. Refresh data.'); return; } await run(listById(task.list_id), async () => { await store.setDone(task, false, listById(task.list_id)); notify('Completion undone.'); }); };
window.addEventListener('beforeunload', event => { if ([...drafts.values()].some(Boolean) || store?.pending.size || dialogState?.busy || (dialogState && snapshot() !== dialogState.initial)) { event.preventDefault(); event.returnValue = ''; } });
$('#mode-badge').textContent = demo ? 'DEMO' : 'LIVE';
$('#mode-notice').textContent = demo ? 'Sample data · resets on reload' : readOnly ? 'Read-only local live preview' : 'Public live lists';
refresh();
