-- Global campaign geo target (place + optional radius) per Adbot user.
-- Platform adapters translate this one record. Does not redefine organic
-- boost, kill-switch, or launch freeze.

begin;

create table if not exists public.customer_campaign_geo (
  user_id uuid primary key references public.users (id) on delete restrict,
  place_label text not null
    check (char_length(btrim(place_label)) between 2 and 240),
  place_kind text not null default 'city'
    check (place_kind in ('country', 'region', 'city', 'other')),
  country_code text
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  latitude numeric
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude numeric
    check (longitude is null or (longitude >= -180 and longitude <= 180)),
  radius_km integer
    check (radius_km is null or (radius_km between 1 and 80)),
  openai_location_id text
    check (openai_location_id is null or char_length(openai_location_id) between 1 and 64),
  meta_location_key text
    check (meta_location_key is null or char_length(meta_location_key) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_campaign_geo is
  'One place + optional radius per user. Meta/OpenAI/Google/TikTok adapters map it at launch.';

alter table public.customer_campaign_geo enable row level security;

drop policy if exists customer_campaign_geo_select_own on public.customer_campaign_geo;
create policy customer_campaign_geo_select_own
  on public.customer_campaign_geo
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists customer_campaign_geo_write_own on public.customer_campaign_geo;
create policy customer_campaign_geo_write_own
  on public.customer_campaign_geo
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.customer_campaign_geo to authenticated;
grant select, insert, update, delete on public.customer_campaign_geo to service_role;

commit;
