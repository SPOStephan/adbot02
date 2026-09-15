-- Incremental crawl cursor / queue for ChatGPT Ad Library (admin-only corpus).
-- Never customer-visible; used by cron + GitHub Action Playwright scraper.

create table if not exists public.chatgpt_ad_library_crawl_state (
  id text primary key default 'default',
  enabled boolean not null default true,
  pending_ids jsonb not null default '[]'::jsonb,
  next_discover_shard integer not null default 0,
  last_plan_at timestamptz,
  last_ingest_at timestamptz,
  last_discover_at timestamptz,
  last_run_summary jsonb not null default '{}'::jsonb,
  total_planned bigint not null default 0,
  total_imported bigint not null default 0,
  total_skipped_duplicate bigint not null default 0,
  total_failed bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint chatgpt_ad_library_crawl_state_id_check check (id = 'default'),
  constraint chatgpt_ad_library_crawl_state_shard_check check (
    next_discover_shard >= 0 and next_discover_shard < 64
  ),
  constraint chatgpt_ad_library_crawl_state_pending_is_array check (
    jsonb_typeof(pending_ids) = 'array'
  )
);

alter table public.chatgpt_ad_library_crawl_state enable row level security;

revoke all on table public.chatgpt_ad_library_crawl_state from public;
revoke all on table public.chatgpt_ad_library_crawl_state from anon;
revoke all on table public.chatgpt_ad_library_crawl_state from authenticated;
grant select, insert, update, delete on table public.chatgpt_ad_library_crawl_state to service_role;

insert into public.chatgpt_ad_library_crawl_state (id)
values ('default')
on conflict (id) do nothing;
