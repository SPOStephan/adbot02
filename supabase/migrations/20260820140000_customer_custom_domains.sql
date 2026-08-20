-- Global customer custom domains for Funnel, Freebie, and future tools.
-- Separate from Meta allowed_domains (ad conversion policy).
-- Hosting attach (Vercel SSL) may remain an ops/API step; this stores intent + DNS status.

begin;

create table if not exists public.customer_custom_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  hostname text not null,
  label text not null default '',
  status text not null default 'PENDING_DNS'
    check (status in ('PENDING_DNS', 'READY', 'REVOKED')),
  dns_target text not null default 'cname.vercel-dns.com',
  notes text not null default '',
  last_dns_check_at timestamptz,
  last_dns_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint customer_custom_domains_hostname_format
    check (
      char_length(hostname) between 3 and 253
      and hostname = lower(hostname)
      and hostname ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    ),
  constraint customer_custom_domains_label_len
    check (char_length(label) <= 120)
);

create unique index if not exists customer_custom_domains_active_hostname_uidx
  on public.customer_custom_domains (hostname)
  where status in ('PENDING_DNS', 'READY') and revoked_at is null;

create index if not exists customer_custom_domains_user_idx
  on public.customer_custom_domains (user_id, status);

alter table public.customer_custom_domains enable row level security;

revoke all on table public.customer_custom_domains from anon, authenticated;

grant select (
  id,
  user_id,
  hostname,
  label,
  status,
  dns_target,
  notes,
  last_dns_check_at,
  last_dns_message,
  created_at,
  updated_at,
  revoked_at
) on table public.customer_custom_domains to authenticated;

drop policy if exists customer_custom_domains_select_own on public.customer_custom_domains;
create policy customer_custom_domains_select_own
  on public.customer_custom_domains
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.customer_custom_domains to service_role;

comment on table public.customer_custom_domains is
  'Account-level custom hostnames for Funnel/Freebie/tools. READY means DNS verified; tool host routing may bind later.';

commit;
