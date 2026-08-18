-- Meta ad sibling success-control pause.
-- Topology: exactly 1 ACTIVE ad set with ≥2 ACTIVE ads under a managed campaign.
-- Relative ranking (same KPI as ABO sibling success); pause weakest clear loser only.
-- Never leave fewer than 1 ACTIVE ad. No min-volume stop.
-- Do NOT pause ads when campaign has 2+ ACTIVE ad sets (budget reallocation path).
-- Does not redefine organic boost materialize.

begin;

create or replace function public.rebuild_meta_campaign_recommendations(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_window_end date,
  p_currency text,
  p_generated_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_window_end is null
    or not exists (
      select 1
      from public.platform_accounts pa
      where pa.id = p_platform_account_id
        and pa.user_id = p_user_id
        and pa.platform = 'meta'
        and pa.revoked_at is null
    ) then
    raise exception 'Invalid Meta recommendation scope';
  end if;

  update public.campaign_recommendations
  set status = 'expired', updated_at = p_generated_at
  where platform_account_id = p_platform_account_id
    and status = 'active';

  -- Rule 1: active campaigns without delivery for three complete days.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'active_without_delivery_3d',
    1,
    'warning',
    90,
    'Auslieferung der aktiven Kampagne prüfen',
    'Für diese aktive Kampagne wurden an drei vollständigen Tagen weder Impressionen noch Ausgaben erfasst. Prüfe Freigaben, Zeitplan und Auslieferungsstatus in Meta.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 2,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      c.user_id,
      c.platform_account_id,
      c.id as campaign_id,
      jsonb_build_object(
        'rule', 'active_without_delivery_3d',
        'campaign_name', c.name,
        'effective_status', coalesce(c.effective_status, c.status),
        'days_without_delivery', 3,
        'minimum_campaign_age_days', 2,
        'window_start', p_window_end - 2,
        'window_end', p_window_end
      ) as evidence
    from public.campaigns c
    where c.platform_account_id = p_platform_account_id
      and c.user_id = p_user_id
      and c.is_current
      and coalesce(c.effective_status, c.status) = 'ACTIVE'
      and (c.start_time is null or c.start_time::date <= p_window_end - 2)
      and not exists (
        select 1
        from public.performance_data pd
        where pd.platform_account_id = c.platform_account_id
          and pd.campaign_id = c.id
          and pd.platform = 'meta'
          and pd.date between p_window_end - 2 and p_window_end
          and (coalesce(pd.impressions, 0) > 0 or coalesce(pd.spend, 0) > 0)
      )
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  -- Rule 2: cost per tracked result increased by at least 30% week over week.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'cost_per_result_up_30pct',
    1,
    'warning',
    80,
    'Kosten pro Ergebnis sind deutlich gestiegen',
    'Die Kosten pro erfasstem Ergebnis liegen mindestens 30 % über der Vorwoche. Prüfe Creative, Zielgruppe und Auslieferungsumfeld, bevor Budget verändert wird.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 13,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      weekly.user_id,
      weekly.platform_account_id,
      weekly.campaign_id,
      jsonb_build_object(
        'rule', 'cost_per_result_up_30pct',
        'campaign_name', weekly.campaign_name,
        'result_type', weekly.result_type,
        'current_cost_per_result', round(weekly.current_spend / weekly.current_results, 4),
        'previous_cost_per_result', round(weekly.previous_spend / weekly.previous_results, 4),
        'increase_percent', round(
          ((weekly.current_spend / weekly.current_results)
            / (weekly.previous_spend / weekly.previous_results) - 1) * 100,
          2
        ),
        'current_results', weekly.current_results,
        'previous_results', weekly.previous_results,
        'currency', p_currency,
        'threshold_percent', 30,
        'window_start', p_window_end - 13,
        'window_end', p_window_end
      ) as evidence
    from (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        case when c.objective = 'OUTCOME_SALES' then 'purchases' else 'leads' end as result_type,
        coalesce(sum(pd.spend) filter (
          where pd.date between p_window_end - 6 and p_window_end
        ), 0) as current_spend,
        coalesce(sum(pd.spend) filter (
          where pd.date between p_window_end - 13 and p_window_end - 7
        ), 0) as previous_spend,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between p_window_end - 6 and p_window_end
        ), 0)::numeric as current_results,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) filter (
          where pd.date between p_window_end - 13 and p_window_end - 7
        ), 0)::numeric as previous_results
      from public.campaigns c
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 13 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')
      group by c.user_id, c.platform_account_id, c.id, c.name, c.objective
    ) weekly
    where weekly.current_results >= 3
      and weekly.previous_results >= 3
      and weekly.current_spend > 0
      and weekly.previous_spend > 0
      and (weekly.current_spend / weekly.current_results)
        >= (weekly.previous_spend / weekly.previous_results) * 1.3
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  -- Rule 3: meaningful 14-day spend with observed result tracking but no results.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'spend_without_results_14d',
    1,
    'warning',
    75,
    'Ausgaben ohne erfasstes Ergebnis',
    'In 14 vollständigen Tagen wurden Ausgaben und Auslieferung erfasst, aber kein passendes Ergebnis. Prüfe Tracking, Zielseite und Kampagnenaufbau vor einer Budgetentscheidung.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 13,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      summary.user_id,
      summary.platform_account_id,
      summary.campaign_id,
      jsonb_build_object(
        'rule', 'spend_without_results_14d',
        'campaign_name', summary.campaign_name,
        'result_type', summary.result_type,
        'spend', round(summary.spend, 2),
        'impressions', summary.impressions,
        'results', summary.results,
        'currency', p_currency,
        'minimum_spend', 50,
        'minimum_impressions', 1000,
        'window_start', p_window_end - 13,
        'window_end', p_window_end
      ) as evidence
    from (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        case when c.objective = 'OUTCOME_SALES' then 'purchases' else 'leads' end as result_type,
        coalesce(sum(pd.spend), 0) as spend,
        coalesce(sum(pd.impressions), 0) as impressions,
        coalesce(sum(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ), 0)::numeric as results,
        count(
          case when c.objective = 'OUTCOME_SALES' then pd.purchases else pd.leads end
        ) as observed_result_rows
      from public.campaigns c
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 13 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')
      group by c.user_id, c.platform_account_id, c.id, c.name, c.objective
    ) summary
    where summary.observed_result_rows > 0
      and summary.spend >= 50
      and summary.impressions >= 1000
      and summary.results = 0
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  -- Rule 4: low link CTR with sufficient delivery on performance objectives.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    'low_link_ctr_7d',
    1,
    'opportunity',
    65,
    'Link-Klickrate liegt unter dem Prüfwert',
    'Die Link-Klickrate liegt bei ausreichender Auslieferung unter 0,50 %. Prüfe Botschaft, Creative und Zielgruppenpassung; die Empfehlung nimmt keine Änderung vor.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 6,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    select
      ctr.user_id,
      ctr.platform_account_id,
      ctr.campaign_id,
      jsonb_build_object(
        'rule', 'low_link_ctr_7d',
        'campaign_name', ctr.campaign_name,
        'impressions', ctr.impressions,
        'inline_link_clicks', ctr.inline_link_clicks,
        'link_ctr_percent', round(ctr.inline_link_clicks * 100 / ctr.impressions, 4),
        'threshold_percent', 0.5,
        'minimum_impressions', 1000,
        'window_start', p_window_end - 6,
        'window_end', p_window_end
      ) as evidence
    from (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        coalesce(sum(pd.impressions), 0)::numeric as impressions,
        coalesce(sum(pd.inline_link_clicks), 0)::numeric as inline_link_clicks,
        count(pd.inline_link_clicks) as observed_link_click_rows
      from public.campaigns c
      join public.performance_data pd
        on pd.platform_account_id = c.platform_account_id
       and pd.campaign_id = c.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 6 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and c.objective in ('OUTCOME_TRAFFIC', 'OUTCOME_LEADS', 'OUTCOME_SALES')
      group by c.user_id, c.platform_account_id, c.id, c.name
    ) ctr
    where ctr.observed_link_click_rows > 0
      and ctr.impressions >= 1000
      and ctr.inline_link_clicks * 100 / ctr.impressions < 0.5
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;


  -- Rule 5: ABO sibling success ranking (relative only; no min-volume stop).
  -- Analysis-friendly opportunity; write path is queue_meta_sibling_budget_reallocate_internal.
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, ad_group_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    candidate.winner_ad_group_id,
    'abo_sibling_success_rank_7d',
    1,
    'opportunity',
    55,
    'Erfolgssteuerung: Budget zwischen Ad Sets umschichten',
    'Bei gleicher ABO-Kampagne schichtet Adbot Budget relativ vom schwächeren zum stärkeren Ad Set um. Die Summe der Tagesbudgets bleibt konstant; niedrige Volumina stoppen keine Kampagne.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 6,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    with abo_siblings as (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        c.objective,
        ag.id as ad_group_id,
        ag.platform_ad_group_id,
        ag.name as ad_group_name,
        coalesce(ag.daily_budget_minor, 0) as daily_budget_minor,
        case
          when c.objective in ('OUTCOME_TRAFFIC', 'LINK_CLICKS') then 'traffic'
          when c.objective in ('OUTCOME_LEADS', 'LEAD_GENERATION') then 'leads'
          when c.objective in ('OUTCOME_SALES', 'CONVERSIONS') then 'sales'
          else 'unsupported'
        end as success_kind,
        coalesce(sum(pd.spend), 0)::numeric as spend,
        coalesce(sum(pd.impressions), 0)::bigint as impressions,
        coalesce(sum(pd.inline_link_clicks), 0)::numeric as inline_link_clicks,
        coalesce(sum(pd.leads), 0)::numeric as leads,
        coalesce(sum(pd.purchases), 0)::numeric as purchases
      from public.campaigns c
      join public.ad_groups ag
        on ag.campaign_id = c.id
       and ag.is_current
       and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
       and coalesce(ag.daily_budget_minor, 0) > 0
      left join public.performance_data pd
        on pd.platform_account_id = ag.platform_account_id
       and pd.ad_group_id = ag.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 6 and p_window_end
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and coalesce(c.daily_budget_minor, 0) = 0
        and c.objective in (
          'OUTCOME_TRAFFIC', 'LINK_CLICKS',
          'OUTCOME_LEADS', 'LEAD_GENERATION',
          'OUTCOME_SALES', 'CONVERSIONS'
        )
      group by
        c.user_id, c.platform_account_id, c.id, c.name, c.objective,
        ag.id, ag.platform_ad_group_id, ag.name, ag.daily_budget_minor
    ),
    scored as (
      select
        s.*,
        case s.success_kind
          when 'traffic' then s.inline_link_clicks
          when 'leads' then s.leads
          when 'sales' then s.purchases
          else 0
        end as primary_results,
        case
          when s.success_kind = 'traffic' and s.inline_link_clicks > 0
            then s.spend / s.inline_link_clicks
          when s.success_kind = 'leads' and s.leads > 0
            then s.spend / s.leads
          when s.success_kind = 'sales' and s.purchases > 0
            then s.spend / s.purchases
          else null
        end as tie_break_cost
      from abo_siblings s
      where s.success_kind <> 'unsupported'
    ),
    ranked as (
      select
        scored.*,
        row_number() over (
          partition by scored.campaign_id
          order by
            case when scored.primary_results > 0 then 1 else 0 end desc,
            scored.primary_results desc,
            scored.tie_break_cost asc nulls last,
            case
              when scored.primary_results = 0 and scored.spend > 0 then 1
              else 0
            end asc,
            scored.spend asc,
            scored.platform_ad_group_id asc
        ) as rank_best,
        row_number() over (
          partition by scored.campaign_id
          order by
            case when scored.primary_results > 0 then 1 else 0 end asc,
            scored.primary_results asc,
            scored.tie_break_cost desc nulls first,
            case
              when scored.primary_results = 0 and scored.spend > 0 then 1
              else 0
            end desc,
            scored.spend desc,
            scored.platform_ad_group_id desc
        ) as rank_worst,
        count(*) over (partition by scored.campaign_id) as sibling_count
      from scored
    ),
    pairs as (
      select
        w.user_id,
        w.platform_account_id,
        w.campaign_id,
        w.campaign_name,
        w.objective,
        w.success_kind,
        w.ad_group_id as winner_ad_group_id,
        w.platform_ad_group_id as winner_platform_ad_group_id,
        w.daily_budget_minor as winner_budget,
        w.primary_results as winner_primary,
        w.tie_break_cost as winner_cost,
        w.spend as winner_spend,
        l.ad_group_id as loser_ad_group_id,
        l.platform_ad_group_id as loser_platform_ad_group_id,
        l.daily_budget_minor as loser_budget,
        l.primary_results as loser_primary,
        l.tie_break_cost as loser_cost,
        l.spend as loser_spend,
        (l.daily_budget_minor * 1000) / 10000 as proposed_delta_minor
      from ranked w
      join ranked l
        on l.campaign_id = w.campaign_id
       and l.rank_worst = 1
       and w.rank_best = 1
      where w.sibling_count >= 2
        and w.ad_group_id <> l.ad_group_id
        and not (
          w.primary_results = l.primary_results
          and w.tie_break_cost is not distinct from l.tie_break_cost
          and w.spend = l.spend
        )
        and (l.daily_budget_minor * 1000) / 10000 >= 1
        and l.daily_budget_minor - (l.daily_budget_minor * 1000) / 10000 > 0
    )
    select
      pairs.user_id,
      pairs.platform_account_id,
      pairs.campaign_id,
      pairs.winner_ad_group_id,
      jsonb_build_object(
        'rule', 'abo_sibling_success_rank_7d',
        'campaign_name', pairs.campaign_name,
        'objective', pairs.objective,
        'success_kind', pairs.success_kind,
        'relative_ranking', true,
        'no_min_volume_stop', true,
        'sum_constant', true,
        'change_bps', 1000,
        'proposed_delta_minor', pairs.proposed_delta_minor,
        'winner', jsonb_build_object(
          'ad_group_id', pairs.winner_ad_group_id,
          'platform_ad_group_id', pairs.winner_platform_ad_group_id,
          'daily_budget_minor', pairs.winner_budget,
          'primary_results', pairs.winner_primary,
          'tie_break_cost', pairs.winner_cost,
          'spend', pairs.winner_spend,
          'budget_after_minor', pairs.winner_budget + pairs.proposed_delta_minor
        ),
        'loser', jsonb_build_object(
          'ad_group_id', pairs.loser_ad_group_id,
          'platform_ad_group_id', pairs.loser_platform_ad_group_id,
          'daily_budget_minor', pairs.loser_budget,
          'primary_results', pairs.loser_primary,
          'tie_break_cost', pairs.loser_cost,
          'spend', pairs.loser_spend,
          'budget_after_minor', pairs.loser_budget - pairs.proposed_delta_minor
        ),
        'window_start', p_window_end - 6,
        'window_end', p_window_end,
        'currency', p_currency
      ) as evidence
    from pairs
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at,
    ad_group_id = excluded.ad_group_id;




  -- Rule 6: Ad sibling success pause (1 ACTIVE ad set, ≥2 ACTIVE ads).
  -- Relative ranking only; pause weakest ad; never leave fewer than 1 ACTIVE ad.
  -- Write path is queue_meta_ad_sibling_success_pause_internal (not used when 2+ ACTIVE ad sets).
  insert into public.campaign_recommendations (
    user_id, platform_account_id, campaign_id, ad_group_id, ad_id, rule_key, rule_version,
    severity, priority, title, summary, evidence, evidence_hash,
    window_start, window_end, status, generated_at, expires_at, updated_at
  )
  select
    candidate.user_id,
    candidate.platform_account_id,
    candidate.campaign_id,
    candidate.ad_group_id,
    candidate.weaker_ad_id,
    'ad_sibling_success_pause_7d',
    1,
    'opportunity',
    54,
    'Erfolgssteuerung: schwächste Anzeige pausieren',
    'Bei einer aktiven Ad Set mit mehreren aktiven Anzeigen pausiert Adbot relativ die schwächste Anzeige. Mindestens eine Anzeige bleibt aktiv; niedrige Volumina stoppen keine Kampagne.',
    candidate.evidence,
    md5(candidate.evidence::text),
    p_window_end - 6,
    p_window_end,
    'active',
    p_generated_at,
    p_generated_at + interval '26 hours',
    p_generated_at
  from (
    with single_adset_campaigns as (
      select
        c.user_id,
        c.platform_account_id,
        c.id as campaign_id,
        c.name as campaign_name,
        c.objective,
        ag.id as ad_group_id,
        ag.platform_ad_group_id,
        case
          when c.objective in ('OUTCOME_TRAFFIC', 'LINK_CLICKS') then 'traffic'
          when c.objective in ('OUTCOME_LEADS', 'LEAD_GENERATION') then 'leads'
          when c.objective in ('OUTCOME_SALES', 'CONVERSIONS') then 'sales'
          else 'unsupported'
        end as success_kind
      from public.campaigns c
      join public.ad_groups ag
        on ag.campaign_id = c.id
       and ag.is_current
       and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
      where c.platform_account_id = p_platform_account_id
        and c.user_id = p_user_id
        and c.is_current
        and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and c.objective in (
          'OUTCOME_TRAFFIC', 'LINK_CLICKS',
          'OUTCOME_LEADS', 'LEAD_GENERATION',
          'OUTCOME_SALES', 'CONVERSIONS'
        )
        and (
          select count(*)
          from public.ad_groups ag2
          where ag2.campaign_id = c.id
            and ag2.is_current
            and coalesce(ag2.effective_status, ag2.status) = 'ACTIVE'
        ) = 1
    ),
    ad_siblings as (
      select
        sac.*,
        a.id as ad_id,
        a.platform_ad_id,
        a.name as ad_name,
        coalesce(sum(pd.spend), 0)::numeric as spend,
        coalesce(sum(pd.impressions), 0)::bigint as impressions,
        coalesce(sum(pd.inline_link_clicks), 0)::numeric as inline_link_clicks,
        coalesce(sum(pd.leads), 0)::numeric as leads,
        coalesce(sum(pd.purchases), 0)::numeric as purchases
      from single_adset_campaigns sac
      join public.ads a
        on a.ad_group_id = sac.ad_group_id
       and a.is_current
       and coalesce(a.effective_status, a.status) = 'ACTIVE'
      left join public.performance_data pd
        on pd.platform_account_id = a.platform_account_id
       and pd.ad_id = a.id
       and pd.platform = 'meta'
       and pd.date between p_window_end - 6 and p_window_end
      where sac.success_kind <> 'unsupported'
      group by
        sac.user_id, sac.platform_account_id, sac.campaign_id, sac.campaign_name,
        sac.objective, sac.ad_group_id, sac.platform_ad_group_id, sac.success_kind,
        a.id, a.platform_ad_id, a.name
    ),
    scored as (
      select
        s.*,
        case s.success_kind
          when 'traffic' then s.inline_link_clicks
          when 'leads' then s.leads
          when 'sales' then s.purchases
          else 0
        end as primary_results,
        case
          when s.success_kind = 'traffic' and s.inline_link_clicks > 0
            then s.spend / s.inline_link_clicks
          when s.success_kind = 'leads' and s.leads > 0
            then s.spend / s.leads
          when s.success_kind = 'sales' and s.purchases > 0
            then s.spend / s.purchases
          else null
        end as tie_break_cost
      from ad_siblings s
    ),
    ranked as (
      select
        scored.*,
        row_number() over (
          partition by scored.campaign_id
          order by
            case when scored.primary_results > 0 then 1 else 0 end desc,
            scored.primary_results desc,
            scored.tie_break_cost asc nulls last,
            case
              when scored.primary_results = 0 and scored.spend > 0 then 1
              else 0
            end asc,
            scored.spend asc,
            scored.platform_ad_id asc
        ) as rank_best,
        row_number() over (
          partition by scored.campaign_id
          order by
            case when scored.primary_results > 0 then 1 else 0 end asc,
            scored.primary_results asc,
            scored.tie_break_cost desc nulls first,
            case
              when scored.primary_results = 0 and scored.spend > 0 then 1
              else 0
            end desc,
            scored.spend desc,
            scored.platform_ad_id desc
        ) as rank_worst,
        count(*) over (partition by scored.campaign_id) as sibling_count
      from scored
    ),
    pairs as (
      select
        w.user_id,
        w.platform_account_id,
        w.campaign_id,
        w.campaign_name,
        w.objective,
        w.success_kind,
        w.ad_group_id,
        w.platform_ad_group_id,
        w.ad_id as stronger_ad_id,
        w.platform_ad_id as stronger_platform_ad_id,
        w.ad_name as stronger_ad_name,
        w.primary_results as stronger_primary,
        w.tie_break_cost as stronger_cost,
        w.spend as stronger_spend,
        l.ad_id as weaker_ad_id,
        l.platform_ad_id as weaker_platform_ad_id,
        l.ad_name as weaker_ad_name,
        l.primary_results as weaker_primary,
        l.tie_break_cost as weaker_cost,
        l.spend as weaker_spend,
        w.sibling_count
      from ranked w
      join ranked l
        on l.campaign_id = w.campaign_id
       and l.rank_worst = 1
       and w.rank_best = 1
      where w.sibling_count >= 2
        and w.ad_id <> l.ad_id
        and not (
          w.primary_results = l.primary_results
          and w.tie_break_cost is not distinct from l.tie_break_cost
          and w.spend = l.spend
        )
    )
    select
      pairs.user_id,
      pairs.platform_account_id,
      pairs.campaign_id,
      pairs.ad_group_id,
      pairs.weaker_ad_id,
      jsonb_build_object(
        'rule', 'ad_sibling_success_pause_7d',
        'campaign_name', pairs.campaign_name,
        'objective', pairs.objective,
        'success_kind', pairs.success_kind,
        'relative_ranking', true,
        'no_min_volume_stop', true,
        'active_ad_set_count', 1,
        'active_ad_count', pairs.sibling_count,
        'keep_at_least_one_active_ad', true,
        'ad_group_id', pairs.ad_group_id,
        'platform_ad_group_id', pairs.platform_ad_group_id,
        'stronger_ad', jsonb_build_object(
          'ad_id', pairs.stronger_ad_id,
          'platform_ad_id', pairs.stronger_platform_ad_id,
          'name', pairs.stronger_ad_name,
          'primary_results', pairs.stronger_primary,
          'tie_break_cost', pairs.stronger_cost,
          'spend', pairs.stronger_spend
        ),
        'weaker_ad', jsonb_build_object(
          'ad_id', pairs.weaker_ad_id,
          'platform_ad_id', pairs.weaker_platform_ad_id,
          'name', pairs.weaker_ad_name,
          'primary_results', pairs.weaker_primary,
          'tie_break_cost', pairs.weaker_cost,
          'spend', pairs.weaker_spend
        ),
        'window_start', p_window_end - 6,
        'window_end', p_window_end,
        'currency', p_currency
      ) as evidence
    from pairs
  ) candidate
  on conflict (platform_account_id, rule_key, rule_version, target_key)
  do update set
    severity = excluded.severity,
    priority = excluded.priority,
    title = excluded.title,
    summary = excluded.summary,
    evidence = excluded.evidence,
    evidence_hash = excluded.evidence_hash,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    status = 'active',
    generated_at = excluded.generated_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at,
    ad_group_id = excluded.ad_group_id,
    ad_id = excluded.ad_id;


  select count(*)::integer into v_count
  from public.campaign_recommendations
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
    and status = 'active'
    and expires_at > p_generated_at;

  return v_count;
