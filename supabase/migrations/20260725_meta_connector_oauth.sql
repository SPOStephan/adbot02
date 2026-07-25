-- AdBot: sicherer, mandantenfähiger Meta-OAuth-Connector
-- Voraussetzung: public.platform_accounts aus dem bestehenden Basisschema.

alter table if exists public.platform_accounts
  add column if not exists account_id text,
  add column if not exists account_name text,
  add column if not exists access_token_encrypted text,
  add column if not exists token_iv text,
  add column if not exists token_auth_tag text,
  add column if not exists token_version smallint not null default 1,
  add column if not exists meta_user_id text,
  add column if not exists meta_business_id text,
  add column if not exists ad_account_ids jsonb not null default '[]'::jsonb,
  add column if not exists page_ids jsonb not null default '[]'::jsonb,
  add column if not exists instagram_account_ids jsonb not null default '[]'::jsonb,
  add column if not exists expires_at timestamptz,
  add column if not exists refresh_at timestamptz,
  add column if not exists connected_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists revoked_at timestamptz;

-- Frühere Basisschemata können Klartext-Tokenfelder enthalten. Sie werden bewusst
-- nicht weiterverwendet, von NOT NULL befreit und vor dem ersten OAuth-Pilot geleert.
do $remove_legacy_plaintext_tokens$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_accounts'
      and column_name = 'access_token'
  ) then
    alter table public.platform_accounts alter column access_token drop not null;
    update public.platform_accounts set access_token = null where access_token is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'platform_accounts'
      and column_name = 'refresh_token'
  ) then
    alter table public.platform_accounts alter column refresh_token drop not null;
    update public.platform_accounts set refresh_token = null where refresh_token is not null;
  end if;
end
$remove_legacy_plaintext_tokens$;

create unique index if not exists platform_accounts_user_platform_uidx
  on public.platform_accounts (user_id, platform);

create index if not exists platform_accounts_meta_user_idx
  on public.platform_accounts (meta_user_id)
  where platform = 'meta' and meta_user_id is not null;

alter table if exists public.platform_accounts enable row level security;

-- Nur der serverseitige Service-Role-Client darf Connector-Zeilen schreiben oder löschen.
revoke insert, update, delete on public.platform_accounts from anon, authenticated;
revoke select on public.platform_accounts from anon, authenticated;

-- Angemeldete Nutzer erhalten nur Spaltenrechte auf nicht geheime Metadaten.
-- Die vorhandene RLS-Policy begrenzt diese zusätzlich auf user_id = auth.uid().
do $grant_safe_platform_account_columns$
declare
  safe_columns text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into safe_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'platform_accounts'
    and column_name in (
      'id',
      'user_id',
      'platform',
      'account_id',
      'account_name',
      'meta_business_id',
      'ad_account_ids',
      'page_ids',
      'instagram_account_ids',
      'expires_at',
      'refresh_at',
      'connected_at',
      'updated_at',
      'revoked_at'
    );

  if safe_columns is not null then
    execute format(
      'grant select (%s) on public.platform_accounts to authenticated',
      safe_columns
    );
  end if;
end
$grant_safe_platform_account_columns$;

create table if not exists public.meta_data_deletion_requests (
  confirmation_hash text primary key,
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.meta_data_deletion_requests enable row level security;
revoke all on public.meta_data_deletion_requests from anon, authenticated;

comment on column public.platform_accounts.access_token_encrypted is
  'AES-256-GCM ciphertext; plaintext tokens must never be stored.';
comment on column public.platform_accounts.token_iv is
  'Per-token random AES-GCM initialization vector.';
comment on column public.platform_accounts.token_auth_tag is
  'AES-GCM authentication tag used to detect tampering.';
comment on table public.meta_data_deletion_requests is
  'Minimal status records with a SHA-256 confirmation hash and no Meta user identifiers.';
