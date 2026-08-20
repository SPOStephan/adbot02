-- Creative Generation Phase 8: auto performance_winner from Insights.
-- 1) Merge creative image_hash/url into creatives.content (sync already sends them).
-- 2) Rank ad→asset performance (7d, success-control metrics) and label winners.
-- Does not change organic boost / launch materialize / customer mark RPC.

begin;

create index if not exists brand_assets_meta_image_hash_idx
  on public.brand_assets (platform_account_id, meta_image_hash)
  where library_scope = 'CUSTOMER'
    and meta_image_hash is not null;

comment on index public.brand_assets_meta_image_hash_idx is
  'Phase 8: join Meta creative image_hash to customer brand_assets.';

-- Persist media fields that serializeCreatives already sends but replace dropped.
create or replace function public.merge_meta_creative_media_fields(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_creatives jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Creative media merge identity is incomplete';
  end if;

  if jsonb_typeof(coalesce(p_creatives, '[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(p_creatives, '[]'::jsonb)) > 100000 then
    raise exception 'Creative media merge payload is invalid';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta platform account is required';
  end if;

  with incoming as (
    select
      item.platform_creative_id,
      nullif(lower(btrim(coalesce(item.image_hash, ''))), '') as image_hash,
      nullif(btrim(coalesce(item.image_url, '')), '') as image_url,
      nullif(btrim(coalesce(item.thumbnail_url, '')), '') as thumbnail_url
    from jsonb_to_recordset(coalesce(p_creatives, '[]'::jsonb)) as item(
      platform_creative_id text,
      image_hash text,
      image_url text,
      thumbnail_url text
    )
    where nullif(btrim(coalesce(item.platform_creative_id, '')), '') is not null
  ),
  touched as (
    update public.creatives c
    set content = jsonb_strip_nulls(
          coalesce(c.content, '{}'::jsonb)
          || jsonb_build_object(
            'image_hash', i.image_hash,
            'image_url', i.image_url,
            'thumbnail_url', coalesce(
              i.thumbnail_url,
              nullif(c.content->>'thumbnail_url', '')
            )
          )
        ),
        thumbnail_url = coalesce(i.thumbnail_url, c.thumbnail_url),
        updated_at = now()
    from incoming i
    where c.platform_account_id = p_platform_account_id
      and c.user_id = p_user_id
      and c.source = 'meta'
      and c.platform_creative_id = i.platform_creative_id
      and (
        i.image_hash is not null
        or i.image_url is not null
        or i.thumbnail_url is not null
      )
    returning 1
  )
  select count(*)::integer into v_updated from touched;

  return v_updated;
end;
$$;

revoke all on function public.merge_meta_creative_media_fields(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_meta_creative_media_fields(uuid, uuid, jsonb)
  to service_role;

comment on function public.merge_meta_creative_media_fields(uuid, uuid, jsonb) is
  'Phase 8: merge image_hash/image_url/thumbnail_url into creatives.content after marketing snapshot.';

-- Label top-N performing customer assets as performance_winner.
create or replace function public.apply_brand_asset_performance_winners(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_top_n integer default 5,
  p_window_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_top_n integer := greatest(1, least(coalesce(p_top_n, 5), 25));
  v_window_days integer := greatest(1, least(coalesce(p_window_days, 7), 37));
  v_window_end date;
  v_window_start date;
  v_winner_ids uuid[] := array[]::uuid[];
  v_promoted integer := 0;
  v_demoted integer := 0;
  v_skipped_marked_good integer := 0;
  v_unmatched_ads integer := 0;
  v_candidate_assets integer := 0;
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Performance winner identity is incomplete';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta platform account is required';
  end if;

  select max(pd.date)::date
  into v_window_end
  from public.performance_data pd
  where pd.platform_account_id = p_platform_account_id
    and pd.user_id = p_user_id
    and pd.platform = 'meta'
    and pd.entity_type = 'ad';

  if v_window_end is null then
    return jsonb_build_object(
      'promoted', 0,
      'demoted', 0,
      'skipped_marked_good', 0,
      'unmatched_ads', 0,
      'candidate_assets', 0,
      'winner_ids', '[]'::jsonb,
      'window_days', v_window_days,
      'window_end', null
    );
  end if;

  v_window_start := v_window_end - (v_window_days - 1);

  with scored_ads as (
    select
      a.id as ad_id,
      a.platform_ad_id,
      a.creative_id,
      a.platform_creative_id,
      c.objective,
      case
        when c.objective in ('OUTCOME_TRAFFIC', 'LINK_CLICKS', 'TRAFFIC')
          then 'traffic'
        when c.objective in ('OUTCOME_LEADS', 'LEAD_GENERATION', 'LEADS')
          then 'leads'
        when c.objective in ('OUTCOME_SALES', 'CONVERSIONS', 'SALES')
          then 'sales'
        else 'unsupported'
      end as success_kind,
      coalesce(sum(pd.spend), 0)::numeric as spend,
      coalesce(sum(pd.inline_link_clicks), 0)::numeric as inline_link_clicks,
      coalesce(sum(pd.leads), 0)::numeric as leads,
      coalesce(sum(pd.purchases), 0)::numeric as purchases
    from public.ads a
    join public.ad_groups ag
      on ag.id = a.ad_group_id
     and ag.platform_account_id = a.platform_account_id
    join public.campaigns c
      on c.id = ag.campaign_id
     and c.platform_account_id = a.platform_account_id
    left join public.performance_data pd
      on pd.platform_account_id = a.platform_account_id
     and pd.user_id = a.user_id
     and pd.platform = 'meta'
     and pd.entity_type = 'ad'
     and pd.ad_id = a.id
     and pd.date between v_window_start and v_window_end
    where a.platform_account_id = p_platform_account_id
      and a.user_id = p_user_id
      and a.is_current
      and c.objective in (
        'OUTCOME_TRAFFIC', 'LINK_CLICKS', 'TRAFFIC',
        'OUTCOME_LEADS', 'LEAD_GENERATION', 'LEADS',
        'OUTCOME_SALES', 'CONVERSIONS', 'SALES'
      )
    group by a.id, a.platform_ad_id, a.creative_id, a.platform_creative_id,
             c.objective
  ),
  primary_ads as (
    select
      s.*,
      case s.success_kind
        when 'traffic' then s.inline_link_clicks
        when 'leads' then s.leads
        when 'sales' then s.purchases
        else 0
      end as primary_results
    from scored_ads s
    where s.success_kind <> 'unsupported'
  ),
  joined as (
    select distinct on (p.ad_id)
      p.ad_id,
      p.platform_ad_id,
      p.spend,
      p.primary_results,
      ba.id as brand_asset_id,
      case
        when ba.meta_image_hash is not null
          and lower(ba.meta_image_hash) = lower(nullif(cr.content->>'image_hash', ''))
          then 0
        else 1
      end as join_rank
    from primary_ads p
    left join public.creatives cr
      on cr.platform_account_id = p_platform_account_id
     and cr.source = 'meta'
     and (
       (p.creative_id is not null and cr.id = p.creative_id)
       or (
         p.platform_creative_id is not null
         and cr.platform_creative_id = p.platform_creative_id
       )
     )
    left join public.brand_assets ba
      on ba.platform_account_id = p_platform_account_id
     and ba.user_id = p_user_id
     and ba.library_scope = 'CUSTOMER'
     and ba.status = 'READY'
     and ba.moderation_status = 'APPROVED'
     and ba.asset_role in ('UPLOAD_EDITABLE', 'GENERATED', 'LOCKED_PHOTO')
     and (
       (
         ba.meta_image_hash is not null
         and nullif(cr.content->>'image_hash', '') is not null
         and lower(ba.meta_image_hash) = lower(cr.content->>'image_hash')
       )
       or (
         ba.source_meta_asset_id is not null
         and cr.platform_creative_id is not null
         and ba.source_meta_asset_id = cr.platform_creative_id
       )
     )
    order by p.ad_id, join_rank, ba.id
  ),
  unmatched as (
    select count(*)::integer as n
    from joined j
    where j.brand_asset_id is null
      and exists (
        select 1 from primary_ads p where p.ad_id = j.ad_id and p.primary_results > 0
      )
  ),
  asset_scores as (
    select
      j.brand_asset_id,
      sum(j.spend)::numeric as spend,
      sum(j.primary_results)::numeric as primary_results,
      min(j.platform_ad_id::text) as stable_id
    from joined j
    where j.brand_asset_id is not null
    group by j.brand_asset_id
  ),
  ranked as (
    select
      a.brand_asset_id,
      a.spend,
      a.primary_results,
      row_number() over (
        order by
          case when a.primary_results > 0 then 1 else 0 end desc,
          a.primary_results desc,
          case
            when a.primary_results > 0 then a.spend / a.primary_results
            else null
          end asc nulls last,
          case when a.primary_results = 0 and a.spend > 0 then 1 else 0 end asc,
          a.spend asc,
          a.stable_id asc
      ) as rank_index
    from asset_scores a
  ),
  winners as (
    select r.brand_asset_id
    from ranked r
    where r.primary_results > 0
      and r.rank_index <= v_top_n
  ),
  summary as (
    select
      coalesce(
        (select array_agg(w.brand_asset_id) from winners w),
        array[]::uuid[]
      ) as winner_ids,
      (select count(*)::integer from asset_scores) as candidate_assets,
      (select n from unmatched) as unmatched_ads
  )
  select s.winner_ids, s.candidate_assets, s.unmatched_ads
  into v_winner_ids, v_candidate_assets, v_unmatched_ads
  from summary s;

  v_winner_ids := coalesce(v_winner_ids, array[]::uuid[]);

  update public.brand_assets ba
  set training_status = 'performance_winner',
      updated_at = now()
  where ba.platform_account_id = p_platform_account_id
    and ba.user_id = p_user_id
    and ba.id = any (v_winner_ids)
    and ba.training_status = 'none';

  get diagnostics v_promoted = row_count;

  select count(*)::integer
  into v_skipped_marked_good
  from public.brand_assets ba
  where ba.platform_account_id = p_platform_account_id
    and ba.user_id = p_user_id
    and ba.id = any (v_winner_ids)
    and ba.training_status = 'marked_good';

  update public.brand_assets ba
  set training_status = 'none',
      marked_good_at = null,
      marked_good_by = null,
      updated_at = now()
  where ba.platform_account_id = p_platform_account_id
    and ba.user_id = p_user_id
    and ba.library_scope = 'CUSTOMER'
    and ba.training_status = 'performance_winner'
    and not (ba.id = any (v_winner_ids));

  get diagnostics v_demoted = row_count;

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'SYSTEM', 'creative-performance-winners', 'BRAND_ASSET_PERFORMANCE_WINNERS_APPLIED',
    '{}'::jsonb,
    jsonb_build_object(
      'top_n', v_top_n,
      'window_days', v_window_days,
      'window_start', v_window_start,
      'window_end', v_window_end,
      'winner_ids', to_jsonb(v_winner_ids),
      'promoted', v_promoted,
      'demoted', v_demoted,
      'skipped_marked_good', v_skipped_marked_good,
      'unmatched_ads', v_unmatched_ads,
      'candidate_assets', v_candidate_assets
    ),
    '{}'::jsonb,
    jsonb_build_object('status', 'APPLIED'),
    '{}'::jsonb,
    null, null, null, null, null, now()
  );

  return jsonb_build_object(
    'promoted', v_promoted,
    'demoted', v_demoted,
    'skipped_marked_good', v_skipped_marked_good,
    'unmatched_ads', v_unmatched_ads,
    'candidate_assets', v_candidate_assets,
    'winner_ids', to_jsonb(v_winner_ids),
    'window_days', v_window_days,
    'window_start', v_window_start,
    'window_end', v_window_end,
    'top_n', v_top_n
  );
end;
$$;

revoke all on function public.apply_brand_asset_performance_winners(
  uuid, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.apply_brand_asset_performance_winners(
  uuid, uuid, integer, integer
) to service_role;

comment on function public.apply_brand_asset_performance_winners(
  uuid, uuid, integer, integer
) is
  'Phase 8: label top-N customer brand_assets as performance_winner from 7d ad Insights; never overwrite marked_good.';

commit;
