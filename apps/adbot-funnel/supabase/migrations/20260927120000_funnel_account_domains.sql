-- Account-wide custom host: one hostname serves all funnels of an owner via /f/:slug.
-- Per-funnel 1:1 bindings stay in funnel_custom_domains.

create table if not exists public.funnel_account_domains (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  hostname text not null,
  status text not null default 'PENDING_DNS'
    check (status in ('PENDING_DNS', 'READY', 'REVOKED')),
  dns_target text not null default 'cname.vercel-dns.com',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint funnel_account_domains_hostname_format
    check (
      char_length(hostname) between 3 and 253
      and hostname = lower(hostname)
      and hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    )
);

create unique index if not exists funnel_account_domains_active_hostname_uidx
  on public.funnel_account_domains (hostname)
  where status in ('PENDING_DNS', 'READY') and revoked_at is null;

create index if not exists funnel_account_domains_owner_idx
  on public.funnel_account_domains (owner_user_id, status);

drop trigger if exists funnel_account_domains_set_updated_at on public.funnel_account_domains;
create trigger funnel_account_domains_set_updated_at
before update on public.funnel_account_domains
for each row execute function public.set_updated_at();

alter table public.funnel_account_domains enable row level security;

revoke all on table public.funnel_account_domains from anon, authenticated;
grant select, insert, update, delete on public.funnel_account_domains to service_role;

comment on table public.funnel_account_domains is
  'Customer hostname for all funnels of one account. READY root lists /f/:slug; not a single-funnel Root-URL.';
