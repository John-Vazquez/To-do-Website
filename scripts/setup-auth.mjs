import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as setPin, readHidden } from './set-pin.mjs';
const project = 'walsvybskelqhgvpdagj';
let token;
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  if (!response.ok) {
    const error = new Error(`Cannot configure the To-Do project (HTTP ${response.status}). Check that this token can manage project ${project}. No response details printed.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
try {
  const useEnvironment = process.env.SUPABASE_ACCESS_TOKEN && !process.argv.includes('--prompt-token');
  if (useEnvironment) console.log('Using SUPABASE_ACCESS_TOKEN from this terminal environment.');
  token = useEnvironment ? process.env.SUPABASE_ACCESS_TOKEN : await readHidden('Supabase personal access token for the To-Do project (hidden): ');
  const preflight = `select to_regclass('public.todo_pin_sessions') is not null as configured,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='lists' and column_name='is_archived') and
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='is_done') as compatible`;
  let rows;
  try { rows = await query(preflight); }
  catch (error) {
    if (!useEnvironment || ![401,403].includes(error.status)) throw error;
    console.log('The environment token cannot access this project. No changes made. Enter a token from the account that owns the To-Do project.');
    token = await readHidden('Replacement Supabase personal access token (hidden): ');
    rows = await query(preflight);
  }
  if (!rows[0]?.compatible) throw new Error('Expected To-Do schema is missing. Stop and inspect the project before activation.');
  const surfaces = await query(`select
    exists(select 1 from pg_views where schemaname='public' and definition ~* '\\m(tasks|lists)\\M') as related_views,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prosrc ~* '\\m(tasks|lists)\\M') as privileged_helpers`);
  if (surfaces[0]?.related_views || surfaces[0]?.privileged_helpers) throw new Error('Additional task/list views or privileged functions need a security review before activation. No database changes made.');
  console.log('Deploying the PIN API to the To-Do project…');
  await new Promise((resolve,reject) => {
    const args = ['functions','deploy','todo-api','--project-ref',project,'--no-verify-jwt','--use-api'];
    // Windows npm installs provide a .cmd shim. Keep this command constant;
    // credentials travel only through the child environment, never shell text.
    const command = process.platform === 'win32' ? 'cmd.exe' : 'supabase';
    const commandArgs = process.platform === 'win32' ? ['/d','/s','/c',`supabase.cmd ${args.join(' ')}`] : args;
    const child = spawn(command, commandArgs, { cwd: fileURLToPath(new URL('../',import.meta.url)), windowsHide: true, stdio: 'inherit', env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, shell: false });
    child.on('error',() => reject(new Error('Install the Supabase CLI before running setup.')));
    child.on('exit',code => code === 0 ? resolve() : reject(new Error('API deployment failed. Database access has not been changed.')));
  });
  if (!rows[0].configured) {
    const migration = await readFile(new URL('../supabase/migrations/20261118221020_todo_pin_access.sql',import.meta.url),'utf8');
    await query(`begin; ${migration}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('20261118221020','todo_pin_access',array[${"'" + migration.replaceAll("'","''") + "'"}]); commit;`);
  }
  const check = await query(`select has_table_privilege('anon','public.tasks','select') as public_tasks,
    has_table_privilege('authenticated','public.lists','select') as public_lists,
    has_function_privilege('anon','public.todo_pin_attempt()','execute') as public_unlock_counter`);
  if (Object.values(check[0] || {}).some(Boolean)) throw new Error('Access restrictions could not be verified. Stop before publishing.');
  console.log('API deployed and direct database access locked. Set your PIN now.');
  await setPin(token);
  console.log('Backend setup complete. Publish the updated website files through your normal GitHub Pages workflow.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
