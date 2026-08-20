-- Meta Pixel soft-apply fields for Freebie offers (browser Pixel; CAPI later).
-- Apply in the Freebie Supabase project.

alter table public.freebie_offers
  add column if not exists meta_tracking_enabled boolean not null default false;

alter table public.freebie_offers
  add column if not exists meta_pixel_id text not null default '';

alter table public.freebie_offers
  add column if not exists meta_event_name text not null default 'Lead';

alter table public.freebie_offers
  drop constraint if exists freebie_offers_meta_pixel_id_check;

alter table public.freebie_offers
  add constraint freebie_offers_meta_pixel_id_check
  check (meta_pixel_id = '' or meta_pixel_id ~ '^[0-9]{5,25}$');

comment on column public.freebie_offers.meta_pixel_id is
  'Meta Pixel ID soft-applied from Adbot portal confirm; empty means unset.';
comment on column public.freebie_offers.meta_tracking_enabled is
  'When true and pixel set, public offer pages load the Meta browser Pixel.';
