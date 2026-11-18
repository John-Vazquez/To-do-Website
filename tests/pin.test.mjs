import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler, digest, verifyPin, taskPatch } from '../supabase/functions/todo-api/handler.js';
import { makePinHash, uploadPinHash } from '../scripts/set-pin.mjs';

test('PIN hashes preserve leading zeroes; wrong PINs and malformed hashes are rejected', async () => {
  const hash = await makePinHash('0123');
  assert.ok(!hash.includes('0123'));
  assert.equal(await verifyPin('0123',hash),true);
  assert.equal(await verifyPin('0124',hash),false);
  await assert.rejects(verifyPin('0123','broken'));
  await assert.rejects(makePinHash('12345'));
  await uploadPinHash(hash,'private-token',async (url,options) => {
    assert.equal(options.method,'POST');
    assert.equal(JSON.parse(options.body)[0].value,hash);
    return new Response('[]');
  });
});

test('API fails closed, throttles, verifies session expiry/version, revokes and scopes task data', async () => {
  const pinHash = await makePinHash('0456'); let configured = false, allowed = true, session;
  let clock = Date.now(), calls = [];
  const handler = createHandler({ env: name => ({ TODO_PIN_HASH: configured ? pinHash : undefined, SUPABASE_URL:'https://db.example', SUPABASE_SERVICE_ROLE_KEY:'server-only' }[name]), now: () => clock,
    fetcher: async (url,options) => {
      const path = url.split('/rest/v1/')[1]; calls.push({path,options});
      if (path === 'rpc/todo_pin_attempt') return Response.json(allowed);
      if (path === 'todo_pin_sessions') { session = JSON.parse(options.body); return Response.json([session]); }
      if (path.startsWith('todo_pin_sessions?')) {
        if (options.method === 'DELETE') { if (path.includes('token_hash')) session = undefined; return Response.json([]); }
        return Response.json(session && path.includes(session.token_hash) && path.includes(session.pin_version) && Date.parse(session.expires_at) > clock ? [session] : []);
      }
      return Response.json([{id:'record'}]);
    } });
  const post = (body,token) => handler(new Request('https://api.example',{method:'POST',headers: token ? {Authorization:`Bearer ${token}`} : {},body:JSON.stringify(body)}));
  assert.equal((await post({action:'unlock',pin:'0456'})).status,503);
  assert.equal(calls.length,0); configured = true;
  assert.equal((await post({action:'data',operation:'lists',args:[]})).status,401);
  assert.equal((await post({action:'unlock',pin:'9999'})).status,401);
  allowed = false;
  assert.equal((await post({action:'unlock',pin:'0456'})).status,429); allowed = true;
  const unlocked = await (await post({action:'unlock',pin:'0456'})).json();
  assert.match(unlocked.token,/^[a-f0-9]{64}$/); assert.equal(session.token_hash,await digest(unlocked.token));
  assert.notEqual(session.token_hash,unlocked.token);
  assert.equal((await post({action:'session'},unlocked.token)).status,200);
  assert.equal((await post({action:'data',operation:'lists',args:[]},unlocked.token)).status,200);
  assert.equal((await post({action:'data',operation:'arbitrarySQL',args:[]},unlocked.token)).status,400);
  assert.equal((await post({action:'data',operation:'tasks',args:['bad&select=secret']},unlocked.token)).status,400);
  session.pin_version = 'old'; assert.equal((await post({action:'session'},unlocked.token)).status,401);
  session.pin_version = await digest(pinHash); clock += 9*60*60*1000;
  assert.equal((await post({action:'session'},unlocked.token)).status,401);
  clock -= 9*60*60*1000;
  assert.equal((await post({action:'lock'},unlocked.token)).status,200);
  assert.equal((await post({action:'session'},unlocked.token)).status,401);
  assert.throws(() => taskPatch({admin:true}));
  assert.throws(() => taskPatch({is_done:'true'}));
});

test('PIN migration denies browser roles, serializes shared throttle and retains task records', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create table lists(id uuid primary key,title text); create table tasks(id uuid primary key,content text);
      insert into tasks values(gen_random_uuid(),'preserved');
      grant all on lists,tasks to anon,authenticated;
      alter table tasks enable row level security;
      create policy legacy_public on tasks using(true);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261118221020_todo_pin_access.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select content from tasks')).rows[0].content,'preserved');
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of ['lists','tasks','todo_pin_sessions','todo_pin_attempts']) await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
      await assert.rejects(db.query('select todo_pin_attempt()'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    for(let i=0;i<5;i++) assert.equal((await db.query('select todo_pin_attempt() as allowed')).rows[0].allowed,true);
    assert.equal((await db.query('select todo_pin_attempt() as allowed')).rows[0].allowed,false);
    await db.exec("update todo_pin_attempts set window_start=now()-interval '6 minutes'");
    assert.equal((await db.query('select todo_pin_attempt() as allowed')).rows[0].allowed,true);
    assert.equal((await db.query('select * from tasks')).rows.length,1);
  } finally { await db.close(); }
});
