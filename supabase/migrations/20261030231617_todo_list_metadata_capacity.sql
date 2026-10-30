-- Applied to To-Do project walsvybskelqhgvpdagj, migration version 20261030231617.
-- No existing tasks, list titles, IDs or completion flags are rewritten.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='is_done' and data_type='boolean') then
    raise exception 'Expected tasks.is_done boolean; inspect live semantics first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='list_id' and data_type='uuid') then
    raise exception 'Expected tasks.list_id uuid';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='lists' and column_name='id' and data_type='uuid') then
    raise exception 'Expected lists.id uuid';
  end if;
end $$;

alter table public.lists add column if not exists is_archived boolean not null default false;
alter table public.lists add column if not exists sort_order integer;
-- A row-version write makes a concurrent writer in REPEATABLE READ fail with
-- PostgreSQL's serialization error instead of checking a stale task snapshot.
alter table public.lists add column if not exists capacity_revision bigint not null default 0;
create index if not exists tasks_list_id_idx on public.tasks (list_id);

create function public.todo_guard_list() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id then raise exception 'List identity cannot change'; end if;
  if old.id in ('b093c6d8-9ed6-41ec-9667-2467066b84d3'::uuid,'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7'::uuid) then
    if new.is_archived or new.title is distinct from old.title then raise exception 'Pinned lists cannot be archived or renamed'; end if;
  end if;
  return new;
end $$;
create trigger todo_guard_list before update on public.lists for each row execute function public.todo_guard_list();

create function public.todo_guard_task() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare entering boolean; archived boolean; destination_capacity integer;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id) then raise exception 'Task identity cannot change'; end if;
  -- Historical rows may intentionally have no list. Keep them editable and
  -- preserve that nullable contract; new app-created tasks always choose a list.
  if new.list_id is null then return new; end if;
  -- Acquire parent locks in stable order for moves; serialize capacity writers.
  if tg_op = 'UPDATE' then
    perform id from public.lists where id in (old.list_id,new.list_id) order by id for update;
    entering := old.list_id is distinct from new.list_id or (old.is_done is true and new.is_done is not true);
  else
    perform id from public.lists where id = new.list_id for update;
    entering := true;
  end if;
  select is_archived into archived from public.lists where id = new.list_id;
  if not found then raise exception 'Destination list is unavailable'; end if;
  if entering and archived then raise exception 'Destination list is archived'; end if;
  if entering and new.is_done is not true then
    select case when id = 'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7'::uuid then 3 else max_items end
      into destination_capacity from public.lists where id = new.list_id;
    if destination_capacity is not null then
      update public.lists set capacity_revision = capacity_revision + 1 where id = new.list_id;
    end if;
    if destination_capacity is not null and
       (select count(*) from public.tasks where list_id = new.list_id and is_done is not true and id <> new.id) >= destination_capacity then
      raise exception 'Destination list has reached its active task limit';
    end if;
  end if;
  return new;
end $$;
create trigger todo_guard_task before insert or update on public.tasks for each row execute function public.todo_guard_task();
revoke all on function public.todo_guard_list(), public.todo_guard_task() from public, anon, authenticated;

-- Lists may be created, renamed, ordered and archived, but are never deleted.
-- Keep current public task CRUD and list read/write behavior while removing
-- table-wide powers that the app does not use.
revoke delete, truncate, references, trigger on public.lists from public, anon, authenticated;
revoke truncate, references, trigger on public.tasks from public, anon, authenticated;
