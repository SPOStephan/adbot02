-- Kundenspezifische Funnel-Medienbibliothek (Hintergrundbilder).
-- Bytes liegen auf Bunny.net; diese Tabelle hält Metadaten und CDN-URLs.

create table if not exists public.funnel_media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid null,
  funnel_id uuid null references public.funnels(id) on delete set null,
  kind text not null default 'hero-background'
    check (kind in ('hero-background')),
  filename text not null,
  desktop_url text not null default '',
  mobile_url text not null default '',
  bunny_path_desktop text not null default '',
  bunny_path_mobile text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists funnel_media_assets_owner_idx
  on public.funnel_media_assets (owner_user_id, created_at desc);

create index if not exists funnel_media_assets_funnel_idx
  on public.funnel_media_assets (funnel_id, created_at desc);

alter table public.funnel_media_assets enable row level security;

revoke all on table public.funnel_media_assets from anon, authenticated;
grant select, insert, update, delete on table public.funnel_media_assets to service_role;

comment on table public.funnel_media_assets is
  'Customer-scoped Funnel media library. Image bytes live on Bunny.net (fallback: Supabase Storage).';
