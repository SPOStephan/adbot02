-- Isolated Meta Ad Library collector connection (second Meta app, never the
-- customer product app). Token is stored encrypted; service_role only.

create table if not exists public.meta_ad_library_connections (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  token_ciphertext text not null,
  token_iv text not null,
  token_auth_tag text not null,
  token_expires_at timestamptz,
  meta_user_id text,
  last_probe_at timestamptz,
  last_probe_ok boolean,
  last_probe_summary jsonb not null default '{}'::jsonb,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_ad_library_connections_probe_object check (
    jsonb_typeof(last_probe_summary) = 'object'
  )
);

create index if not exists meta_ad_library_connections_updated_idx
  on public.meta_ad_library_connections (updated_at desc);

alter table public.meta_ad_library_connections enable row level security;

revoke all on table public.meta_ad_library_connections from public;
revoke all on table public.meta_ad_library_connections from anon;
revoke all on table public.meta_ad_library_connections from authenticated;
grant select, insert, update, delete on table public.meta_ad_library_connections to service_role;

comment on table public.meta_ad_library_connections is
  'Encrypted user token for the separate Meta Ad Library collector app. Never mix with customer META_APP_ID.';
