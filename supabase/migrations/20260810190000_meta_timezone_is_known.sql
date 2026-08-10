-- Helper for launch prepare: Meta sometimes returns timezone names that are
-- not in pg_timezone_names; launch materialize then fails the EUR snapshot gate.

begin;

create or replace function public.meta_timezone_is_known(p_timezone_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(coalesce(p_timezone_name, '')), '') is not null
    and exists (
      select 1
      from pg_catalog.pg_timezone_names tz
      where tz.name = btrim(p_timezone_name)
    ),
    false
  );
$$;

revoke all on function public.meta_timezone_is_known(text)
  from public, anon, authenticated;
grant execute on function public.meta_timezone_is_known(text) to service_role;

comment on function public.meta_timezone_is_known(text) is
  'True when the timezone name exists in pg_timezone_names.';

commit;
