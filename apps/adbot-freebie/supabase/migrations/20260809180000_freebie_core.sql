-- Adbot Freebie core schema (offers, leads, media catalog for Bunny).
-- Apply in the Freebie Supabase project (or shared Adbot DB if preferred).

create extension if not exists pgcrypto;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid null,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  byte_size bigint not null default 0,
  bunny_path text not null,
  cdn_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_owner_idx
  on public.media_assets (owner_user_id);

create table if not exists public.freebie_offers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid null,
  owner_email text null,
  slug text not null unique,
  title text not null,
  description text not null default '',
  confirmation_mode text not null default 'doi'
    check (confirmation_mode in ('doi', 'otp')),
  media_asset_id uuid null references public.media_assets (id) on delete set null,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists freebie_offers_owner_idx
  on public.freebie_offers (owner_user_id);

create index if not exists freebie_offers_published_slug_idx
  on public.freebie_offers (slug)
  where is_published = true;

create table if not exists public.freebie_leads (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.freebie_offers (id) on delete cascade,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'delivered', 'expired')),
  confirmation_mode text not null default 'doi'
    check (confirmation_mode in ('doi', 'otp')),
  doi_token_hash text null,
  otp_hash text null,
  otp_expires_at timestamptz null,
  confirmed_at timestamptz null,
  delivered_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists freebie_leads_offer_idx
  on public.freebie_leads (offer_id, created_at desc);

create unique index if not exists freebie_leads_doi_hash_uidx
  on public.freebie_leads (doi_token_hash)
  where doi_token_hash is not null;

comment on table public.media_assets is
  'Media Library catalog. Bytes live on Bunny.net; this table stores metadata/paths.';
comment on table public.freebie_offers is
  'Lead-magnet / freebie offers with DOI or OTP confirmation.';
comment on table public.freebie_leads is
  'Captured emails waiting for or completed confirmation + delivery.';
