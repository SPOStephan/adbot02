-- Per-asset Abruf outcome: a single Facebook page / IG profile could fail the
-- content sync for weeks while the account looked "connected" (Lohbeck:
-- Seehotel Fährhaus since 2026-09-10, Fleesensee + Rheinfels never). The
-- reason was only in server logs. Store Meta's error code + safe detail.

alter table public.meta_assets
  add column if not exists last_sync_error text,
  add column if not exists last_sync_error_at timestamptz;

alter table public.meta_assets
  drop constraint if exists meta_assets_last_sync_error_length;

alter table public.meta_assets
  add constraint meta_assets_last_sync_error_length
  check (last_sync_error is null or char_length(last_sync_error) <= 500);

notify pgrst, 'reload schema';
