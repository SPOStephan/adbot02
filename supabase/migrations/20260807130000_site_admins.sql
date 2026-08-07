-- Site admins: only these users may change Grundeinstellungen such as
-- Impressum / Datenschutz. Public read of legal pages stays open.

begin;

create table if not exists public.site_admins (
  user_id uuid primary key references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

alter table public.site_admins enable row level security;

revoke all on table public.site_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.site_admins to service_role;

comment on table public.site_admins is
  'Users allowed to edit site-wide settings (legal pages, etc.). Readable/writable only via service role.';

-- Ensure the owner row exists in public.users (auth trigger may already have it).
insert into public.users (id, email)
select id, email
from auth.users
where lower(email) = lower('stephan@meererfolg.de')
on conflict (id) do update
  set email = excluded.email;

insert into public.site_admins (user_id, note)
select id, 'Initial site admin (owner)'
from public.users
where lower(email) = lower('stephan@meererfolg.de')
on conflict (user_id) do nothing;

commit;
