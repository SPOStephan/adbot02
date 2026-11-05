-- Conversions API (erweitert), Teil 1: Datenbank-Grundlage.
--
-- Rein additiv: nur NEUE Tabellen + Funktionen. Keine bestehende Tabelle,
-- Spalte, Policy, kein Trigger, kein Plan und kein Launch-/Gate-/Materializer-
-- Pfad wird verändert. meta_confirmed_pixels und meta_conversion_events werden
-- nur per Fremdschlüssel bzw. gar nicht referenziert. Ohne Eintrag in
-- meta_public_capi_pixels (Standard: keiner / enabled = false) ist die Option
-- für jeden Pixel aus. Noch kein Code liest oder schreibt diese Tabellen.

begin;

-- 1) Schalter je bestätigtem Pixel (Standard aus).
create table if not exists public.meta_public_capi_pixels (
  confirmed_pixel_id uuid primary key
    references public.meta_confirmed_pixels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pixel_id text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_public_capi_pixels_pixel_id_digits
    check (pixel_id ~ '^[0-9]{5,25}$')
);

create index if not exists meta_public_capi_pixels_user_idx
  on public.meta_public_capi_pixels (user_id);

-- 2) Ereignis-Schlüssel (nur Hash gespeichert, Klartext wird einmal angezeigt).
create table if not exists public.meta_capi_event_keys (
  id uuid primary key default gen_random_uuid(),
  confirmed_pixel_id uuid not null
    references public.meta_confirmed_pixels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pixel_id text not null,
  mode text not null,
  label text not null default '',
  key_prefix text not null,
  key_hash text not null,
  allowed_hostnames text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint meta_capi_event_keys_pixel_id_digits
    check (pixel_id ~ '^[0-9]{5,25}$'),
  constraint meta_capi_event_keys_mode
    check (mode in ('live', 'test')),
  constraint meta_capi_event_keys_label_len
    check (char_length(label) <= 120),
  constraint meta_capi_event_keys_prefix_format
    check (key_prefix ~ '^adb_ev_(live|test)_[A-Za-z0-9]{4,12}$'),
  constraint meta_capi_event_keys_hash_format
    check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_capi_event_keys_hostnames_limit
    check (cardinality(allowed_hostnames) <= 20)
);

create unique index if not exists meta_capi_event_keys_hash_uidx
  on public.meta_capi_event_keys (key_hash);

create index if not exists meta_capi_event_keys_pixel_idx
  on public.meta_capi_event_keys (confirmed_pixel_id, created_at desc);

create index if not exists meta_capi_event_keys_user_idx
  on public.meta_capi_event_keys (user_id);

-- 3) Protokoll (DSGVO-sparsam: keine E-Mail, Telefon, Namen, IP, User-Agent).
create table if not exists public.meta_conversion_events_log (
  id bigint generated always as identity primary key,
  key_id uuid references public.meta_capi_event_keys (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  pixel_id text not null,
  event_name text not null,
  event_id text not null,
  action_source text,
  is_test boolean not null default false,
  status text not null,
  error_code text,
  error_reason text,
  fbtrace_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_conversion_events_log_pixel_id_digits
    check (pixel_id ~ '^[0-9]{5,25}$'),
  constraint meta_conversion_events_log_event_name_format
    check (event_name ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  constraint meta_conversion_events_log_event_id_len
    check (char_length(event_id) between 1 and 128),
  constraint meta_conversion_events_log_action_source_len
    check (action_source is null or char_length(action_source) <= 40),
  constraint meta_conversion_events_log_status
    check (status in ('pending', 'sent', 'skipped_no_consent', 'duplicate', 'invalid', 'meta_error')),
  constraint meta_conversion_events_log_error_code_len
    check (error_code is null or char_length(error_code) <= 40),
  constraint meta_conversion_events_log_error_reason_len
    check (error_reason is null or char_length(error_reason) <= 300),
  constraint meta_conversion_events_log_fbtrace_len
    check (fbtrace_id is null or char_length(fbtrace_id) <= 80)
);

-- Idempotenz: je Pixel + event_id + event_name (+ Test/Live) höchstens ein
-- laufender oder gesendeter Versand. Fehlgeschlagene Versuche geben den Platz
-- wieder frei, damit der Kunde erneut senden kann.
create unique index if not exists meta_conversion_events_log_idem_uidx
  on public.meta_conversion_events_log (pixel_id, event_id, event_name, is_test)
  where status in ('pending', 'sent');

create index if not exists meta_conversion_events_log_pixel_time_idx
  on public.meta_conversion_events_log (pixel_id, created_at desc);

create index if not exists meta_conversion_events_log_user_time_idx
  on public.meta_conversion_events_log (user_id, created_at desc);

create index if not exists meta_conversion_events_log_created_idx
  on public.meta_conversion_events_log (created_at);

-- 4) Rate-Limit-Zähler je Schlüssel und Minute.
create table if not exists public.meta_capi_rate_limits (
  key_id uuid not null references public.meta_capi_event_keys (id) on delete cascade,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key_id, window_start),
  constraint meta_capi_rate_limits_hits_nonneg check (hits >= 0)
);

