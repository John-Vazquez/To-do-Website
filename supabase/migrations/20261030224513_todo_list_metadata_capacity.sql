-- PREPARED ONLY. Verify the live schema, policies and triggers before applying.
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
declare entering boolean; archived boolean;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id) then raise exception 'Task identity cannot change'; end if;
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
  if entering and new.is_done is not true and new.list_id = 'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7'::uuid then
    if (select count(*) from public.tasks where list_id = new.list_id and is_done is not true and id <> new.id) >= 3 then
      raise exception 'Must Do Today is limited to 3 active tasks';
    end if;
  end if;
  return new;
end $$;
create trigger todo_guard_task before insert or update on public.tasks for each row execute function public.todo_guard_task();
revoke all on function public.todo_guard_list(), public.todo_guard_task() from public, anon, authenticated;
