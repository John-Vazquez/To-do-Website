-- Apply manually before deploying the category/schedule client and todo-api.
-- Existing list/task identities, deadlines and completion states are preserved.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 500)
);
alter table public.categories enable row level security;
revoke all on public.categories from public, anon, authenticated;
grant select,insert,update on public.categories to service_role;

alter table public.lists add column category_id uuid references public.categories(id);
alter table public.lists add column kind text not null default 'todo' check (kind in ('todo','schedule'));
create index lists_category_id_idx on public.lists(category_id);
alter table public.tasks add column event_time time without time zone;
alter table public.tasks add column focus_list text check (focus_list in ('doing','must'));
create index tasks_focus_list_idx on public.tasks(focus_list) where focus_list is not null;

-- Pinned lists stay task lists outside categories. Kind is immutable: changing
-- a populated task list to a schedule would invalidate undated legacy tasks.
create or replace function public.todo_guard_list() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then raise exception 'List identity cannot change'; end if;
    if new.kind is distinct from old.kind then raise exception 'List kind cannot change'; end if;
  end if;
  if new.id in ('b093c6d8-9ed6-41ec-9667-2467066b84d3'::uuid,'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7'::uuid) then
    if new.is_archived or new.kind <> 'todo' or new.category_id is not null then raise exception 'Pinned lists cannot be archived or categorized'; end if;
    if tg_op = 'UPDATE' and new.title is distinct from old.title then raise exception 'Pinned lists cannot be renamed'; end if;
  end if;
  return new;
end $$;
drop trigger todo_guard_list on public.lists;
create trigger todo_guard_list before insert or update on public.lists for each row execute function public.todo_guard_list();

create or replace function public.todo_guard_task() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  entering boolean; archived boolean; destination_capacity integer; destination_kind text;
  must_id constant uuid := 'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7';
  old_must boolean := false; new_must boolean;
begin
  if tg_op = 'UPDATE' and new.id <> old.id then raise exception 'Task identity cannot change'; end if;
  if tg_op = 'UPDATE' then
    old_must := (old.list_id = must_id or old.focus_list = 'must') and old.is_done is not true;
  end if;
  new_must := (new.list_id = must_id or new.focus_list = 'must') and new.is_done is not true;
  -- Lock all involved parent rows in stable order, including the shared Must
  -- list when an overlay changes, to serialize cross-category capacity checks.
  if tg_op = 'UPDATE' then
    perform id from public.lists where id in (old.list_id,new.list_id)
      or (id = must_id and (coalesce(old_must,false) or coalesce(new_must,false))) order by id for update;
    entering := old.list_id is distinct from new.list_id or (old.is_done is true and new.is_done is not true);
  else
    perform id from public.lists where id = new.list_id or (id = must_id and coalesce(new_must,false)) order by id for update;
    entering := true;
  end if;
  -- Retain the nullable historical list contract.
  if new.list_id is null then
    new.event_time := null;
    new.focus_list := null;
    return new;
  end if;
  select is_archived,kind into archived,destination_kind from public.lists where id = new.list_id;
  if not found then raise exception 'Destination list is unavailable'; end if;
  if entering and archived then raise exception 'Destination list is archived'; end if;
  if destination_kind = 'schedule' then
    if new.due_date is null or new.due_date !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode='23514', message='Schedule entries require a valid date.';
    end if;
    begin
      perform new.due_date::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='23514', message='Schedule entries require a valid date.';
    end;
    if new.focus_list is not null then
      raise exception using errcode='23514', message='Schedule entries cannot be added to focus lists.';
    end if;
  else
    new.event_time := null;
  end if;
  if coalesce(new_must,false) and not coalesce(old_must,false) then
    update public.lists set capacity_revision = capacity_revision + 1 where id = must_id;
    if (select count(*) from public.tasks where (list_id = must_id or focus_list = 'must') and is_done is not true and id <> new.id) >= 3 then
      raise exception 'Must Do Today has reached its active task limit';
    end if;
  end if;
  if entering and new.is_done is not true and new.list_id <> must_id then
    select max_items into destination_capacity from public.lists where id = new.list_id;
    if destination_capacity is not null then
      update public.lists set capacity_revision = capacity_revision + 1 where id = new.list_id;
      if (select count(*) from public.tasks where list_id = new.list_id and is_done is not true and id <> new.id) >= destination_capacity then
        raise exception 'Destination list has reached its active task limit';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.todo_guard_list(),public.todo_guard_task() from public,anon,authenticated;

-- Migrate only the named example. Never invent a Doctors category if the user
-- has no matching list, and never move/rewrite its existing task rows.
do $$
declare doctors_id uuid; doctors_category uuid;
begin
  select id into doctors_id from public.lists
    where lower(title) = 'doctors appointments' and category_id is null
      and id not in ('b093c6d8-9ed6-41ec-9667-2467066b84d3'::uuid,'df9db72b-b8ee-4178-bc1d-e5f55c9dcca7'::uuid)
    order by id limit 1;
  if doctors_id is null then return; end if;
  select id into doctors_category from public.categories where lower(title) = 'doctors' order by id limit 1;
  if doctors_category is null then
    insert into public.categories(title) values ('Doctors') returning id into doctors_category;
  end if;
  update public.lists set category_id = doctors_category where id = doctors_id;
  if not exists (select 1 from public.lists where category_id = doctors_category and kind = 'schedule') then
    insert into public.lists(id,title,type,max_items,category_id,kind)
      values(gen_random_uuid(),'Schedule','other',null,doctors_category,'schedule');
  end if;
end $$;
