import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const runtime = process.env.TODO_PG_RUNTIME;
if (!runtime) throw new Error('Set TODO_PG_RUNTIME to an isolated folder with pg and @embedded-postgres/windows-x64 installed.');
const { pg_ctl, initdb } = await import(pathToFileURL(path.join(runtime,'node_modules/@embedded-postgres/windows-x64/dist/index.js')));
const {default: pg} = await import(pathToFileURL(path.join(runtime,'node_modules/pg/lib/index.js')));
const root=mkdtempSync(path.join(tmpdir(),'todo-capacity-pg-'));
const data=path.join(root,'data'), log=path.join(root,'postgres.log'), port=55439;
let server;
try {
 const init=spawnSync(initdb,['-D',data,'-A','trust','-U','postgres','--no-locale','-E','UTF8'],{encoding:'utf8',stdio:'ignore'});
 if(init.status!==0) throw new Error('initdb: '+init.stderr);
 server=spawnSync(pg_ctl,['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'start'],{encoding:'utf8',stdio:'ignore'});
 if(server.status!==0) throw new Error('pg_ctl start: '+server.stderr+' '+server.stdout);
 const pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',max:4});
 try {
  await pool.query(`create role anon; create role authenticated; create table public.lists(id uuid primary key,title text not null,type text,max_items integer,created_at timestamptz default now());
    create table public.tasks(id uuid primary key default gen_random_uuid(),list_id uuid references lists(id) on delete cascade,content text not null,due_date text,urgency smallint check(urgency is null or urgency between 1 and 3),is_done boolean default false,created_at timestamptz default now());
    insert into lists(id,title,type,max_items) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','Must Do Today','must',3),('32dd9a59-8fa4-45f3-a20f-e801549179d1','Other','other',50);`);
  const {readFile}=await import('node:fs/promises');
  await pool.query(await readFile(new URL('../supabase/migrations/20261030231617_todo_list_metadata_capacity.sql',import.meta.url),'utf8'));
  const a=await pool.connect(), b=await pool.connect();
  try {
   await pool.query(`insert into tasks(list_id,content) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','base1'),('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','base2')`);
   await a.query('begin isolation level repeatable read'); await b.query('begin isolation level repeatable read');
   await a.query(`select count(*) from tasks`); await b.query(`select count(*) from tasks`);
   await a.query(`insert into tasks(list_id,content) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','race-a')`);
   let settled=false; const blocked=b.query(`insert into tasks(list_id,content) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','race-b')`).then(()=>({ok:true}),e=>({ok:false,code:e.code,message:e.message})).then(x=>(settled=true,x));
   await new Promise(r=>setTimeout(r,300));
   await a.query('commit'); const second=await blocked;
   if(second.ok || second.code!=='40001') throw new Error('repeatable-read second writer should serialize-fail: '+JSON.stringify(second));
   await b.query('rollback');
   let count=+(await pool.query(`select count(*) from tasks where list_id='df9db72b-b8ee-4178-bc1d-e5f55c9dcca7' and is_done is not true`)).rows[0].count;
   if(count!==3) throw new Error('repeatable-read count '+count);
   console.log('repeatable-read: one write committed, second failed 40001, active count='+count);
   await pool.query('delete from tasks');
   await pool.query(`insert into tasks(list_id,content) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','base1'),('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','base2')`);
   await a.query('begin isolation level read committed'); await b.query('begin isolation level read committed');
   await a.query(`insert into tasks(list_id,content) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','race-a')`);
   const blockedRC=b.query(`insert into tasks(list_id,content) values ('df9db72b-b8ee-4178-bc1d-e5f55c9dcca7','race-b')`).then(()=>({ok:true}),e=>({ok:false,code:e.code,message:e.message}));
   await new Promise(r=>setTimeout(r,300)); await a.query('commit'); const rc=await blockedRC;
   if(rc.ok || !/active task limit/.test(rc.message)) throw new Error('read-committed second writer should reject capacity: '+JSON.stringify(rc));
   await b.query('rollback');
   count=+(await pool.query(`select count(*) from tasks where list_id='df9db72b-b8ee-4178-bc1d-e5f55c9dcca7' and is_done is not true`)).rows[0].count;
   if(count!==3) throw new Error('read committed count '+count);
   console.log('read-committed: one write committed, second rejected by trigger, active count='+count);
  } finally {a.release();b.release();await pool.end();}
 } finally {spawnSync(pg_ctl,['-D',data,'-m','fast','stop'],{encoding:'utf8',stdio:'ignore'});}
} finally {
 const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(tmpdir()) || !path.basename(resolved).startsWith('todo-capacity-pg-')) throw new Error('Unsafe cleanup target');
 rmSync(resolved,{recursive:true,force:true});
}
