-- AdBot: reproduzierbare Baseline des am 25. Juli 2026 verifizierten
-- Produktionsschemas. Diese Migration enthält ausschließlich Schemaobjekte,
-- keine Produktionsdaten oder Secrets.

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  created_at timestamptz default now()
);

create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  platform text not null,
  platform_account_id text not null,
  account_name text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint platform_accounts_user_id_platform_platform_account_id_key
    unique (user_id, platform, platform_account_id)
);

create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  name text not null,
  type text not null,
  content jsonb,
  generated_by_ai boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid references public.platform_accounts(id) on delete cascade,
  platform_campaign_id text not null,
  name text not null,
  status text,
  objective text,
  budget_amount numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint campaigns_platform_account_id_platform_campaign_id_key
    unique (platform_account_id, platform_campaign_id)
);

create table if not exists public.ad_groups (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  platform_ad_group_id text not null,
  name text not null,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint ad_groups_campaign_id_platform_ad_group_id_key
    unique (campaign_id, platform_ad_group_id)
);

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  ad_group_id uuid references public.ad_groups(id) on delete cascade,
  platform_ad_id text not null,
  name text not null,
  status text,
  creative_id uuid references public.creatives(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint ads_ad_group_id_platform_ad_id_key
    unique (ad_group_id, platform_ad_id)
);

create table if not exists public.performance_data (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null,
  entity_type text not null,
  date date not null,
  impressions bigint default 0,
  clicks bigint default 0,
  conversions bigint default 0,
  spend numeric default 0.00,
  platform text not null,
  created_at timestamptz default now(),
  constraint performance_data_entity_id_date_key unique (entity_id, date)
);

alter table public.users enable row level security;
alter table public.platform_accounts enable row level security;
alter table public.creatives enable row level security;
alter table public.campaigns enable row level security;
alter table public.ad_groups enable row level security;
alter table public.ads enable row level security;
alter table public.performance_data enable row level security;

-- Explizite API-Grants entsprechen der Supabase-Standardbasis. RLS begrenzt
-- den Zugriff zusätzlich; spätere Sicherheitsmigrationen schränken die
-- Connector-Tabelle auf sichere Metadatenspalten ein.
grant all on table public.users to anon, authenticated, service_role;
grant all on table public.platform_accounts to anon, authenticated, service_role;
grant all on table public.creatives to anon, authenticated, service_role;
grant all on table public.campaigns to anon, authenticated, service_role;
grant all on table public.ad_groups to anon, authenticated, service_role;
grant all on table public.ads to anon, authenticated, service_role;
grant all on table public.performance_data to anon, authenticated, service_role;

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
  for each row execute function public.handle_new_auth_user();

drop policy if exists "Nutzer verwalten eigene Creatives." on public.creatives;
create policy "Nutzer verwalten eigene Creatives."
on public.creatives
for all
using (auth.uid() = user_id);

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
on public.users
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "platform_accounts_select_own" on public.platform_accounts;
create policy "platform_accounts_select_own"
on public.platform_accounts
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "platform_accounts_delete_own" on public.platform_accounts;
create policy "platform_accounts_delete_own"
on public.platform_accounts
for delete
to authenticated
using ((select auth.uid()) = user_id);
