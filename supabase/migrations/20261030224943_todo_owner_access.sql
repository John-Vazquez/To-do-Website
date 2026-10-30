-- PREPARED ONLY. Requires a verified owner sign-in and recovery path FIRST.
-- Apply in a transaction with SET LOCAL todo.owner_id = '<verified Auth UUID>'.
-- Review existing policies/grants/triggers before replacing these policies.
do $$
declare owner_uuid uuid := nullif(current_setting('todo.owner_id', true),'')::uuid;
begin
  if owner_uuid is null or not exists (select 1 from auth.users where id=owner_uuid) then
    raise exception 'Set todo.owner_id to the verified existing Auth user UUID';
  end if;
end $$;

create schema todo_private;
revoke all on schema todo_private from public, anon;
grant usage on schema todo_private to authenticated;
create table todo_private.owner (user_id uuid primary key references auth.users(id));
insert into todo_private.owner values (current_setting('todo.owner_id')::uuid);
alter table todo_private.owner enable row level security;
revoke all on todo_private.owner from public, anon, authenticated;
grant select on todo_private.owner to authenticated;
create policy own_membership on todo_private.owner for select to authenticated using (user_id=(select auth.uid()));

create function public.todo_is_owner() returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from todo_private.owner where user_id=(select auth.uid()));
$$;
revoke all on function public.todo_is_owner() from public, anon;
grant execute on function public.todo_is_owner() to authenticated;

-- Permissive policies are ORed: leaving legacy policies could retain the leak.
do $$
declare policy_row record;
begin
  for policy_row in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('lists','tasks') loop
    execute format('drop policy %I on %I.%I',policy_row.policyname,policy_row.schemaname,policy_row.tablename);
  end loop;
end $$;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;
revoke all on public.lists, public.tasks from public, anon;
revoke all on public.lists, public.tasks from authenticated;
grant select, insert, update on public.lists to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
create policy owner_lists_select on public.lists for select to authenticated using ((select public.todo_is_owner()));
create policy owner_lists_insert on public.lists for insert to authenticated with check ((select public.todo_is_owner()));
create policy owner_lists_update on public.lists for update to authenticated using ((select public.todo_is_owner())) with check ((select public.todo_is_owner()));
create policy owner_tasks_select on public.tasks for select to authenticated using ((select public.todo_is_owner()));
create policy owner_tasks_insert on public.tasks for insert to authenticated with check ((select public.todo_is_owner()));
create policy owner_tasks_update on public.tasks for update to authenticated using ((select public.todo_is_owner())) with check ((select public.todo_is_owner()));
create policy owner_tasks_delete on public.tasks for delete to authenticated using ((select public.todo_is_owner()));