-- RLS: Kunden lesen nur eigene Zeilen (ohne key_hash). Schreiben nur service_role.
alter table public.meta_public_capi_pixels enable row level security;
alter table public.meta_capi_event_keys enable row level security;
alter table public.meta_conversion_events_log enable row level security;
alter table public.meta_capi_rate_limits enable row level security;

revoke all on table public.meta_public_capi_pixels from anon, authenticated;
revoke all on table public.meta_capi_event_keys from anon, authenticated;
revoke all on table public.meta_conversion_events_log from anon, authenticated;
revoke all on table public.meta_capi_rate_limits from anon, authenticated;

grant select on table public.meta_public_capi_pixels to authenticated;
grant select (
  id,
  confirmed_pixel_id,
  user_id,
  pixel_id,
  mode,
  label,
  key_prefix,
  allowed_hostnames,
  created_at,
  last_used_at,
  revoked_at
) on table public.meta_capi_event_keys to authenticated;
grant select on table public.meta_conversion_events_log to authenticated;

grant select, insert, update, delete on table public.meta_public_capi_pixels to service_role;
grant select, insert, update, delete on table public.meta_capi_event_keys to service_role;
grant select, insert, update, delete on table public.meta_conversion_events_log to service_role;
grant select, insert, update, delete on table public.meta_capi_rate_limits to service_role;

drop policy if exists meta_public_capi_pixels_select_own on public.meta_public_capi_pixels;
create policy meta_public_capi_pixels_select_own
  on public.meta_public_capi_pixels
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists meta_capi_event_keys_select_own on public.meta_capi_event_keys;
create policy meta_capi_event_keys_select_own
  on public.meta_capi_event_keys
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists meta_conversion_events_log_select_own on public.meta_conversion_events_log;
create policy meta_conversion_events_log_select_own
  on public.meta_conversion_events_log
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Rate-Limit: zählt p_cost Ereignisse auf das aktuelle Minutenfenster und
-- liefert true, solange das Limit nicht überschritten ist.
create or replace function public.meta_capi_rate_limit_hit(
  p_key_id uuid,
  p_cost integer,
  p_limit_per_minute integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_hits integer;
begin
  if p_key_id is null or coalesce(p_cost, 0) < 1 or coalesce(p_limit_per_minute, 0) < 1 then
    return false;
  end if;

  insert into public.meta_capi_rate_limits as rl (key_id, window_start, hits)
  values (p_key_id, v_window, p_cost)
  on conflict (key_id, window_start)
  do update set hits = rl.hits + excluded.hits
  returning rl.hits into v_hits;

  return v_hits <= p_limit_per_minute;
end;
$$;

-- Aufräumen: Protokoll nach 90 Tagen, Rate-Limit-Fenster nach 1 Tag.
create or replace function public.meta_conversion_events_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log integer;
  v_rl integer;
begin
  delete from public.meta_conversion_events_log
  where created_at < pg_catalog.now() - interval '90 days';
  get diagnostics v_log = row_count;

  delete from public.meta_capi_rate_limits
  where window_start < pg_catalog.now() - interval '1 day';
  get diagnostics v_rl = row_count;

  return pg_catalog.jsonb_build_object('log_deleted', v_log, 'rate_limit_deleted', v_rl);
end;
$$;

revoke all on function public.meta_capi_rate_limit_hit(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.meta_conversion_events_cleanup() from public, anon, authenticated;
grant execute on function public.meta_capi_rate_limit_hit(uuid, integer, integer) to service_role;
grant execute on function public.meta_conversion_events_cleanup() to service_role;

comment on table public.meta_public_capi_pixels is
  'Conversions API (erweitert): Schalter je bestätigtem Pixel. Standard aus.';
comment on table public.meta_capi_event_keys is
  'Conversions API (erweitert): Ereignis-Schlüssel externer Kunden-Websites. Nur SHA-256-Hash gespeichert.';
comment on table public.meta_conversion_events_log is
  'Conversions API (erweitert): Versandprotokoll ohne personenbezogene Rohdaten. Löschung nach 90 Tagen.';

commit;
