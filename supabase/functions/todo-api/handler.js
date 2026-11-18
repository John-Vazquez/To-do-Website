const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g) || [], b => parseInt(b, 16));
export async function digest(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
export async function verifyPin(pin, saved) {
  const [kind, iterations, salt, expected] = (saved || '').split('$');
  if (kind !== 'pbkdf2-sha256' || iterations !== '600000' || !/^[a-f0-9]{64}$/.test(salt || '') || !/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('PIN configuration invalid');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const actual = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: 600000 }, key, 256));
  let mismatch = 0; for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = message => { throw new HttpError(400, message); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : bad('Invalid identifier.');
const title = value => typeof value === 'string' && value.trim() && value.length <= 500 ? value.trim() : bad('Enter a title of up to 500 characters.');
export function taskPatch(value, creating = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Invalid task.');
  const patch = {};
  for (const key of Object.keys(value)) {
    if (!['content','due_date','urgency','list_id','is_done','event_time','focus_list'].includes(key)) bad('Unsupported task field.');
    const v = value[key];
    if (key === 'content') { if (typeof v !== 'string' || !v.trim() || v.length > 20000) bad('Invalid task text.'); patch[key] = v.trim(); }
    if (key === 'due_date') { if (v !== null && (typeof v !== 'string' || v.length > 200)) bad('Invalid deadline.'); patch[key] = v; }
    if (key === 'urgency') { if (v !== null && ![1,2,3].includes(v)) bad('Invalid urgency.'); patch[key] = v; }
    if (key === 'is_done') { if (typeof v !== 'boolean') bad('Invalid completion value.'); patch[key] = v; }
    if (key === 'list_id') patch[key] = uuid(v);
    if (key === 'event_time') { if (v !== null && (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(v))) bad('Choose a valid time.'); patch[key] = v; }
    if (key === 'focus_list') { if (v !== null && !['doing','must'].includes(v)) bad('Invalid focus list.'); patch[key] = v; }
  }
  if (creating && !patch.content) bad('Enter a task.');
  if (!Object.keys(patch).length) bad('No changes supplied.');
  return patch;
}
export function listPatch(value, creating = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Invalid list.');
  const patch = {};
  for (const [key,v] of Object.entries(value)) {
    if (key === 'title') patch.title = title(v);
    else if (key === 'category_id') patch.category_id = v === null ? null : uuid(v);
    else if (key === 'kind' && creating && ['todo','schedule'].includes(v)) patch.kind = v;
    else bad('Unsupported list field.');
  }
  if (!creating && !Object.keys(patch).length) bad('No changes supplied.');
  return patch;
}
export function createHandler({ env, fetcher = fetch, now = () => Date.now() }) {
  const db = async (path, { method = 'GET', body, single = false } = {}) => {
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!key || !env('SUPABASE_URL')) throw new Error('Server configuration missing');
    const response = await fetcher(`${env('SUPABASE_URL')}/rest/v1/${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(single ? { Accept: 'application/vnd.pgrst.object+json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      // Only bounded application constraint errors are safe to show; no SQL details.
      if (result?.code === 'P0001') throw new HttpError(409, 'This change is blocked by list capacity, archive, or pinned-list rules.');
      if (result?.code === 'PGRST116') throw new HttpError(409, 'Record changed or no longer exists. Refresh and try again.');
      if (result?.code === '23503') throw new HttpError(409, 'The selected category or list no longer exists. Refresh and try again.');
      if (result?.code === '23514' && ['Schedule entries require a valid date.','Schedule entries cannot be added to focus lists.'].includes(result.message)) throw new HttpError(400, result.message);
      throw new Error('Database request failed');
    }
    return result;
  };
  const pages = async path => {
    const rows = []; for (let offset = 0; ; offset += 500) { const page = await db(`${path}&limit=500&offset=${offset}`); rows.push(...page); if (page.length < 500) return rows; }
  };
  const data = async (operation, args) => {
    if (!Array.isArray(args) || args.length > 3) bad('Invalid arguments.');
    const [a,b,c] = args;
    const taskFilter = task => `id=eq.${uuid(task?.id)}&list_id=eq.${uuid(task?.list_id)}`;
    const listColumns = 'id,title,is_archived,sort_order,category_id,kind';
    const updateList = (id, patch) => db(`lists?id=eq.${uuid(id)}&select=${listColumns}`, { method: 'PATCH', body: patch, single: true });
    switch (operation) {
      case 'lists': return pages(`lists?select=${listColumns}&order=sort_order.asc.nullslast,id.asc`);
      case 'categories': return pages('categories?select=id,title&order=title.asc,id.asc');
      case 'createCategory': return db('categories?select=id,title', { method: 'POST', body: { title: title(a) }, single: true });
      case 'renameCategory': return db(`categories?id=eq.${uuid(a)}&select=id,title`, { method: 'PATCH', body: { title: title(b) }, single: true });
      case 'focusTasks': if (!['doing','must'].includes(a)) bad('Invalid focus list.'); return pages(`tasks?select=*&focus_list=eq.${a}&order=id.asc`);
      case 'tasks': return pages(`tasks?select=*&list_id=eq.${uuid(a)}&order=id.asc`);
      case 'create': return db('tasks?select=*', { method: 'POST', body: { ...taskPatch(b,true), list_id: uuid(a) }, single: true });
      case 'update': return db(`tasks?${taskFilter(a)}&select=*`, { method: 'PATCH', body: taskPatch(b), single: true });
      case 'remove': return db(`tasks?${taskFilter(a)}&select=id`, { method: 'DELETE', single: true });
      case 'rename': return updateList(a, { title: title(b) });
      case 'updateList': return updateList(a, listPatch(b));
      case 'createList': return db(`lists?select=${listColumns}`, { method: 'POST', body: { ...listPatch(c ?? {},true), id: uuid(a), title: title(b) }, single: true });
      case 'saveListArchive': if (typeof b !== 'boolean') bad('Invalid archive value.'); await updateList(a?.id, { is_archived: b }); return null;
      case 'saveListOrder': case 'saveListMetadata': {
        if (!Array.isArray(a) || a.length > 500) bad('Invalid list order.');
        // Validate the whole request before the first write. Partial network failures
        // retain existing client reconciliation behavior.
        const patches = a.map((row,i) => ({ id: uuid(row.id), patch: { sort_order: row.fixed ? null : i, ...(operation === 'saveListMetadata' ? { is_archived: !!row.archived } : {}) } }));
        for (const row of patches) await updateList(row.id, row.patch); return null;
      }
      default: bad('Unsupported operation.');
    }
  };
  return async request => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'Use POST.' },405);
    try {
      // Bounded streaming read prevents chunked requests bypassing size limits.
      const reader = request.body?.getReader(); let text = '', size = 0;
      if (reader) { const decoder = new TextDecoder(); while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); throw new HttpError(413,'Request too large.'); } text += decoder.decode(value,{stream:true}); } text += decoder.decode(); }
      let body; try { body = JSON.parse(text); } catch { bad('Invalid JSON.'); }
      if (!body || typeof body !== 'object') bad('Invalid request.');
      const pinHash = env('TODO_PIN_HASH');
      if (!pinHash) throw new HttpError(503,'PIN access is not configured yet.');
      const version = await digest(pinHash);
      if (body.action === 'unlock') {
        // Shared atomic counter, never a spoofable client IP or in-memory limit.
        const allowed = await db('rpc/todo_pin_attempt', { method: 'POST', body: {} });
        if (!allowed) throw new HttpError(429,'Too many attempts. Wait five minutes and try again.');
        if (!/^\d{4}$/.test(body.pin || '') || typeof body.pin !== 'string' || !await verifyPin(body.pin,pinHash)) throw new HttpError(401,'Incorrect PIN.');
        const token = hex(crypto.getRandomValues(new Uint8Array(32))), expiresAt = new Date(now()+8*60*60*1000).toISOString();
        await db(`todo_pin_sessions?expires_at=lt.${encodeURIComponent(new Date(now()).toISOString())}`, { method: 'DELETE' });
        await db('todo_pin_sessions', { method: 'POST', body: { token_hash: await digest(token), pin_version: version, expires_at: expiresAt } });
        return reply({ token, expiresAt });
      }
      const token = request.headers.get('Authorization')?.replace(/^Bearer /,'');
      if (!/^[a-f0-9]{64}$/.test(token || '')) throw new HttpError(401,'Unlock with your PIN.');
      const hash = await digest(token);
      const sessions = await db(`todo_pin_sessions?token_hash=eq.${hash}&pin_version=eq.${version}&expires_at=gt.${encodeURIComponent(new Date(now()).toISOString())}&select=expires_at`);
      if (!sessions.length) throw new HttpError(401,'Your session expired. Enter your PIN again.');
      if (body.action === 'lock') { await db(`todo_pin_sessions?token_hash=eq.${hash}`, { method: 'DELETE' }); return reply({ locked: true }); }
      if (body.action === 'session') return reply({ expiresAt: sessions[0].expires_at });
      if (body.action === 'data') return reply({ data: await data(body.operation,body.args) });
      bad('Unsupported action.');
    } catch (error) { return reply({ error: error instanceof HttpError ? error.message : 'Service unavailable. Try again later.' }, error instanceof HttpError ? error.status : 503); }
  };
}
