-- Soft-baseline for newly connected FB/IG assets:
-- First Abruf must not bury posts that were published at/after the asset was
-- added to Adbot (common when extending Meta and posting just before/after).
-- Historical inventory (published before connect) stays is_new=false.

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

    -- Soft-baseline: posts at/after asset connect (6h grace) stay boostable.
    v_is_new := case
      when not p_is_baseline then true
      when v_published_at is not null
        and v_published_at >= (v_asset_created_at - interval '6 hours')
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
  'Records FB/IG content candidates; soft-baseline keeps posts published at/after asset connect as is_new.';

-- Heal recent false-baseline candidates (wire-free / unboosted only).
update public.meta_content_candidates candidate
set
  is_new = true,
  updated_at = now()
from public.meta_assets asset
where asset.id = candidate.meta_asset_id
  and asset.user_id = candidate.user_id
  and asset.platform_account_id = candidate.platform_account_id
  and asset.asset_type in ('facebook_page', 'instagram_account')
  and candidate.is_new is not true
  and candidate.published_at is not null
  and candidate.published_at >= (asset.created_at - interval '6 hours')
  and candidate.first_seen_at >= now() - interval '14 days'
  and not exists (
    select 1
    from public.meta_organic_boost_links link_row
    where link_row.content_candidate_id = candidate.id
  );

commit;
