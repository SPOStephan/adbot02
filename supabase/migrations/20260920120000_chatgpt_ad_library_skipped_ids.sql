-- Dead-letter IDs for the ChatGPT Ad Library crawler. Failed parse/404 ads
-- must not jump back in front of the pending discoverer queue.

alter table public.chatgpt_ad_library_crawl_state
  add column if not exists skipped_ids jsonb not null default '[]'::jsonb;

alter table public.chatgpt_ad_library_crawl_state
  drop constraint if exists chatgpt_ad_library_crawl_state_skipped_is_array;

alter table public.chatgpt_ad_library_crawl_state
  add constraint chatgpt_ad_library_crawl_state_skipped_is_array check (
    jsonb_typeof(skipped_ids) = 'array'
  );
