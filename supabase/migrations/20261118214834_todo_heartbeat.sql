create function public.todo_heartbeat()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.todo_heartbeat() from public, authenticated, service_role;
grant execute on function public.todo_heartbeat() to anon;
