-- ChatGPT Ad Library external_id dedupe helper for inspiration vault imports.
-- Metadata lives in brand_assets.metadata.external_source; customers never see INSPIRATION.

create index if not exists brand_assets_inspiration_chatgpt_external_id_idx
  on public.brand_assets (
    ((metadata -> 'external_source' ->> 'external_id'))
  )
  where library_scope = 'INSPIRATION'
    and status <> 'REVOKED'
    and (metadata -> 'external_source' ->> 'provider') = 'chatgptadlibrary.com'
    and coalesce(metadata -> 'external_source' ->> 'external_id', '') <> '';
