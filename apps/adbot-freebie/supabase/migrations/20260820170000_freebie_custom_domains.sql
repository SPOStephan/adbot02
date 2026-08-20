-- Custom domain registry for Freebie offers.
-- Hosting attach (Vercel/DNS/SSL) remains an ops step; this table stores intent + status.
-- Apply in the Freebie Supabase project.

create table if not exists public.freebie_custom_domains (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.freebie_offers(id) on delete cascade,
  hostname text not null,
  status text not null default 'PENDING_DNS'
    check (status in ('PENDING_DNS', 'READY', 'REVOKED')),
  dns_target text not null default 'cname.vercel-dns.com',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint freebie_custom_domains_hostname_format
    check (
      char_length(hostname) between 3 and 253
      and hostname = lower(hostname)
      and hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    )
);

create unique index if not exists freebie_custom_domains_active_hostname_uidx
  on public.freebie_custom_domains (hostname)
  where status in ('PENDING_DNS', 'READY') and revoked_at is null;

create index if not exists freebie_custom_domains_offer_idx
  on public.freebie_custom_domains (offer_id, status);

alter table public.freebie_custom_domains enable row level security;

revoke all on table public.freebie_custom_domains from anon, authenticated;
grant select, insert, update, delete on table public.freebie_custom_domains to service_role;

comment on table public.freebie_custom_domains is
  'Customer custom hostnames for Freebie offers. READY means DNS verified; root URL serves the bound offer.';