end;
$$;

-- Pause one MANAGED AD for ad-sibling success control (not SAFETY_PAUSE).
-- Requires allow_status_changes and kill-switch ALLOW only.
create or replace function public.queue_meta_ad_sibling_success_pause_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_automation_target_id uuid,
  p_evidence jsonb,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_target public.automation_targets%rowtype;
  v_ad public.ads%rowtype;
  v_kill_mode text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan_id uuid;
  v_idempotency_key text;
  v_payload jsonb;
  v_payload_hash text;
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
  v_active_sibling_count integer;
begin
  if jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_pause_evidence'
    );
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_status_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'status_changes_not_allowed'
    );
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type = 'AD'
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'invalid_ad_target'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':status-target:' || v_target.target_key,
      0
    )
  );

  select a.* into v_ad
  from public.ads a
  where a.id = v_target.ad_id
    and a.user_id = p_user_id
    and a.platform_account_id = p_platform_account_id
    and a.is_current
    and a.last_seen_sync_id = p_source_marketing_sync_id
  for update;

  if not found
    or coalesce(v_ad.effective_status, v_ad.status) <> 'ACTIVE' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'ad_not_active'
    );
  end if;

  -- Never leave fewer than 1 ACTIVE ad under the same ad set.
  select count(*)::integer into v_active_sibling_count
  from public.ads sibling
  where sibling.ad_group_id = v_ad.ad_group_id
    and sibling.is_current
    and sibling.last_seen_sync_id = p_source_marketing_sync_id
    and coalesce(sibling.effective_status, sibling.status) = 'ACTIVE';

  if coalesce(v_active_sibling_count, 0) < 2 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'would_leave_zero_active_ads'
    );
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  -- Success-control ad pause requires ALLOW only (not PAUSE_MANAGED).
  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'kill_switch_blocks_status_write'
    );
  end if;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.target_type = 'AD'
    and mp.target_key = v_target.target_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_ad_plan',
      'plan_id', v_existing_plan_id
    );
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_STATUS',
    'object_type', 'AD',
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'status', 'PAUSED',
    'source_rule_key', 'ad_sibling_success_pause_7d',
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'exposure_snapshot_id', p_snapshot_id,
    'evidence', p_evidence
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_source_marketing_sync_id::text || '|ad-sibling-success-pause|'
    || v_target.target_key || '|' || v_payload_hash
  );

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.idempotency_key = v_idempotency_key;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'idempotent_replay',
      'plan_id', v_existing_plan_id
    );
  end if;

  insert into public.mutation_plans (
    id,
    user_id,
    platform_account_id,
    policy_id,
    source_marketing_sync_id,
    source_rule_key,
    source_rule_version,
    action_type,
    target_type,
    target_key,
    campaign_scope_key,
    budget_owner_key,
    automation_target_id,
    idempotency_key,
    expected_before,
    intended_after,
    planned_payload,
    payload_hash,
    status,
    priority,
    safety_action,
    not_before,
    max_attempts,
    created_at,
    updated_at
  ) values (
    v_plan_id,
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    p_source_marketing_sync_id,
    'ad_sibling_success_pause_7d',
    1,
    'PAUSE',
    'AD',
    v_target.target_key,
    v_target.campaign_scope_key,
    v_target.budget_owner_key,
    v_target.id,
    v_idempotency_key,
    jsonb_build_object(
      'status', coalesce(v_ad.effective_status, v_ad.status),
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    jsonb_build_object('status', 'PAUSED'),
    v_payload,
    v_payload_hash,
    'PENDING',
    54,
    false,
    p_planned_at,
    5,
    p_planned_at,
    p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_STATUS',
    'object_type', 'AD',
    'object_id', v_target.platform_object_id,
    'status', 'PAUSED',
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', 'AD',
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_status', 'PAUSED',
    'exposure_snapshot_id', p_snapshot_id,
    'safety_action', false,
    'source_rule_key', 'ad_sibling_success_pause_7d'
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-ad-sibling-pause', 'VALIDATE', 'AD', null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-ad-sibling-pause', 'UPDATE', 'AD', v_step_validate,
    v_mutate_request, public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-ad-sibling-pause', 'READ', 'AD', v_step_mutate,
    v_read_request, public.meta_sha256(v_read_request::text),
    jsonb_build_object('status', 'PAUSED'), 'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-ad-sibling-pause', 'RECONCILE', 'AD', v_step_read,
    v_reconcile_request, public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'), 'NONE', 'PENDING'
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    p_policy_id,
    v_plan_id,
    null,
    null,
    'SYSTEM',
    'meta-budget-planner',
    'AD_SIBLING_SUCCESS_PAUSE_QUEUED',
    jsonb_build_object(
      'status', coalesce(v_ad.effective_status, v_ad.status)
    ),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object('status', 'PAUSED', 'plan_status', 'PENDING'),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'ad_sibling_success_pause',
    'plan_id', v_plan_id
  );
end;
$$;

-- Finder: for campaigns with exactly 1 ACTIVE ad set and ≥2 ACTIVE MANAGED ads,
-- relatively rank ads and queue a PAUSE for the clear loser only.
-- Do NOT pause ads when the campaign has 2+ ACTIVE ad sets (budget reallocate path).
create or replace function public.queue_meta_ad_sibling_success_pause_scan_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_planned_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.platform_accounts%rowtype;
  v_campaign record;
  v_winner record;
  v_loser record;
  v_evidence jsonb;
  v_result jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_blocked integer := 0;
  v_skipped integer := 0;
  v_window_start date;
  v_window_end date;
  v_active_ad_set_count integer;
begin
  select pa.* into v_account
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null;

  if not found
    or v_account.marketing_insights_until is null then
    return jsonb_build_object(
      'outcome', 'SKIPPED',
      'reason', 'missing_insights_window',
      'created', 0, 'existing', 0, 'blocked', 0, 'skipped', 0
    );
  end if;

  v_window_end := v_account.marketing_insights_until;
  v_window_start := v_window_end - 6;

  drop table if exists pg_temp.ad_sibling_rank;
  create temporary table ad_sibling_rank (
    ad_id uuid primary key,
    platform_ad_id text not null,
    ad_name text,
    ad_group_id uuid not null,
    automation_target_id uuid not null,
    spend numeric not null,
    primary_results numeric not null,
    tie_break_cost numeric,
    zero_spend_burn boolean not null
  ) on commit drop;

  for v_campaign in
    select
      c.id as campaign_id,
      c.platform_campaign_id,
      c.name as campaign_name,
      c.objective,
      'campaign:' || c.platform_campaign_id as campaign_scope_key,
      case
        when c.objective in ('OUTCOME_TRAFFIC', 'LINK_CLICKS') then 'traffic'
        when c.objective in ('OUTCOME_LEADS', 'LEAD_GENERATION') then 'leads'
        when c.objective in ('OUTCOME_SALES', 'CONVERSIONS') then 'sales'
        else 'unsupported'
      end as success_kind
    from public.campaigns c
    where c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current
      and c.last_seen_sync_id = p_source_marketing_sync_id
      and coalesce(c.effective_status, c.status) = 'ACTIVE'
      and c.objective in (
        'OUTCOME_TRAFFIC', 'LINK_CLICKS',
        'OUTCOME_LEADS', 'LEAD_GENERATION',
        'OUTCOME_SALES', 'CONVERSIONS'
      )
    order by c.platform_campaign_id
  loop
    if v_campaign.success_kind = 'unsupported' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select count(*)::integer into v_active_ad_set_count
    from public.ad_groups ag
    where ag.campaign_id = v_campaign.campaign_id
      and ag.is_current
      and ag.last_seen_sync_id = p_source_marketing_sync_id
      and coalesce(ag.effective_status, ag.status) = 'ACTIVE';

    -- Budget reallocation owns the 2+ ACTIVE ad-set topology.
    if coalesce(v_active_ad_set_count, 0) <> 1 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    truncate pg_temp.ad_sibling_rank;

    insert into pg_temp.ad_sibling_rank (
      ad_id, platform_ad_id, ad_name, ad_group_id, automation_target_id,
      spend, primary_results, tie_break_cost, zero_spend_burn
    )
    select
      a.id,
      a.platform_ad_id,
      a.name,
      a.ad_group_id,
      target.id,
      coalesce(sum(pd.spend), 0)::numeric,
      case v_campaign.success_kind
        when 'traffic' then coalesce(sum(pd.inline_link_clicks), 0)::numeric
        when 'leads' then coalesce(sum(pd.leads), 0)::numeric
        else coalesce(sum(pd.purchases), 0)::numeric
      end,
      case
        when v_campaign.success_kind = 'traffic'
          and coalesce(sum(pd.inline_link_clicks), 0) > 0
          then coalesce(sum(pd.spend), 0)::numeric
            / coalesce(sum(pd.inline_link_clicks), 0)::numeric
        when v_campaign.success_kind = 'leads'
          and coalesce(sum(pd.leads), 0) > 0
          then coalesce(sum(pd.spend), 0)::numeric
            / coalesce(sum(pd.leads), 0)::numeric
        when v_campaign.success_kind = 'sales'
          and coalesce(sum(pd.purchases), 0) > 0
          then coalesce(sum(pd.spend), 0)::numeric
            / coalesce(sum(pd.purchases), 0)::numeric
        else null
      end,
      (
        case v_campaign.success_kind
          when 'traffic' then coalesce(sum(pd.inline_link_clicks), 0)
          when 'leads' then coalesce(sum(pd.leads), 0)
          else coalesce(sum(pd.purchases), 0)
        end = 0
        and coalesce(sum(pd.spend), 0) > 0
      )
    from public.ads a
    join public.ad_groups ag
      on ag.id = a.ad_group_id
     and ag.campaign_id = v_campaign.campaign_id
     and ag.is_current
     and ag.last_seen_sync_id = p_source_marketing_sync_id
     and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
    join public.automation_targets target
      on target.platform_account_id = a.platform_account_id
     and target.target_type = 'AD'
     and target.platform_object_id = a.platform_ad_id
     and target.status = 'MANAGED'
     and target.campaign_scope_key = v_campaign.campaign_scope_key
     and target.ad_id = a.id
    left join public.performance_data pd
      on pd.platform_account_id = a.platform_account_id
     and pd.ad_id = a.id
     and pd.platform = 'meta'
     and pd.last_seen_sync_id = p_source_marketing_sync_id
     and pd.date between v_window_start and v_window_end
    where a.user_id = p_user_id
      and a.platform_account_id = p_platform_account_id
      and a.is_current
      and a.last_seen_sync_id = p_source_marketing_sync_id
      and coalesce(a.effective_status, a.status) = 'ACTIVE'
      and not exists (
        select 1
        from public.mutation_plans mp
        where mp.platform_account_id = p_platform_account_id
          and mp.target_type = 'AD'
          and mp.target_key = target.target_key
          and mp.status in (
            'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
            'RETRYABLE', 'COMPENSATION_REQUIRED'
          )
      )
    group by
      a.id, a.platform_ad_id, a.name, a.ad_group_id, target.id;

    if (select count(*) from pg_temp.ad_sibling_rank) < 2 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_winner
    from pg_temp.ad_sibling_rank s
    order by
      case when s.primary_results > 0 then 1 else 0 end desc,
      s.primary_results desc,
      s.tie_break_cost asc nulls last,
      case when s.zero_spend_burn then 1 else 0 end asc,
      s.spend asc,
      s.platform_ad_id asc
    limit 1;

    select * into v_loser
    from pg_temp.ad_sibling_rank s
    order by
      case when s.primary_results > 0 then 1 else 0 end asc,
      s.primary_results asc,
      s.tie_break_cost desc nulls first,
      case when s.zero_spend_burn then 1 else 0 end desc,
      s.spend desc,
      s.platform_ad_id desc
    limit 1;

    -- Pause only a clear loser; skip pure ties.
    if v_winner.ad_id = v_loser.ad_id
      or (
        v_winner.primary_results = v_loser.primary_results
        and v_winner.tie_break_cost is not distinct from v_loser.tie_break_cost
        and v_winner.spend = v_loser.spend
      ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_evidence := jsonb_build_object(
      'rule', 'ad_sibling_success_pause_7d',
      'relative_ranking', true,
      'no_min_volume_stop', true,
      'keep_at_least_one_active_ad', true,
      'active_ad_set_count', 1,
      'active_ad_count', (select count(*) from pg_temp.ad_sibling_rank),
      'success_kind', v_campaign.success_kind,
      'objective', v_campaign.objective,
      'campaign_id', v_campaign.campaign_id,
      'campaign_scope_key', v_campaign.campaign_scope_key,
      'window_start', v_window_start,
      'window_end', v_window_end,
      'stronger_ad', jsonb_build_object(
        'ad_id', v_winner.ad_id,
        'platform_ad_id', v_winner.platform_ad_id,
        'name', v_winner.ad_name,
        'ad_group_id', v_winner.ad_group_id,
        'primary_results', v_winner.primary_results,
        'tie_break_cost', v_winner.tie_break_cost,
        'spend', v_winner.spend
      ),
      'weaker_ad', jsonb_build_object(
        'ad_id', v_loser.ad_id,
        'platform_ad_id', v_loser.platform_ad_id,
        'name', v_loser.ad_name,
        'ad_group_id', v_loser.ad_group_id,
        'primary_results', v_loser.primary_results,
        'tie_break_cost', v_loser.tie_break_cost,
        'spend', v_loser.spend
      )
    );

    v_result := public.queue_meta_ad_sibling_success_pause_internal(
      p_user_id,
      p_platform_account_id,
      p_policy_id,
      p_snapshot_id,
      p_source_marketing_sync_id,
      v_loser.automation_target_id,
      v_evidence,
      p_planned_at
    );

    if v_result->>'outcome' in ('CREATED', 'QUEUED') then
      v_created := v_created + 1;
    elsif v_result->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'outcome', 'DONE',
    'created', v_created,
    'existing', v_existing,
    'blocked', v_blocked,
    'skipped', v_skipped
  );
end;
$$;

-- Extend run_meta_budget_planner: after ABO sibling reallocate (if present),
-- scan for 1-ad-set / multi-ad success pauses.
do $patch_planner$
declare
  v_function regprocedure :=
    'public.run_meta_budget_planner(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition is null then
    raise exception 'run_meta_budget_planner not found';
  end if;

  if position('queue_meta_ad_sibling_success_pause_scan_internal' in v_definition) > 0 then
    return;
  end if;

  -- Insert immediately before the final PLANNED return (after sibling reallocate
  -- when that block is already present in the function body).
  v_updated := regexp_replace(
    v_definition,
    E'return query select\\s+'
    || E'''PLANNED''::text,\\s+'
    || E'v_refresh\\.snapshot_id,\\s+'
    || E'v_refresh\\.account_day,\\s+'
    || E'v_refresh\\.observed_budget_owner_count,\\s+'
    || E'v_refresh\\.reserved_exposure_minor,\\s+'
    || E'v_created,\\s+'
    || E'v_existing,\\s+'
    || E'v_blocked,\\s+'
    || E'false;\\s+'
    || E'end;',
    $repl$
  -- Ad sibling success-control: 1 ACTIVE ad set, ≥2 ACTIVE ads → pause weakest.
  -- Skips when 2+ ACTIVE ad sets (budget reallocation path). Relative ranking only.
  -- Runs after ABO sibling budget reallocate when that call is already patched in.
  v_result := public.queue_meta_ad_sibling_success_pause_scan_internal(
    p_user_id,
    p_platform_account_id,
    v_policy.id,
    v_refresh.snapshot_id,
    p_source_marketing_sync_id,
    p_planned_at
  );
  if coalesce((v_result->>'created')::integer, 0) > 0 then
    v_created := v_created + coalesce((v_result->>'created')::integer, 0);
  end if;
  if coalesce((v_result->>'existing')::integer, 0) > 0 then
    v_existing := v_existing + coalesce((v_result->>'existing')::integer, 0);
  end if;
  if coalesce((v_result->>'blocked')::integer, 0) > 0 then
    v_blocked := v_blocked + coalesce((v_result->>'blocked')::integer, 0);
  end if;

  return query select
    'PLANNED'::text,
    v_refresh.snapshot_id,
    v_refresh.account_day,
    v_refresh.observed_budget_owner_count,
    v_refresh.reserved_exposure_minor,
    v_created,
    v_existing,
    v_blocked,
    false;
end;$repl$,
    1
  );

  if position('queue_meta_ad_sibling_success_pause_scan_internal' in v_updated) = 0 then
    raise exception
      'ad sibling success pause patch did not apply to run_meta_budget_planner';
  end if;

  execute v_updated;
end;
$patch_planner$;

revoke all on function public.queue_meta_ad_sibling_success_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;

revoke all on function public.queue_meta_ad_sibling_success_pause_scan_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;

revoke all on function public.rebuild_meta_campaign_recommendations(
  uuid, uuid, date, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.rebuild_meta_campaign_recommendations(
  uuid, uuid, date, text, timestamptz
) to service_role;

grant execute on function public.queue_meta_ad_sibling_success_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) to service_role;

grant execute on function public.queue_meta_ad_sibling_success_pause_scan_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.queue_meta_ad_sibling_success_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb, timestamptz
) is
  'Queues a non-safety PAUSE plan for one MANAGED AD under ad-sibling success control. Requires allow_status_changes and kill-switch ALLOW; never leaves fewer than 1 ACTIVE ad.';

comment on function public.queue_meta_ad_sibling_success_pause_scan_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Finds campaigns with exactly 1 ACTIVE ad set and ≥2 ACTIVE MANAGED ads, ranks relatively, and queues PAUSE for the clear loser only. Skips 2+ ACTIVE ad-set topologies.';

comment on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Builds conservative Meta daily exposure, queues safety/budget plans, ABO sibling reallocations, then ad-sibling success pauses (1 ad set / multi-ad). No remote mutation.';

commit;
