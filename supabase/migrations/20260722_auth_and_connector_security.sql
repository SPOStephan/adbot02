-- AdPilot: Supabase-Auth mit Nutzerprofilen und sichere Connector-Lesezugriffe
-- Diese Migration ist idempotent und kann nach dem bereits ausgeführten Basisschema laufen.

alter table if exists public.users
  alter column email drop not null;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Bereits vorhandene Auth-Nutzer nachtragen.
insert into public.users (id, email)
select id, email
from auth.users
on conflict (id) do update
  set email = excluded.email;

alter table if exists public.users enable row level security;
alter table if exists public.platform_accounts enable row level security;

-- Alte, möglicherweise zu weit gefasste Policies aus dem ersten Schema entfernen.
drop policy if exists "Nutzer sehen nur eigene Daten." on public.users;
drop policy if exists "Nutzer verwalten eigene Konten." on public.platform_accounts;
drop policy if exists "users_select_own" on public.users;
drop policy if exists "platform_accounts_select_own" on public.platform_accounts;
drop policy if exists "platform_accounts_delete_own" on public.platform_accounts;

create policy "users_select_own"
on public.users
for select
to authenticated
using ((select auth.uid()) = id);

-- Im Browser dürfen Connector-Metadaten gelesen und Verbindungen getrennt werden.
-- Token-Erstellung und -Aktualisierung erfolgen später ausschließlich serverseitig.
create policy "platform_accounts_select_own"
on public.platform_accounts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "platform_accounts_delete_own"
on public.platform_accounts
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update on public.platform_accounts from authenticated;
