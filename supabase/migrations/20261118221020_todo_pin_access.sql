-- PIN-only access: browser roles lose direct access; the bounded Edge API is
-- the authorization boundary. Existing task/list rows are untouched.
create table public.todo_pin_sessions (
  token_hash text primary key check (length(token_hash)=64),
  pin_version text not null,
  expires_at timestamptz not null
);
create index todo_pin_sessions_expiry on public.todo_pin_sessions(expires_at);
create table public.todo_pin_attempts (
  id boolean primary key default true check (id),
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.todo_pin_sessions enable row level security;
alter table public.todo_pin_attempts enable row level security;
revoke all on public.todo_pin_sessions, public.todo_pin_attempts from public, anon, authenticated;
grant select,insert,update,delete on public.todo_pin_sessions,public.todo_pin_attempts to service_role;
create function public.todo_pin_attempt() returns boolean
language plpgsql security invoker set search_path='' as $$
declare count_now integer;
begin
  insert into public.todo_pin_attempts(id,window_start,attempts) values(true,clock_timestamp(),1)
  on conflict(id) do update set
    attempts=case when public.todo_pin_attempts.window_start <= clock_timestamp()-interval '5 minutes' then 1 else public.todo_pin_attempts.attempts+1 end,
    window_start=case when public.todo_pin_attempts.window_start <= clock_timestamp()-interval '5 minutes' then clock_timestamp() else public.todo_pin_attempts.window_start end
  where public.todo_pin_attempts.attempts < 5 or public.todo_pin_attempts.window_start <= clock_timestamp()-interval '5 minutes'
  returning attempts into count_now;
  return count_now is not null;
end $$;
revoke all on function public.todo_pin_attempt() from public, anon, authenticated;
grant execute on function public.todo_pin_attempt() to service_role;
alter table public.lists enable row level security;
alter table public.tasks enable row level security;
do $$ declare policy_row record; begin
  for policy_row in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('lists','tasks') loop
    execute format('drop policy %I on public.%I',policy_row.policyname,policy_row.tablename);
  end loop;
end $$;
revoke all on public.lists, public.tasks from public, anon, authenticated;
grant select,insert,update on public.lists to service_role;
grant select,insert,update,delete on public.tasks to service_role;
