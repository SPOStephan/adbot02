-- Staging inbox for the internal ad-example corpus (admin + collectors).
-- Never customer-visible. Items enter the Inspiration Vault only after import.

create table if not exists public.ad_library_collector_items (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  platform text not null,
  status text not null default 'fetched',
  source_url text,
  source_kind text not null default 'official_library',
  collector_batch_id text,
  image_url text,
  image_hash text,
  image_storage_bucket text,
  image_storage_path text,
  title text not null,
  advertiser_name text not null,
  industry text not null,
  objective text not null,
  objective_detail text not null default '',
  funnel_stage text not null default 'conversion',
  evidence_level text not null default 'visual_only',
  rights_basis text not null default 'reference_only',
  rights_confirmed boolean not null default false,
  format text not null default 'Bildanzeige',
  country text not null default 'Deutschland',
  language text not null default 'Deutsch',
  hook_text text not null default '',
  body_text text not null default '',
  cta_text text not null default '',
  landing_page_url text,
  performance_note text not null default '',
  why_it_works text not null default '',
  tags jsonb not null default '[]'::jsonb,
  quality_rating integer not null default 3,
  use_for_generation boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  brand_asset_id uuid,
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_library_collector_provider_check check (
    provider in ('manual', 'chatgpt_ad_library', 'meta', 'google', 'tiktok')
  ),
  constraint ad_library_collector_status_check check (
    status in ('fetched', 'reviewed', 'ready_for_import', 'imported', 'rejected', 'failed')
  ),
  constraint ad_library_collector_quality_check check (
    quality_rating >= 1 and quality_rating <= 5
  ),
  constraint ad_library_collector_tags_array check (jsonb_typeof(tags) = 'array'),
  constraint ad_library_collector_generation_off_for_foreign check (
    provider = 'manual' or use_for_generation = false
  ),
  constraint ad_library_collector_provider_external_unique unique (provider, external_id)
);

create index if not exists ad_library_collector_items_status_idx
  on public.ad_library_collector_items (status, updated_at desc);

create index if not exists ad_library_collector_items_batch_idx
  on public.ad_library_collector_items (collector_batch_id);

alter table public.ad_library_collector_items enable row level security;

revoke all on table public.ad_library_collector_items from public;
revoke all on table public.ad_library_collector_items from anon;
revoke all on table public.ad_library_collector_items from authenticated;
grant select, insert, update, delete on table public.ad_library_collector_items to service_role;
