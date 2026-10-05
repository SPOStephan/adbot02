-- Beitrag-Push: only current posts (owner decision 2026-10-05).
-- When a FB/IG asset resumes syncing after a gap (or is synced for the first
-- time weeks after connect), every post since then became is_new and AUTO
-- planned boosts for weeks-old posts. New rule: a newly recorded post is
-- new/boostable only if published within the last 7 days.
-- Existing candidates/plans are not touched by this migration.

begin;

create or replace function public.record_meta_content_candidates(
  p_platform_account_id uuid,
  p_meta_asset_id uuid,
  p_user_id uuid,
  p_is_baseline boolean,
  p_items jsonb
)
returns table (
  seen_count integer,
  inserted_count integer,
  new_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_rows integer;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_new integer := 0;
  v_asset_created_at timestamptz;
  v_published_at timestamptz;
  v_is_new boolean;
  -- Beitrag-Push only for current posts: never older than 7 days.
  v_cutoff timestamptz := now() - interval '7 days';
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  select asset.created_at into v_asset_created_at
  from public.meta_assets asset
  where asset.id = p_meta_asset_id
    and asset.platform_account_id = p_platform_account_id
    and asset.user_id = p_user_id
    and asset.asset_type in ('facebook_page', 'instagram_account');

  if not found then
    raise exception 'Meta asset does not belong to connector';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_seen := v_seen + 1;
    v_published_at := nullif(v_item->>'published_at', '')::timestamptz;

    -- Only posts published within the last 7 days can be new/boostable.
    -- Soft-baseline: on the first Abruf, posts at/after asset connect
    -- (6h grace) stay boostable — still capped at 7 days.
    v_is_new := case
      when v_published_at is null or v_published_at < v_cutoff then false
      when not p_is_baseline then true
      when v_published_at >= (v_asset_created_at - interval '6 hours')
        then true
      else false
    end;

    insert into public.meta_content_candidates (
      platform_account_id,
      meta_asset_id,
      user_id,
      source,
      content_type,
      meta_content_id,
      caption_excerpt,
      permalink_url,
      preview_url,
      published_at,
      first_seen_at,
      last_seen_at,
      is_new,
      updated_at
    ) values (
      p_platform_account_id,
      p_meta_asset_id,
      p_user_id,
      v_item->>'source',
      coalesce(v_item->>'content_type', 'unknown'),
      v_item->>'meta_content_id',
      nullif(v_item->>'caption_excerpt', ''),
      nullif(v_item->>'permalink_url', ''),
      nullif(v_item->>'preview_url', ''),
      v_published_at,
      now(),
      now(),
      v_is_new,
      now()
    )
    on conflict (platform_account_id, source, meta_content_id)
    do nothing;

    get diagnostics v_rows = row_count;

    if v_rows = 1 then
      v_inserted := v_inserted + 1;
      if v_is_new then
        v_new := v_new + 1;
      end if;
    else
      update public.meta_content_candidates
      set
        meta_asset_id = p_meta_asset_id,
        caption_excerpt = nullif(v_item->>'caption_excerpt', ''),
        permalink_url = nullif(v_item->>'permalink_url', ''),
        preview_url = nullif(v_item->>'preview_url', ''),
        content_type = coalesce(v_item->>'content_type', 'unknown'),
        published_at = coalesce(
          nullif(v_item->>'published_at', '')::timestamptz,
          published_at
        ),
        last_seen_at = now(),
        updated_at = now()
      where platform_account_id = p_platform_account_id
        and source = v_item->>'source'
        and meta_content_id = v_item->>'meta_content_id';
    end if;
  end loop;

  update public.meta_assets
  set
    baseline_completed_at = case
      when p_is_baseline then coalesce(baseline_completed_at, now())
      else baseline_completed_at
    end,
    last_synced_at = now(),
    updated_at = now()
  where id = p_meta_asset_id;

  return query select v_seen, v_inserted, v_new;
end;
$$;

revoke all on function public.record_meta_content_candidates(
  uuid, uuid, uuid, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.record_meta_content_candidates(
  uuid, uuid, uuid, boolean, jsonb
) to service_role;

comment on function public.record_meta_content_candidates(uuid, uuid, uuid, boolean, jsonb) is
  'Records FB/IG content candidates; only posts published within 7 days are is_new (soft-baseline after connect, capped).';

revoke all on function public.record_meta_content_candidates(
  uuid, uuid, uuid, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.record_meta_content_candidates(
  uuid, uuid, uuid, boolean, jsonb
) to service_role;

commit;

notify pgrst, 'reload schema';
