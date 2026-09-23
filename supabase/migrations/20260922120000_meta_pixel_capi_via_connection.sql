-- Persist whether CAPI works via the customer's Meta Login-for-Business
-- connection (not an Events Manager dataset token). Additive only.

begin;

alter table public.meta_confirmed_pixels
  add column if not exists capi_via_connection boolean not null default false;

alter table public.meta_confirmed_pixels
  add column if not exists capi_probe_status text not null default 'untested';

alter table public.meta_confirmed_pixels
  add column if not exists capi_probe_at timestamptz;

alter table public.meta_confirmed_pixels
  add column if not exists capi_probe_code text;

alter table public.meta_confirmed_pixels
  add column if not exists capi_probe_detail text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_confirmed_pixels_capi_probe_status'
  ) then
    alter table public.meta_confirmed_pixels
      add constraint meta_confirmed_pixels_capi_probe_status
      check (capi_probe_status in ('untested', 'ok', 'denied', 'error'));
  end if;
end
$$;

grant select (
  id,
  user_id,
  platform_account_id,
  pixel_id,
  label,
  custom_event_type,
  status,
  customer_confirmed_at,
  revoked_at,
  created_at,
  capi_via_connection,
  capi_probe_status,
  capi_probe_at,
  capi_probe_detail
) on table public.meta_confirmed_pixels to authenticated;

comment on column public.meta_confirmed_pixels.capi_via_connection is
  'True when POST /{pixel-id}/events succeeded with the Login-for-Business connection token.';

comment on column public.meta_confirmed_pixels.capi_probe_status is
  'Last connection-token CAPI probe: untested | ok | denied | error.';

commit;
