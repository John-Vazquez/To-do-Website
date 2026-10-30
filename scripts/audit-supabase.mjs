// Read-only probe. Never fetch task contents or perform mutations.
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../todo-config.js', import.meta.url), 'utf8').catch(() => readFile(new URL('../todo.js', import.meta.url), 'utf8'));
const url = source.match(/(?:supabaseUrl|SUPABASE_URL)\s*=\s*"([^"]+)/)[1];
const key = source.match(/(?:supabaseKey|SUPABASE_KEY)\s*=\s*"([^"]+)/)[1];
for (const path of ['/rest/v1/', '/rest/v1/lists?select=id,title', '/rest/v1/tasks?select=*&limit=1']) {
  const response = await fetch(url + path, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } });
  const body = await response.json();
  const result = path === '/rest/v1/' ? { definitions: body.definitions, paths: Object.keys(body.paths || {}), error: body.message }
    : path.includes('/tasks?') && Array.isArray(body) ? { returned: body.length, columns: body[0] ? Object.fromEntries(Object.entries(body[0]).map(([name, value]) => [name, value === null ? 'null' : typeof value])) : {} } : body;
  console.log(JSON.stringify({ path, status: response.status, count: response.headers.get('content-range'), result }, null, 2));
}
