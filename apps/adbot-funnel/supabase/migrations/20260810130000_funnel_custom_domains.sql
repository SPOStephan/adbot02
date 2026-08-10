-- Custom domain registry for funnels (foundation).
-- Hosting attach (Vercel/DNS/SSL) remains an ops step; this table stores intent + status.

create table if not exists public.funnel_custom_domains (
  id uuid primary key default gen_random_uuid(),
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  hostname text not null,
  status text not null default 'PENDING_DNS'
    check (status in ('PENDING_DNS', 'READY', 'REVOKED')),
  dns_target text not null default 'cname.vercel-dns.com',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint funnel_custom_domains_hostname_format
    check (
      char_length(hostname) between 3 and 253
      and hostname = lower(hostname)
      and hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    )
);

create unique index if not exists funnel_custom_domains_active_hostname_uidx
  on public.funnel_custom_domains (hostname)
  where status in ('PENDING_DNS', 'READY') and revoked_at is null;

create index if not exists funnel_custom_domains_funnel_idx
  on public.funnel_custom_domains (funnel_id, status);

drop trigger if exists funnel_custom_domains_set_updated_at on public.funnel_custom_domains;
create trigger funnel_custom_domains_set_updated_at
before update on public.funnel_custom_domains
for each row execute function public.set_updated_at();

alter table public.funnel_custom_domains enable row level security;

revoke all on table public.funnel_custom_domains from anon, authenticated;
grant select, insert, update, delete on table public.funnel_custom_domains to service_role;

comment on table public.funnel_custom_domains is
  'Customer custom hostnames for funnels. READY means DNS/SSL attached; routing may use hostname lookup.';
