-- Internal Adbot training ground: generate an ad from a URL, rate it, learn.
-- Site-admin only. Never customer-visible. Never launchable.

create table if not exists public.adbot_training_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  landing_url text not null,
  landing_hostname text not null,
  landing_title text not null default '',
  landing_excerpt text not null default '',
  platform text not null default 'meta',
  objective text not null default 'traffic',
  industry text not null default '',
  headline text not null default '',
  primary_text text not null default '',
  description text not null default '',
  image_asset_id uuid,
  image_error text,
  verdict text,
  verdict_note text not null default '',
  rated_at timestamptz,
  learning_prompt text not null default '',
  copy_provider text not null default '',
  copy_model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adbot_training_runs_verdict_check check (
    verdict is null or verdict in ('keep', 'reject')
  ),
  constraint adbot_training_runs_url_https check (landing_url like 'https://%')
);

create index if not exists adbot_training_runs_rated_idx
  on public.adbot_training_runs (rated_at desc)
  where verdict is not null;

create index if not exists adbot_training_runs_created_idx
  on public.adbot_training_runs (created_at desc);

alter table public.adbot_training_runs enable row level security;

revoke all on table public.adbot_training_runs from public;
revoke all on table public.adbot_training_runs from anon;
revoke all on table public.adbot_training_runs from authenticated;
grant select, insert, update, delete on table public.adbot_training_runs to service_role;
