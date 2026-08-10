-- Confirmed Meta Pixel bindings for Lead / offsite conversion launches.
-- Additive only: Traffic and existing launch paths do not require this table.

begin;

create table if not exists public.meta_confirmed_pixels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  platform_account_id uuid not null references public.platform_accounts (id),
  pixel_id text not null,
  label text not null default '',
  custom_event_type text not null default 'LEAD',
  status text not null default 'CONFIRMED',
  customer_confirmed_at timestamptz,
  customer_confirmed_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_confirmed_pixels_pixel_id_digits
    check (pixel_id ~ '^[0-9]{5,25}$'),
  constraint meta_confirmed_pixels_event_type
    check (custom_event_type ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  constraint meta_confirmed_pixels_status
    check (status in ('CONFIRMED', 'REVOKED')),
  constraint meta_confirmed_pixels_label_len
    check (char_length(label) <= 120)
);

create unique index if not exists meta_confirmed_pixels_active_pixel_uidx
  on public.meta_confirmed_pixels (platform_account_id, pixel_id)
  where status = 'CONFIRMED' and revoked_at is null;

create index if not exists meta_confirmed_pixels_account_idx
  on public.meta_confirmed_pixels (user_id, platform_account_id, status);

alter table public.meta_confirmed_pixels enable row level security;

revoke all on table public.meta_confirmed_pixels from anon, authenticated;
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
  created_at
) on table public.meta_confirmed_pixels to authenticated;

drop policy if exists meta_confirmed_pixels_select_own on public.meta_confirmed_pixels;
create policy meta_confirmed_pixels_select_own
  on public.meta_confirmed_pixels
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.meta_confirmed_pixels to service_role;

create or replace function public.confirm_meta_pixel(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_pixel_id text,
  p_label text default '',
  p_custom_event_type text default 'LEAD'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pixel_id text := btrim(coalesce(p_pixel_id, ''));
  v_label text := btrim(coalesce(p_label, ''));
  v_event text := upper(btrim(coalesce(p_custom_event_type, 'LEAD')));
  v_existing public.meta_confirmed_pixels%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Pixel confirmation identity is incomplete';
  end if;

  if v_pixel_id !~ '^[0-9]{5,25}$' then
    raise exception 'Pixel ID is invalid';
  end if;

  if char_length(v_label) > 120 then
    raise exception 'Pixel label is too long';
  end if;

  if v_event !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'Custom event type is invalid';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Active customer Meta account is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'meta-pixel:' || p_platform_account_id::text || ':' || v_pixel_id,
      0
    )
  );

  select pixel_row.*
  into v_existing
  from public.meta_confirmed_pixels pixel_row
  where pixel_row.user_id = p_user_id
    and pixel_row.platform_account_id = p_platform_account_id
    and pixel_row.pixel_id = v_pixel_id
  order by pixel_row.created_at desc
  limit 1
  for update;

  if found then
    update public.meta_confirmed_pixels
    set
      label = v_label,
      custom_event_type = v_event,
      status = 'CONFIRMED',
      customer_confirmed_at = now(),
      customer_confirmed_by = p_user_id,
      revoked_at = null,
      updated_at = now()
    where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into public.meta_confirmed_pixels (
    id,
    user_id,
    platform_account_id,
    pixel_id,
    label,
    custom_event_type,
    status,
    customer_confirmed_at,
    customer_confirmed_by,
    created_at,
    updated_at
  ) values (
    v_id,
    p_user_id,
    p_platform_account_id,
    v_pixel_id,
    v_label,
    v_event,
    'CONFIRMED',
    now(),
    p_user_id,
    now(),
    now()
  );

  return v_id;
end;
$$;

create or replace function public.revoke_meta_confirmed_pixel(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_pixel_row_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.meta_confirmed_pixels%rowtype;
begin
  if p_user_id is null or p_platform_account_id is null or p_pixel_row_id is null then
    raise exception 'Pixel revoke identity is incomplete';
  end if;

  select pixel_row.*
  into v_existing
  from public.meta_confirmed_pixels pixel_row
  where pixel_row.id = p_pixel_row_id
    and pixel_row.user_id = p_user_id
    and pixel_row.platform_account_id = p_platform_account_id
  for update;

  if not found then
    raise exception 'Confirmed pixel was not found';
  end if;

  if v_existing.status = 'REVOKED' and v_existing.revoked_at is not null then
    return v_existing.id;
  end if;

  update public.meta_confirmed_pixels
  set
    status = 'REVOKED',
    revoked_at = now(),
    updated_at = now()
  where id = v_existing.id;

  return v_existing.id;
end;
$$;

revoke all on function public.confirm_meta_pixel(uuid, uuid, text, text, text) from public;
revoke all on function public.revoke_meta_confirmed_pixel(uuid, uuid, uuid) from public;
grant execute on function public.confirm_meta_pixel(uuid, uuid, text, text, text) to service_role;
grant execute on function public.revoke_meta_confirmed_pixel(uuid, uuid, uuid) to service_role;

comment on table public.meta_confirmed_pixels is
  'Customer-confirmed Meta Pixel IDs for Lead/offsite launches. Not used by Traffic Canary.';

commit;
