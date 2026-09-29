-- Zusätzliche Logins nur für den Funnel-Admin (z. B. für das Kundenunternehmen).
-- Ein Mitglied sieht genau die Funnel von owner_user_id (Adbot-Konto), hat aber keinen Adbot-Zugang.
-- Passwörter liegen nur als scrypt-Hash vor. Zugriff ausschließlich über service_role (Funnel-Server).

create table if not exists public.funnel_admin_members (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  email text not null,
  name text not null default '',
  password_hash text not null,
  created_by_email text not null default '',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_admin_members_email_format
    check (char_length(email) between 3 and 320 and email = lower(email) and position('@' in email) > 1),
  constraint funnel_admin_members_password_hash_format
    check (password_hash like 'scrypt$%')
);

create unique index if not exists funnel_admin_members_email_uidx
  on public.funnel_admin_members (email);

create index if not exists funnel_admin_members_owner_idx
  on public.funnel_admin_members (owner_user_id);

drop trigger if exists funnel_admin_members_set_updated_at on public.funnel_admin_members;
create trigger funnel_admin_members_set_updated_at
before update on public.funnel_admin_members
for each row execute function public.set_updated_at();

alter table public.funnel_admin_members enable row level security;

revoke all on table public.funnel_admin_members from anon, authenticated;
grant select, insert, update, delete on public.funnel_admin_members to service_role;

comment on table public.funnel_admin_members is
  'Funnel-only-Logins: gleicher Funnel-Umfang wie owner_user_id, kein Adbot-Zugang. Verwaltet im Funnel-Admin unter Konto.';
