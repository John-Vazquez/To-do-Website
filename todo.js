import { LISTS } from './todo-config.js?v=20261118-1';
import { TaskStore, Preferences, activeTasks, arrangeLists, dateInputValue, isPastEvent, parseDate, searchTasks, sortTasks, upcomingTasks, validateTask } from './todo-data.js?v=20261118-1';
import { createDemoRepository } from './todo-demo.js?v=20261118-1';
import { createPinRepository, pinRequest, TOKEN_KEY } from './todo-auth.js?v=20261118-1';

const $ = selector => document.querySelector(selector);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.local');
const params = new URLSearchParams(location.search);
const demo = params.has('demo') || (local && params.get('source') !== 'live');
// Local live previews stay read-only; hosted data requires a PIN session.
const readOnly = !demo && (local || params.get('source') === 'live');
if (!demo) { $('#pin-gate').hidden = false; $('#main').hidden = true; $('.toolbar').hidden = true; }
let storage; try { storage = localStorage; } catch { /* Browser preferences optional. */ }
const prefs = new Preferences(storage);
let viewMode = prefs.value.view === 'expanded' ? 'expanded' : 'compact';
let lists = [], categories = [], store, dialogState, undoTaskId, collectionMode, refreshing = false, dataEpoch = 0;
const loaded = new Set(), errors = new Map(), expandedLists = new Set();
const categoryVisibility = new Map(), expandedHistory = new Set();

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
function listName(list) {
  const category = categories.find(item => item.id === list.category_id);
  return category ? `${category.title} · ${list.title}` : list.title;
}
function selectField(name, choices, selected) {
  const select = el('select');
  select.name = name;
  for (const [value, label] of choices) {
    const option = el('option', '', label);
    option.value = value;
    select.append(option);
  }
  select.value = selected;
  return select;
}
function destinationSelect(id) {
  return selectField('list_id', lists.filter(list => list.available && (!list.archived || list.id === id)).map(list => [list.id, listName(list)]), id);
}
function values() { return Object.fromEntries(new FormData($('#editor-form'))); }
function snapshot() { return JSON.stringify(values()); }
function taskFields(task, destination) {
  const fields = el('div', 'task-fields');
  const text = el('textarea'); text.name = 'content'; text.rows = 3; text.required = true; text.value = task?.content || '';
  const date = input('due_date', dateInputValue(task?.due_date), 'date');
  if (task?.due_date && !date.value) { date.type = 'text'; date.value = task.due_date; }
  const listSelect = destinationSelect(destination);
  const textField = field('Task', text);
  const dateField = field('Deadline', date);
  const time = input('event_time', task?.event_time?.slice(0, 5) || '', 'time');
  const timeField = field('Time (optional)', time);
  const urgency = selectField('urgency', [['', 'None'], ['1', '1 · Low'], ['2', '2 · Medium'], ['3', '3 · High']], String(task?.urgency ?? ''));
  const urgencyField = field('Urgency', urgency);
  const pins = [['', 'None'], ...LISTS.filter(list => list.fixed).map(list => [list.key, list.title])];
  const focus = selectField('focus_list', pins, task?.focus_list ?? '');
  const focusField = field('Pin to focus list', focus);
  fields.append(textField, field('List', listSelect), dateField, timeField, urgencyField, focusField);
  if (task) {
    const done = input('is_done', 'true', 'checkbox');
    done.checked = task.is_done === true;
    fields.append(field('Completed', done));
  }
  function updateFields() {
    const list = listById(listSelect.value);
    const scheduled = list?.kind === 'schedule';
    const dateLabel = scheduled ? 'Date' : 'Deadline';
    const textLabel = scheduled ? 'Event' : 'Task';
    dateField.firstChild.textContent = dateLabel;
    date.setAttribute('aria-label', dateLabel);
    date.required = scheduled;
    textField.firstChild.textContent = textLabel;
    text.setAttribute('aria-label', textLabel);
    timeField.hidden = time.disabled = !scheduled;
    urgencyField.hidden = urgency.disabled = scheduled;
    focusField.hidden = focus.disabled = scheduled || list?.fixed === true;
  }
  listSelect.onchange = updateFields;
  updateFields();
  return fields;
}
function taskMeta(task, list = listById(task.list_id)) {
  const meta = el('span', 'task-meta');
  const scheduled = list?.kind === 'schedule';
  if (!scheduled && task.urgency) meta.append(el('span', `urgency u${task.urgency}`, `U${task.urgency}`));
  if (task.due_date) {
    const date = parseDate(task.due_date), today = new Date();
    today.setHours(0, 0, 0, 0);
    let label = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }) : task.due_date;
    if (scheduled && date && /^\d{2}:\d{2}/.test(task.event_time || '')) {
      const [hours, minutes] = task.event_time.split(':').map(Number);
      date.setHours(hours, minutes);
      label += ` · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    meta.append(el('span', `deadline ${!scheduled && date && date <= today ? 'due' : ''}`, label));
  }
  return meta;
}
function taskIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = kind === 'edit' ? '<path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/>' : '<path d="M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7"/>';
  return svg;
}
function taskRow(task, list, showSource = false) {
  const row = el('li', 'task-row'); row.dataset.taskId = task.id;
  const title = el('span', 'task-title', task.content), actions = el('span', 'task-actions');
  for (const [kind, label, action] of [['edit', 'Edit', openTask], ['delete', 'Delete', openDelete]]) {
    const control = button('', () => action(currentTask(task.id) || task), 'task-action ' + kind, label + ' ' + task.content);
    control.title = label + ' task';
    control.disabled = !(writable(list) || (showSource && list.archived && !readOnly && loaded.has(list.id) && !store.pending.has(list.id) && !refreshing));
    control.append(taskIcon(kind)); actions.append(control);
  }
  if (showSource) title.append(el('small', 'task-source', `${listName(list)}${list.archived ? ' · Archived' : ''}`));
  row.append(title, taskMeta(task, list), actions); return row;
}
function openDelete(task) {
  openEditor({ title: 'Delete task', fields: el('p', 'delete-summary', task.content), task });
  $('#delete-panel').hidden = false; $('#delete-task').hidden = true; $('#editor-save').hidden = true;
  $('#keep-task').focus();
}
async function run(list, action) {
  errorAt($('#global-error'), null); errors.delete(list?.id);
  try { const promise = action(); render(); await promise; }
  catch (failure) { if (list) errors.set(list.id, failure); errorAt($('#global-error'), failure); }
  finally { render(); }
}
function buildCard(list) {
  const scheduled = list.kind === 'schedule';
  const pinnedTasks = list.fixed ? lists.filter(source => !source.fixed).flatMap(source =>
    activeTasks(store.tasks.get(source.id) || []).filter(task => task.focus_list === list.key)) : [];
  const tasks = sortTasks([...activeTasks(store.tasks.get(list.id) || []), ...pinnedTasks], scheduled ? 'schedule' : 'priority');
  const card = el('article', `list-card ${list.fixed ? `pinned ${list.key}` : ''} ${scheduled ? 'schedule-card' : ''}`); card.dataset.listId = list.id;
  const heading = el('header', 'card-heading'), h = el('h3');
  h.append(list.fixed ? el('span', 'list-title', list.title) : button(list.title, () => openRename(list), 'list-title', `Rename ${list.title}`));
  const count = el('span', 'count', list.limit ? `${tasks.length}/${list.limit}` : String(tasks.length));
  heading.append(h, count);
  const kindLabel = scheduled ? 'Schedule' : 'To-Do';
  if (!list.fixed && (scheduled || list.category_id) && list.title.toLowerCase() !== kindLabel.toLowerCase()) heading.append(el('span', 'list-kind', kindLabel));
  heading.append(button('+', () => openQuickAdd(list), 'card-add', `Add ${scheduled ? 'event' : 'task'} to ${listName(list)}`));
  heading.lastChild.disabled = !writable(list); card.append(heading);
  const rows = el('ul', 'task-list');
  const now = new Date();
  const upcoming = scheduled ? tasks.filter(task => !isPastEvent(task, now)) : tasks;
  const past = scheduled ? tasks.filter(task => isPastEvent(task, now)).reverse() : [];
  const visible = viewMode === 'compact' && !list.fixed && !expandedLists.has(list.id) ? upcoming.slice(0, 5) : upcoming;
  visible.forEach(task => rows.append(taskRow(task, listById(task.list_id) || list, task.list_id !== list.id)));
  if (visible.length) card.append(rows);
  if (upcoming.length > visible.length) card.append(button(`+${upcoming.length - visible.length} more`, () => { expandedLists.add(list.id); render(); }, 'more-link'));
  if (past.length) {
    const history = el('details', 'schedule-history');
    history.open = expandedHistory.has(list.id);
    history.append(el('summary', '', `Past events (${past.length})`));
    const pastRows = el('ul', 'task-list');
    past.forEach(task => pastRows.append(taskRow(task, list)));
    history.append(pastRows);
    history.ontoggle = () => { if (history.open) expandedHistory.add(list.id); else expandedHistory.delete(list.id); };
    card.append(history);
  }
  const failure = errors.get(list.id);
  if (failure) card.append(el('p', 'error', failure.message));
  if (!loaded.has(list.id)) card.append(el('p', 'card-state', list.available ? 'Loading…' : 'List unavailable'));
  if (!tasks.length && loaded.has(list.id)) card.classList.add('empty');
  return card;
}
function buildCategory(category, members, defaultOpen, canEdit) {
  const group = el('article', 'category');
  const open = categoryVisibility.get(category.id) ?? defaultOpen;
  const regionId = `category-${category.id}`;
  const title = button('', () => { categoryVisibility.set(category.id, !open); render(); document.getElementById(regionId + '-toggle')?.focus(); }, 'category-toggle');
  title.id = regionId + '-toggle';
  title.setAttribute('aria-label', category.title);
  title.setAttribute('aria-expanded', String(open));
  title.setAttribute('aria-controls', regionId);
  const caret = el('span', 'category-caret', open ? '▾' : '▸');
  caret.setAttribute('aria-hidden', 'true');
  title.append(caret, el('span', '', category.title));
  const heading = el('header', 'category-heading'), h = el('h3');
  h.append(title);
  heading.append(h);
  if (canEdit) {
    heading.append(button('Rename', () => openCategory(category), '', `Rename category ${category.title}`));
    heading.append(button('+ List', () => openNewList(category.id), '', `Add list to ${category.title}`));
  }
  group.append(heading);
  const content = el('div', 'category-lists');
  content.id = regionId;
  content.hidden = !open;
  content.append(...members.map(buildCard));
  if (!members.length) content.append(el('p', 'muted', 'No lists in this category yet.'));
  group.append(content);
  return group;
}
function renderComingUp() {
  const groups = upcomingTasks(lists, store.tasks);
  const soon = [...groups.Today, ...groups['Next 7 days'], ...groups.Later].slice(0, 3);
  const overdue = groups.Overdue;
  $('#coming-up').hidden = !loaded.size && refreshing;
  const results = $('#coming-results');
  results.replaceChildren(...soon.map(({ list, task }) => resultButton(list, task, true)));
  if (!soon.length) results.append(el('p', 'coming-empty muted', 'No upcoming appointments or deadlines.'));
  if (overdue.length) results.append(button(`${overdue.length} overdue ${overdue.length === 1 ? 'task' : 'tasks'}`, () => openCollection('upcoming'), 'overdue-link'));
}
function render() {
  if (!store) return;
  lists = prefs.arrange(lists);
  const activeLists = lists.filter(list => !list.archived);
  const otherLists = activeLists.filter(list => !list.fixed && !categories.some(category => category.id === list.category_id));
  const canEdit = !readOnly && !refreshing && Boolean(loaded.size);
  $('#focus-lists').replaceChildren(...activeLists.filter(list => list.fixed).map(buildCard));
  $('#other-lists').replaceChildren(...otherLists.map(buildCard));
  $('#other-count').textContent = otherLists.length ? `${otherLists.length} ${otherLists.length === 1 ? 'list' : 'lists'}` : '';
  if (!otherLists.length && canEdit) $('#other-lists').append(button('+ Add a standalone list', () => openNewList()));
  $('#categories').replaceChildren(...categories.map((category, index) => buildCategory(category, activeLists.filter(list => list.category_id === category.id), index === 0, canEdit)));
  if (!categories.length && !refreshing) $('#categories').append(el('p', 'muted category-empty', 'No categories yet.'));
  renderComingUp();
  $('#overview-count').textContent = `${activeLists.reduce((count, list) => count + activeTasks(store.tasks.get(list.id) || []).length, 0)} active tasks`;
  for (const mode of ['compact', 'expanded']) $('#' + mode).setAttribute('aria-pressed', String(viewMode === mode));
  $('#quick-add').disabled = $('#add-list').disabled = $('#add-category').disabled = !canEdit;
  renderSearch(); if ($('#collection').open) renderCollection();
}
function renderSearch() {
  if (!store) return;
  const term = $('#search').value.trim(); $('#search-section').hidden = !term;
  const results = searchTasks(lists, store.tasks, term, $('#search-completed').checked);
  const nodes = results.map(({ task, list }) => resultButton(list, task));
  $('#search-results').replaceChildren(...(nodes.length ? nodes : [el('p', 'muted', 'No matches.')]));
}
function resultButton(list, task, showType = false) {
  const result = button('', () => { if (task) openTask(currentTask(task.id) || task); else openRename(list); }, 'result');
  const kind = list.kind === 'schedule' ? 'Event' : 'Deadline';
  result.append(el('span', '', task?.content || list.title), el('small', '', `${showType ? kind + ' · ' : ''}${listName(list)}${list.archived ? ' · Archived' : ''}${task?.is_done ? ' · Completed' : ''}`));
  if (task) result.append(taskMeta(task, list)); return result;
}
function openEditor({ title, description = '', fields, saveText = 'Save', action, task }) {
  if ($('#editor').open) return;
  $('#editor-save').hidden = false;
  $('#editor-heading').textContent = title; $('#editor-description').textContent = description;
  $('#editor-fields').replaceChildren(fields); $('#editor-save').textContent = saveText;
  $('#discard-panel').hidden = $('#delete-panel').hidden = true; errorAt($('#editor-error'), null);
  $('#delete-task').hidden = !task || readOnly; $('#editor-save').disabled = readOnly;
  dialogState = { action, task, busy: false, initial: snapshot(), saveText, opener: document.activeElement };
  $('#editor').showModal(); fields.querySelector('input, textarea, select')?.focus();
}
function openQuickAdd(list) {
  const id = list?.id || (lists.find(list => list.id === prefs.value.destination && !list.archived)?.id) || LISTS[0].id;
  openEditor({ title: listById(id)?.kind === 'schedule' ? 'Add event' : 'Add task', fields: taskFields(null, id), action: async () => {
    const data = values(), destination = listById(data.list_id);
    if (!writable(destination)) throw new Error('The destination is unavailable or still loading.');
    await store.create(destination, data);
    remember('destination', destination.id);
    notify(destination.kind === 'schedule' ? 'Event added.' : 'Task added.');
  } });
}
function openTask(task) {
  const fields = taskFields(task, task.list_id), originals = Object.fromEntries(new FormData(wrapForm(fields)));
  const source = listById(task.list_id);
  openEditor({ title: source?.kind === 'schedule' ? 'Event details' : 'Task details', description: readOnly ? 'Live data · read only' : '', fields, task, action: async () => {
    const data = values(), patch = {};
    if (data.content !== originals.content) { if (!data.content.trim()) throw new Error('Enter a title before saving.'); patch.content = data.content.trim(); }
    if (data.due_date !== originals.due_date) patch.due_date = validateTask({ content: 'valid', due_date: data.due_date }).due_date;
    if ('urgency' in data && data.urgency !== originals.urgency) patch.urgency = validateTask({ content: 'valid', urgency: data.urgency }).urgency;
    if ('event_time' in data && data.event_time !== originals.event_time) patch.event_time = data.event_time || null;
    if ('focus_list' in data && data.focus_list !== originals.focus_list) patch.focus_list = data.focus_list || null;
    if (data.is_done !== originals.is_done) patch.is_done = data.is_done === 'true';
    const destination = listById(data.list_id);
    if (Object.keys(patch).length || destination?.id !== task.list_id) await store.changeTask(task, patch, destination);
    notify(destination?.kind === 'schedule' ? 'Event saved.' : 'Task saved.', patch.is_done ? task.id : null);
  } });
}
function wrapForm(fields) { const form = el('form'); form.append(fields); return form; }
function categorySelect(id) {
  return selectField('category_id', [['', 'Other Lists'], ...categories.map(category => [category.id, category.title])], id || '');
}
function openRename(list) {
  if (list.fixed) return;
  const text = input('title', list.title);
  text.required = true;
  text.maxLength = 500;
  const category = categorySelect(list.category_id);
  const fields = el('div', 'list-fields');
  fields.append(field('List title', text), field('Category', category));
  openEditor({ title: 'Edit list', fields, action: async () => {
    const title = text.value.trim();
    const categoryId = category.value || null;
    if (!title) throw new Error('Enter a list title.');
    if (categoryId === (list.category_id ?? null)) {
      if (title !== list.title) await store.rename(list, title);
    } else {
      const saved = await store.repository.updateList(list.id, { title, category_id: categoryId });
      if (saved?.id !== list.id) throw new Error('The list change could not be confirmed. Refresh and try again.');
      Object.assign(list, saved);
      if (categoryId) categoryVisibility.set(categoryId, true);
    }
    notify('List saved.');
  } });
}
function openCategory(category) {
  const text = input('title', category?.title ?? '');
  text.required = true;
  text.maxLength = 500;
  const epoch = dataEpoch;
  let uncertain = false;
  openEditor({ title: category ? 'Rename category' : 'Add category', fields: field('Category name', text), action: async () => {
    if (uncertain) throw new Error('Refresh data and look for the category before retrying.');
    const title = text.value.trim();
    if (!title) throw new Error('Enter a category name.');
    try {
      const repository = store.repository;
      const saved = category ? await repository.renameCategory(category.id, title) : await repository.createCategory(title);
      if (epoch !== dataEpoch) return;
      if (!saved?.id || saved.title !== title) throw new Error('The category change could not be confirmed.');
      if (category) Object.assign(category, saved);
      else {
        categories.push(saved);
        categoryVisibility.set(saved.id, true);
      }
      notify(category ? 'Category renamed.' : 'Category created.');
    } catch (error) {
      uncertain = !category;
      throw error;
    }
  } });
}
function openNewList(categoryId) {
  const text = input('title');
  text.required = true;
  text.maxLength = 500;
  const category = categorySelect(categoryId);
  const kind = selectField('kind', [['todo', 'To-Do List'], ['schedule', 'Schedule']], 'todo');
  const fields = el('div', 'list-fields');
  fields.append(field('List title', text), field('Category', category), field('List type', kind));
  const id = crypto.randomUUID();
  let uncertain = false;
  openEditor({ title: 'Add list', fields, action: async () => {
    if (uncertain) throw new Error('List creation was not confirmed. Close this dialog and refresh data before retrying.');
    if (!text.value.trim()) throw new Error('Enter a list title.');
    try {
      const epoch = dataEpoch;
      const list = await store.createList(id, text.value, { category_id: category.value || null, kind: kind.value });
      if (epoch !== dataEpoch) return;
      lists.push(list);
      loaded.add(list.id);
      if (list.category_id) categoryVisibility.set(list.category_id, true);
      notify('List created.');
    }
    catch (error) { uncertain = true; throw new Error(`${error.message} Refresh data and check for the list before retrying.`); }
  } });
}
function closeEditor(force = false) {
  if (!dialogState || dialogState.busy) return;
  if (!force && snapshot() !== dialogState.initial) { $('#discard-panel').hidden = false; $('#keep-editing').focus(); return; }
  const opener = dialogState.opener; $('#editor').close(); dialogState = null;
  if (opener?.isConnected) opener.focus(); else $('#quick-add').focus();
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
  $('#collection-title').textContent = collectionMode === 'upcoming' ? 'Appointments and deadlines' : 'Manage lists';
  const body = $('#collection-body'); body.replaceChildren();
  if (collectionMode === 'upcoming') {
    const groups = upcomingTasks(lists, store.tasks);
    for (const [group, rows] of Object.entries(groups)) {
      if (!rows.length) continue;
      const section = el('section', 'upcoming-group');
      section.append(el('h3', '', `${group} (${rows.length})`));
      rows.forEach(({ list, task }) => section.append(resultButton(list, task, true)));
      body.append(section);
    }
    if (!body.childElementCount) body.append(el('p', 'muted', 'No appointments or deadlines.'));
  } else {
    body.append(el('p', 'notice', demo || readOnly ? 'Order and archive are saved in this browser only. Archiving hides a list from the overview; its tasks remain stored and searchable.' : 'Order and archive sync across devices. Import this browser’s saved preferences explicitly with the button below.'));
    if (!demo && !readOnly && (prefs.value.order || prefs.value.archived)) body.append(button('Import this browser’s order and archive settings', async () => { try { const imported=prefs.importBrowserListPreferences(lists); await store.repository.saveListMetadata(imported); lists = arrangeLists(await store.repository.lists()); render(); } catch (error) { await refresh(); notify(`Could not import preferences; server state reloaded: ${error.message}`); } }));
    const ordinary = lists.filter(list => !list.fixed);
    for (const list of lists) {
      const row = el('div', 'manage-row'); row.append(button(listName(list), () => openRename(list), 'manage-title'));
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
  const epoch = dataEpoch;
  refreshing = true; $('#refresh').disabled = true; $('#quick-add').disabled = $('#add-list').disabled = $('#add-category').disabled = $('#upcoming').disabled = true; errorAt($('#global-error'), null); $('#connection-status').textContent = 'Loading…';
  try {
    if (!store) {
      let repository;
      if (demo) repository = createDemoRepository();
      else {
        repository = createPinRepository({ readOnly });
      }
      const lock = navigator.locks ? (id, action) => navigator.locks.request(`todo-list:${id}`, action) : undefined;
      store = new TaskStore(repository, { lock });
    }
    const activeStore = store;
    const [rows, categoryRows] = await Promise.all([activeStore.repository.lists(), activeStore.repository.categories()]);
    if (epoch !== dataEpoch) return;
    categories = categoryRows;
    const next = arrangeLists(rows);
    next.forEach(list => { if (list.available) list.syncedMetadata = !demo && rows.some(row => Object.hasOwn(row, 'is_archived')); });
    lists = next.map(list => Object.assign(listById(list.id) || {}, list));
    render();
    await Promise.all(lists.filter(list => list.available).map(async list => {
      try { await activeStore.load(list.id); if (epoch === dataEpoch) { loaded.add(list.id); errors.delete(list.id); } }
      catch (failure) { if (epoch === dataEpoch) errors.set(list.id, failure); }
    }));
    if (epoch !== dataEpoch) return;
    $('#connection-status').textContent = errors.size ? 'Some lists failed to load. Refresh to retry.' : demo ? 'Demo ready · in-memory sample data' : readOnly ? 'Live preview · read only' : 'Live data · synced';
    if (errors.size) errorAt($('#global-error'), 'Some lists could not load. Refresh data from the menu to retry.');
  } catch (failure) { if (epoch === dataEpoch) { errorAt($('#global-error'), `Could not load lists: ${failure.message}`); $('#connection-status').textContent = 'Connection failed'; } }
  finally { if (epoch === dataEpoch) { refreshing = false; $('#refresh').disabled = false; $('#upcoming').disabled = !loaded.size; render(); } }
}
$('#editor-form').addEventListener('submit', event => { event.preventDefault(); saveEditor(); });
$('#editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
for (const id of ['editor-close', 'editor-cancel']) $('#' + id).addEventListener('click', () => closeEditor());
$('#discard-changes').onclick = () => closeEditor(true);
$('#keep-editing').onclick = () => { $('#discard-panel').hidden = true; $('#editor-fields').querySelector('input,textarea')?.focus(); };
$('#delete-task').onclick = () => { $('#delete-panel').hidden = false; $('#keep-task').focus(); };
$('#keep-task').onclick = () => { if ($('#editor-save').hidden) closeEditor(true); else $('#delete-panel').hidden = true; };
$('#confirm-delete').onclick = () => saveEditor(true);
$('#close-collection').onclick = () => $('#collection').close();
$('#quick-add').onclick = () => openQuickAdd();
$('#add-list').onclick = () => openNewList();
$('#add-category').onclick = () => openCategory();
$('#view-schedule').onclick = $('#upcoming').onclick = () => openCollection('upcoming');
$('#manage-lists').onclick = () => { $('.menu').open = false; openCollection('manage'); };
$('#refresh').onclick = () => { $('.menu').open = false; refresh(); };
$('#search').addEventListener('input', renderSearch); $('#search-completed').onchange = renderSearch;
for (const mode of ['compact', 'expanded']) $('#' + mode).onclick = () => { viewMode = mode; remember('view', mode); render(); };
$('#dismiss-notification').onclick = () => { $('#notification').hidden = true; undoTaskId = null; };
$('#undo').onclick = async () => { const task = currentTask(undoTaskId); if (!task) { notify('Task no longer available. Refresh data.'); return; } await run(listById(task.list_id), async () => { await store.setDone(task, false, listById(task.list_id)); notify('Completion undone.'); }); };
window.addEventListener('beforeunload', event => { if (store?.pending.size || dialogState?.busy || (dialogState && snapshot() !== dialogState.initial)) { event.preventDefault(); event.returnValue = ''; } });
$('#mode-badge').textContent = demo ? 'DEMO' : 'LIVE';
$('#mode-notice').textContent = demo ? 'Sample data · resets on reload' : readOnly ? 'Read-only local live preview' : 'Private lists';

let expiryTimer;
function clearSession() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* optional storage */ } }
function resetLocked() {
  dataEpoch++; refreshing = false; errors.clear(); expandedLists.clear(); expandedHistory.clear(); categoryVisibility.clear();
  clearTimeout(expiryTimer); clearSession(); store?.tasks.clear(); store = undefined; lists = []; categories = []; loaded.clear();
  for (const selector of ['#focus-lists','#other-lists','#categories','#coming-results','#search-results','#collection-body','#editor-fields']) $(selector).replaceChildren();
  for (const selector of ['#collection','#editor']) if ($(selector).open) $(selector).close();
  dialogState = undefined; $('#notification').hidden = true; $('#search').value = '';
  $('#main').hidden = $('.toolbar').hidden = true; $('#pin-gate').hidden = false; $('#pin-input').value = ''; $('#pin-input').focus();
}
function openSession(session) {
  const remaining = Date.parse(session.expiresAt) - Date.now();
  if (!session.token || !Number.isFinite(remaining) || remaining <= 0) throw new Error('Session expired. Enter your PIN again.');
  // Refuse to unlock if secure per-tab storage is unavailable.
  sessionStorage.setItem(TOKEN_KEY,session.token);
  expiryTimer = setTimeout(resetLocked, Math.min(remaining, 2147483647));
  $('#pin-gate').hidden = true; $('#main').hidden = $('.toolbar').hidden = false; $('#pin-lock').hidden = false;
  refresh();
}
window.addEventListener('todo-session-expired', resetLocked);
$('#pin-lock').onclick = async () => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  // Hide immediately, even if revocation fails offline. The server still expires it.
  resetLocked();
  try { await pinRequest('lock',{},token); } catch { /* already locked locally */ }
};
$('#pin-form').onsubmit = async event => {
  event.preventDefault(); $('#pin-submit').disabled = true; errorAt($('#pin-error'),null);
  try {
    const pin = $('#pin-input').value; $('#pin-input').value = '';
    openSession(await pinRequest('unlock',{pin}));
  } catch (error) { errorAt($('#pin-error'),error); $('#pin-input').focus(); }
  finally { $('#pin-submit').disabled = false; }
};
if (demo) refresh();
else {
  let token; try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* show gate */ }
  if (token) {
    $('#pin-submit').disabled = true;
    pinRequest('session',{},token).then(session => openSession({...session,token})).catch(error => { resetLocked(); errorAt($('#pin-error'),error); }).finally(() => { $('#pin-submit').disabled = false; });
  } else $('#pin-input').focus();
}
