-- Meta ABO sibling success-control budget reallocation.
-- Relative ranking only (prefer best / least-bad); never stop campaigns for low volume.
-- No hard min-volume gates (do not copy >=5 results from cost_per_result_down_15pct).
-- Sum of sibling ABO ad-set daily budgets stays constant.
-- Transfer up to 1000 bps of loser daily_budget to winner per planner run,
-- subject to existing cooldown / 20% / 24h / policy / kill-switch gates.

begin;

-- Aggregated ad-set performance helper (last 7 calendar days ending at max date per account).
create or replace view public.meta_ad_set_performance_7d
with (security_invoker = true)
as
with account_anchor as (
  select
    pd.user_id,
    pd.platform_account_id,
    max(pd.date) as window_end
  from public.performance_data pd
  where pd.platform = 'meta'
  group by pd.user_id, pd.platform_account_id
)
select
  pd.user_id,
  pd.platform_account_id,
  pd.campaign_id,
  pd.ad_group_id,
  ag.platform_ad_group_id,
  ag.name as ad_group_name,
  anchor.window_end - 6 as window_start,
  anchor.window_end,
  coalesce(sum(pd.spend), 0) as spend,
  coalesce(sum(pd.impressions), 0) as impressions,
  coalesce(sum(pd.inline_link_clicks), 0) as inline_link_clicks,
  coalesce(sum(pd.leads), 0) as leads,
  coalesce(sum(pd.purchases), 0) as purchases,
  case
    when coalesce(sum(pd.inline_link_clicks), 0) > 0
      then coalesce(sum(pd.spend), 0) / sum(pd.inline_link_clicks)
    else null
  end as link_cpc,
  case
    when coalesce(sum(pd.leads), 0) > 0
      then coalesce(sum(pd.spend), 0) / sum(pd.leads)
    else null
  end as cpl
from public.performance_data pd
join account_anchor anchor
  on anchor.user_id = pd.user_id
 and anchor.platform_account_id = pd.platform_account_id
join public.ad_groups ag
  on ag.id = pd.ad_group_id
where pd.platform = 'meta'
  and pd.date between anchor.window_end - 6 and anchor.window_end
group by
  pd.user_id,
  pd.platform_account_id,
  pd.campaign_id,
  pd.ad_group_id,
  ag.platform_ad_group_id,
  ag.name,
  anchor.window_end;

revoke all on public.meta_ad_set_performance_7d from public, anon;
grant select on public.meta_ad_set_performance_7d to authenticated, service_role;

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


  select count(*)::integer into v_count
  from public.campaign_recommendations
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
    and status = 'active'
    and expires_at > p_generated_at;

  return v_count;
end;
$$;

create or replace function public.queue_meta_budget_plan_internal(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_source_marketing_sync_id uuid,
  p_source_recommendation_id uuid,
  p_source_rule_key text,
  p_source_rule_version integer,
  p_automation_target_id uuid,
  p_direction text,
  p_change_bps integer,
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
  v_exposure public.daily_budget_exposures%rowtype;
  v_recommendation public.campaign_recommendations%rowtype;
  v_campaign_id uuid;
  v_campaign_scope_key text;
  v_current_budget bigint;
  v_remote_status text;
  v_object_sync_id uuid;
  v_intended_budget bigint;
  v_latest_change timestamptz;
  v_baseline_budget bigint;
  v_movement_used bigint;
  v_movement_limit bigint;
  v_candidate_delta bigint;
  v_predicted_exposure bigint;
  v_campaign_total bigint;
  v_account_total bigint;
  v_campaign_cap bigint;
  v_kill_mode text;
  v_payload jsonb;
  v_payload_hash text;
  v_idempotency_key text;
  v_plan_id uuid := gen_random_uuid();
  v_existing_plan_id uuid;
  v_step_validate uuid := gen_random_uuid();
  v_step_mutate uuid := gen_random_uuid();
  v_step_read uuid := gen_random_uuid();
  v_step_reconcile uuid := gen_random_uuid();
  v_validate_request jsonb;
  v_mutate_request jsonb;
  v_read_request jsonb;
  v_reconcile_request jsonb;
  v_priority integer;
  v_absolute_delta bigint;
  v_paired_before bigint;
  v_paired_flex integer;
  v_paired_predicted bigint;
  v_paired_reserved bigint;
begin
  if jsonb_typeof(p_evidence) <> 'object'
    or pg_catalog.pg_column_size(p_evidence) > 65536 then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_evidence');
  end if;

  if (p_source_rule_key = 'spend_without_results_14d'
      and (p_direction <> 'DECREASE' or p_change_bps <> 2000
        or p_source_recommendation_id is null))
    or (p_source_rule_key = 'cost_per_result_up_30pct'
      and (p_direction <> 'DECREASE' or p_change_bps <> 1000
        or p_source_recommendation_id is null))
    or (p_source_rule_key = 'cost_per_result_down_15pct'
      and (p_direction <> 'INCREASE' or p_change_bps <> 1000
        or p_source_recommendation_id is not null))
    or (p_source_rule_key = 'abo_sibling_reallocate_v1'
      and (
        p_change_bps <> 1000
        or p_direction not in ('DECREASE', 'INCREASE')
        or p_source_recommendation_id is not null
        or coalesce(p_evidence->>'reallocation_group_id', '') = ''
        or coalesce((p_evidence->>'absolute_delta_minor')::bigint, 0) < 1
      ))
    or p_source_rule_key not in (
      'spend_without_results_14d',
      'cost_per_result_up_30pct',
      'cost_per_result_down_15pct',
      'abo_sibling_reallocate_v1'
    ) then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'unsupported_rule');
  end if;

  select ap.* into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found or not v_policy.allow_budget_changes then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'budget_changes_not_allowed'
    );
  end if;

  select target.* into v_target
  from public.automation_targets target
  where target.id = p_automation_target_id
    and target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.target_type in ('CAMPAIGN', 'AD_SET')
    and target.budget_owner_type = target.target_type
    and target.budget_owner_key = target.target_key
    and target.status = 'MANAGED'
  for update;

  if not found then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'invalid_target');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':budget-owner:' || v_target.budget_owner_key,
      0
    )
  );

  if v_target.target_type = 'CAMPAIGN' then
    select
      c.id,
      'campaign:' || c.platform_campaign_id,
      c.daily_budget_minor,
      coalesce(c.effective_status, c.status, 'UNKNOWN'),
      c.last_seen_sync_id
    into
      v_campaign_id,
      v_campaign_scope_key,
      v_current_budget,
      v_remote_status,
      v_object_sync_id
    from public.campaigns c
    where c.id = v_target.campaign_id
      and c.user_id = p_user_id
      and c.platform_account_id = p_platform_account_id
      and c.is_current;
  else
    select
      c.id,
      'campaign:' || c.platform_campaign_id,
      ag.daily_budget_minor,
      coalesce(ag.effective_status, ag.status, 'UNKNOWN'),
      ag.last_seen_sync_id
    into
      v_campaign_id,
      v_campaign_scope_key,
      v_current_budget,
      v_remote_status,
      v_object_sync_id
    from public.ad_groups ag
    join public.campaigns c on c.id = ag.campaign_id
    where ag.id = v_target.ad_group_id
      and ag.user_id = p_user_id
      and ag.platform_account_id = p_platform_account_id
      and ag.is_current
      and c.is_current;
  end if;

  if v_current_budget is null
    or v_current_budget <= 0
    or v_object_sync_id is distinct from p_source_marketing_sync_id
    or v_remote_status <> 'ACTIVE' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'stale_or_inactive_target'
    );
  end if;

  if p_source_recommendation_id is not null then
    select r.* into v_recommendation
    from public.campaign_recommendations r
    where r.id = p_source_recommendation_id
      and r.user_id = p_user_id
      and r.platform_account_id = p_platform_account_id
      and r.campaign_id = v_campaign_id
      and r.rule_key = p_source_rule_key
      and r.rule_version = p_source_rule_version
      and r.status = 'active'
      and r.expires_at > p_planned_at
      and r.evidence = p_evidence;

    if not found then
      return jsonb_build_object(
        'outcome', 'BLOCKED', 'reason', 'stale_recommendation'
      );
    end if;
  end if;

  select ks.mode into v_kill_mode
  from public.get_effective_meta_kill_switch(
    p_user_id,
    p_platform_account_id,
    null
  ) ks;

  if coalesce(v_kill_mode, 'ALLOW') <> 'ALLOW' then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'kill_switch');
  end if;

  select mp.id into v_existing_plan_id
  from public.mutation_plans mp
  where mp.platform_account_id = p_platform_account_id
    and mp.budget_owner_key = v_target.budget_owner_key
    and mp.status in (
      'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
      'RETRYABLE', 'COMPENSATION_REQUIRED'
    )
  order by mp.created_at desc
  limit 1;

  if v_existing_plan_id is not null then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'pending_owner_plan',
      'plan_id', v_existing_plan_id
    );
  end if;

  select
    max(bml.executed_at),
    coalesce(sum(bml.absolute_delta_minor), 0)
  into v_latest_change, v_movement_used
  from public.budget_mutation_ledger bml
  where bml.platform_account_id = p_platform_account_id
    and bml.budget_owner_key = v_target.budget_owner_key
    and bml.executed_at > p_planned_at - interval '24 hours'
    and bml.executed_at <= p_planned_at;

  if v_target.last_successful_mutation_at is not null
    and (
      v_latest_change is null
      or v_target.last_successful_mutation_at > v_latest_change
    ) then
    v_latest_change := v_target.last_successful_mutation_at;
  end if;

  if v_latest_change is not null
    and v_latest_change + make_interval(secs => v_policy.cooldown_seconds)
      > p_planned_at then
    return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'cooldown');
  end if;

  select bml.before_budget_minor
    into v_baseline_budget
  from public.budget_mutation_ledger bml
  where bml.platform_account_id = p_platform_account_id
    and bml.budget_owner_key = v_target.budget_owner_key
    and bml.executed_at > p_planned_at - interval '24 hours'
    and bml.executed_at <= p_planned_at
  order by bml.executed_at asc, bml.created_at asc
  limit 1;

  v_baseline_budget := coalesce(v_baseline_budget, v_current_budget);
  v_movement_limit :=
    (v_baseline_budget * v_policy.budget_change_limit_bps) / 10000;

  if p_source_rule_key = 'abo_sibling_reallocate_v1' then
    -- Absolute transfer keeps sibling ABO sum constant (loser -delta, winner +delta).
    v_absolute_delta := (p_evidence->>'absolute_delta_minor')::bigint;
    if p_direction = 'INCREASE' then
      v_intended_budget := v_current_budget + v_absolute_delta;
    else
      v_intended_budget := v_current_budget - v_absolute_delta;
    end if;
  elsif p_direction = 'INCREASE' then
    v_intended_budget :=
      (v_current_budget * (10000 + p_change_bps)) / 10000;
    if v_intended_budget <= v_current_budget then
      v_intended_budget := v_current_budget + 1;
    end if;
  else
    v_intended_budget :=
      (v_current_budget * (10000 - p_change_bps) + 9999) / 10000;
    if v_intended_budget >= v_current_budget then
      v_intended_budget := v_current_budget - 1;
    end if;
  end if;

  if v_intended_budget <= 0 then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'non_positive_budget'
    );
  end if;

  v_candidate_delta := abs(v_intended_budget - v_current_budget);

  if v_movement_limit <= 0
    or v_movement_used + v_candidate_delta > v_movement_limit then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'rolling_24h_limit'
    );
  end if;

  select dbe.* into v_exposure
  from public.daily_budget_exposures dbe
  join public.daily_budget_exposure_snapshots s
    on s.id = p_snapshot_id
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = s.account_day
    and dbe.budget_owner_key = v_target.budget_owner_key
    and s.user_id = p_user_id
    and s.platform_account_id = p_platform_account_id
    and s.policy_id = p_policy_id
    and s.source_marketing_sync_id = p_source_marketing_sync_id
    and s.status = 'COMPLETE';

  if not found then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'missing_exposure'
    );
  end if;

  if p_direction = 'INCREASE' then
    v_predicted_exposure := greatest(
      v_exposure.reserved_exposure_minor,
      public.meta_calculate_exposure_minor(
        v_intended_budget,
        greatest(
          v_exposure.flex_spend_multiplier_bps,
          case
            when v_exposure.shared_budget_enabled
              then v_policy.shared_budget_flex_spend_multiplier_bps
            else v_policy.standard_flex_spend_multiplier_bps
          end
        )
      )
    );

    select coalesce(sum(dbe.reserved_exposure_minor), 0)
      into v_campaign_total
    from public.daily_budget_exposures dbe
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_exposure.account_day
      and dbe.campaign_scope_key = v_campaign_scope_key;

    select coalesce(sum(dbe.reserved_exposure_minor), 0)
      into v_account_total
    from public.daily_budget_exposures dbe
    where dbe.platform_account_id = p_platform_account_id
      and dbe.account_day = v_exposure.account_day;

    -- Sibling ABO reallocation: sum of budgets stays constant. When flex matches,
    -- net exposure should not inflate — credit the paired DECREASE already queued.
    if p_source_rule_key = 'abo_sibling_reallocate_v1'
      and coalesce(p_evidence->>'paired_budget_owner_key', '') <> ''
      and coalesce((p_evidence->>'paired_before_budget_minor')::bigint, 0) > 0 then
      v_paired_before := (p_evidence->>'paired_before_budget_minor')::bigint;
      v_absolute_delta := (p_evidence->>'absolute_delta_minor')::bigint;
      select dbe.flex_spend_multiplier_bps
        into v_paired_flex
      from public.daily_budget_exposures dbe
      where dbe.platform_account_id = p_platform_account_id
        and dbe.account_day = v_exposure.account_day
        and dbe.budget_owner_key = p_evidence->>'paired_budget_owner_key';
      if found
        and v_paired_flex = v_exposure.flex_spend_multiplier_bps then
        v_paired_predicted := public.meta_calculate_exposure_minor(
          v_paired_before - v_absolute_delta,
          v_paired_flex
        );
        select dbe.reserved_exposure_minor
          into v_paired_reserved
        from public.daily_budget_exposures dbe
        where dbe.platform_account_id = p_platform_account_id
          and dbe.account_day = v_exposure.account_day
          and dbe.budget_owner_key = p_evidence->>'paired_budget_owner_key';
        if found then
          v_campaign_total := v_campaign_total
            - v_paired_reserved + v_paired_predicted;
          v_account_total := v_account_total
            - v_paired_reserved + v_paired_predicted;
        end if;
      end if;
    end if;

    select coalesce(
      cbl.daily_hard_cap_minor,
      v_policy.default_campaign_daily_hard_cap_minor
    ) into v_campaign_cap
    from (select 1) seed
    left join public.campaign_budget_limits cbl
      on cbl.policy_id = p_policy_id
     and cbl.user_id = p_user_id
     and cbl.platform_account_id = p_platform_account_id
     and cbl.campaign_scope_key = v_campaign_scope_key;

    if v_campaign_total - v_exposure.reserved_exposure_minor
         + v_predicted_exposure > v_campaign_cap
      or v_account_total - v_exposure.reserved_exposure_minor
         + v_predicted_exposure > v_policy.account_daily_hard_cap_minor then
      return jsonb_build_object('outcome', 'BLOCKED', 'reason', 'hard_cap');
    end if;
  end if;

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'operation', 'UPDATE_BUDGET',
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'target_key', v_target.target_key,
    'budget_type', 'daily_budget',
    'amount_minor', v_intended_budget,
    'direction', p_direction,
    'change_bps', p_change_bps,
    'rule_key', p_source_rule_key,
    'rule_version', p_source_rule_version,
    'source_marketing_sync_id', p_source_marketing_sync_id,
    'exposure_snapshot_id', p_snapshot_id,
    'evidence', p_evidence
  );
  v_payload_hash := public.meta_sha256(v_payload::text);
  v_idempotency_key := public.meta_sha256(
    p_user_id::text || '|' || p_platform_account_id::text || '|'
    || p_policy_id::text || '|' || v_policy.policy_hash || '|'
    || p_source_marketing_sync_id::text || '|'
    || coalesce(p_source_recommendation_id::text, '') || '|'
    || p_source_rule_key || '|' || p_source_rule_version::text || '|'
    || v_target.target_type || '|' || v_target.target_key || '|'
    || v_current_budget::text || '|' || v_intended_budget::text || '|'
    || v_payload_hash
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

  v_priority := case
    when p_source_rule_key = 'spend_without_results_14d' then 80
    when p_source_rule_key = 'cost_per_result_up_30pct' then 75
    when p_source_rule_key = 'abo_sibling_reallocate_v1' then 55
    else 60
  end;

  insert into public.mutation_plans (
    id,
    user_id,
    platform_account_id,
    policy_id,
    source_marketing_sync_id,
    source_recommendation_id,
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
    p_source_recommendation_id,
    p_source_rule_key,
    p_source_rule_version,
    'UPDATE_BUDGET',
    v_target.target_type,
    v_target.target_key,
    v_campaign_scope_key,
    v_target.budget_owner_key,
    v_target.id,
    v_idempotency_key,
    jsonb_build_object(
      'daily_budget_minor', v_current_budget,
      'status', v_remote_status,
      'source_marketing_sync_id', p_source_marketing_sync_id
    ),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    v_payload,
    v_payload_hash,
    'PENDING',
    v_priority,
    false,
    p_planned_at,
    5,
    p_planned_at,
    p_planned_at
  );

  v_validate_request := jsonb_build_object(
    'operation', 'UPDATE_BUDGET',
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'budget_type', 'daily_budget',
    'amount_minor', v_intended_budget,
    'mode', 'validate_only'
  );
  v_mutate_request :=
    v_validate_request || jsonb_build_object('mode', 'execute');
  v_read_request := jsonb_build_object(
    'object_type', v_target.target_type,
    'object_id', v_target.platform_object_id,
    'fields', jsonb_build_array(
      'id', 'status', 'effective_status', 'daily_budget', 'updated_time'
    )
  );
  v_reconcile_request := jsonb_build_object(
    'expected_daily_budget_minor', v_intended_budget,
    'budget_owner_key', v_target.budget_owner_key,
    'exposure_snapshot_id', p_snapshot_id
  );

  insert into public.mutation_plan_steps (
    id, plan_id, user_id, platform_account_id, step_index, step_key,
    operation, object_type, depends_on_step_id, planned_request,
    request_hash, expected_result, compensation_operation, status
  ) values
  (
    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,
    'validate-budget-update', 'VALIDATE', v_target.target_type, null,
    v_validate_request, public.meta_sha256(v_validate_request::text),
    jsonb_build_object('validated', true), 'NONE', 'PENDING'
  ),
  (
    v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,
    'execute-budget-update', 'UPDATE', v_target.target_type,
    v_step_validate, v_mutate_request,
    public.meta_sha256(v_mutate_request::text),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    'PAUSE', 'PENDING'
  ),
  (
    v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,
    'read-after-budget-update', 'READ', v_target.target_type,
    v_step_mutate, v_read_request,
    public.meta_sha256(v_read_request::text),
    jsonb_build_object('daily_budget_minor', v_intended_budget),
    'NONE', 'PENDING'
  ),
  (
    v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,
    'reconcile-budget-update', 'RECONCILE', v_target.target_type,
    v_step_read, v_reconcile_request,
    public.meta_sha256(v_reconcile_request::text),
    jsonb_build_object('plan_status', 'SUCCEEDED'),
    'NONE', 'PENDING'
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
    'MUTATION_PLAN_QUEUED',
    jsonb_build_object(
      'daily_budget_minor', v_current_budget,
      'status', v_remote_status
    ),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'daily_budget_minor', v_intended_budget,
      'plan_status', 'PENDING'
    ),
    jsonb_build_object(
      'idempotency_key', v_idempotency_key,
      'payload_hash', v_payload_hash
    ),
    null, null, null, null, null, p_planned_at
  );

  return jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'eligible',
    'plan_id', v_plan_id,
    'before_budget_minor', v_current_budget,
    'after_budget_minor', v_intended_budget
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- ABO sibling success reallocation (relative ranking; sum constant)
-- Transfer up to 1000 bps of loser daily_budget to winner per planner run.
-- No hard min-volume gates. Prefer best / least-bad; never stop for low volume.
-- Sum of sibling ABO ad-set daily budgets stays constant.
-- DECREASE loser first, then INCREASE winner (netted exposure when flex equal).
-- ---------------------------------------------------------------------------
create or replace function public.queue_meta_sibling_budget_reallocate_internal(
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
  v_delta bigint;
  v_group_id uuid;
  v_evidence jsonb;
  v_dec jsonb;
  v_inc jsonb;
  v_created integer := 0;
  v_existing integer := 0;
  v_blocked integer := 0;
  v_skipped integer := 0;
  v_window_start date;
  v_window_end date;
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

  -- Working set for one ABO campaign's sibling owners (reused across campaigns).
  drop table if exists pg_temp.sibling_rank;
  create temporary table sibling_rank (
    ad_group_id uuid primary key,
    platform_ad_group_id text not null,
    automation_target_id uuid not null,
    budget_owner_key text not null,
    daily_budget_minor bigint not null,
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
      and coalesce(c.daily_budget_minor, 0) = 0
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

    truncate pg_temp.sibling_rank;

    -- Collect ACTIVE MANAGED AD_SET budget owners under this ABO campaign.
    insert into pg_temp.sibling_rank (
      ad_group_id, platform_ad_group_id, automation_target_id,
      budget_owner_key, daily_budget_minor, spend, primary_results,
      tie_break_cost, zero_spend_burn
    )
    select
      ag.id,
      ag.platform_ad_group_id,
      target.id,
      target.budget_owner_key,
      ag.daily_budget_minor,
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
    from public.ad_groups ag
    join public.automation_targets target
      on target.platform_account_id = ag.platform_account_id
     and target.target_type = 'AD_SET'
     and target.platform_object_id = ag.platform_ad_group_id
     and target.budget_owner_type = 'AD_SET'
     and target.budget_owner_key = target.target_key
     and target.status = 'MANAGED'
     and target.campaign_scope_key = v_campaign.campaign_scope_key
    left join public.performance_data pd
      on pd.platform_account_id = ag.platform_account_id
     and pd.ad_group_id = ag.id
     and pd.platform = 'meta'
     and pd.last_seen_sync_id = p_source_marketing_sync_id
     and pd.date between v_window_start and v_window_end
    where ag.user_id = p_user_id
      and ag.platform_account_id = p_platform_account_id
      and ag.campaign_id = v_campaign.campaign_id
      and ag.is_current
      and ag.last_seen_sync_id = p_source_marketing_sync_id
      and coalesce(ag.effective_status, ag.status) = 'ACTIVE'
      and coalesce(ag.daily_budget_minor, 0) > 0
      and not exists (
        select 1
        from public.mutation_plans mp
        where mp.platform_account_id = p_platform_account_id
          and mp.budget_owner_key = target.budget_owner_key
          and mp.status in (
            'PENDING', 'CLAIMED', 'EXECUTING', 'RECONCILING',
            'RETRYABLE', 'COMPENSATION_REQUIRED'
          )
      )
    group by
      ag.id, ag.platform_ad_group_id, target.id, target.budget_owner_key,
      ag.daily_budget_minor;

    if (select count(*) from pg_temp.sibling_rank) < 2 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into v_winner
    from pg_temp.sibling_rank s
    order by
      case when s.primary_results > 0 then 1 else 0 end desc,
      s.primary_results desc,
      s.tie_break_cost asc nulls last,
      case when s.zero_spend_burn then 1 else 0 end asc,
      s.spend asc,
      s.platform_ad_group_id asc
    limit 1;

    select * into v_loser
    from pg_temp.sibling_rank s
    order by
      case when s.primary_results > 0 then 1 else 0 end asc,
      s.primary_results asc,
      s.tie_break_cost desc nulls first,
      case when s.zero_spend_burn then 1 else 0 end desc,
      s.spend desc,
      s.platform_ad_group_id desc
    limit 1;

    if v_winner.ad_group_id = v_loser.ad_group_id
      or (
        v_winner.primary_results = v_loser.primary_results
        and v_winner.tie_break_cost is not distinct from v_loser.tie_break_cost
        and v_winner.spend = v_loser.spend
      ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Up to 1000 bps of loser budget; skip when delta < 1 minor unit.
    v_delta := (v_loser.daily_budget_minor * 1000) / 10000;
    if v_delta < 1
      or v_loser.daily_budget_minor - v_delta <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Assert sum of sibling ABO ad-set daily budgets stays constant.
    if (v_winner.daily_budget_minor + v_loser.daily_budget_minor)
      <> (v_winner.daily_budget_minor + v_delta
          + v_loser.daily_budget_minor - v_delta) then
      raise exception 'sibling ABO reallocation sum invariant violated';
    end if;

    v_group_id := gen_random_uuid();
    v_evidence := jsonb_build_object(
      'rule', 'abo_sibling_reallocate_v1',
      'reallocation_group_id', v_group_id,
      'absolute_delta_minor', v_delta,
      'change_bps', 1000,
      'sum_constant', true,
      'relative_ranking', true,
      'no_min_volume_stop', true,
      'success_kind', v_campaign.success_kind,
      'objective', v_campaign.objective,
      'campaign_id', v_campaign.campaign_id,
      'campaign_scope_key', v_campaign.campaign_scope_key,
      'window_start', v_window_start,
      'window_end', v_window_end,
      'winner_ad_group_id', v_winner.ad_group_id,
      'loser_ad_group_id', v_loser.ad_group_id,
      'winner_platform_ad_group_id', v_winner.platform_ad_group_id,
      'loser_platform_ad_group_id', v_loser.platform_ad_group_id,
      'winner_primary_results', v_winner.primary_results,
      'loser_primary_results', v_loser.primary_results,
      'winner_tie_break_cost', v_winner.tie_break_cost,
      'loser_tie_break_cost', v_loser.tie_break_cost,
      'winner_budget_before_minor', v_winner.daily_budget_minor,
      'loser_budget_before_minor', v_loser.daily_budget_minor,
      'winner_budget_after_minor', v_winner.daily_budget_minor + v_delta,
      'loser_budget_after_minor', v_loser.daily_budget_minor - v_delta
    );

    -- DECREASE loser first (order matters for netted exposure / fail-closed).
    v_dec := public.queue_meta_budget_plan_internal(
      p_user_id,
      p_platform_account_id,
      p_policy_id,
      p_snapshot_id,
      p_source_marketing_sync_id,
      null,
      'abo_sibling_reallocate_v1',
      1,
      v_loser.automation_target_id,
      'DECREASE',
      1000,
      v_evidence || jsonb_build_object(
        'role', 'loser',
        'paired_budget_owner_key', v_winner.budget_owner_key,
        'paired_before_budget_minor', v_winner.daily_budget_minor
      ),
      p_planned_at
    );

    if v_dec->>'outcome' in ('CREATED', 'QUEUED') then
      v_created := v_created + 1;
    elsif v_dec->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
      v_skipped := v_skipped + 1;
      continue;
    else
      v_blocked := v_blocked + 1;
      continue;
    end if;

    v_inc := public.queue_meta_budget_plan_internal(
      p_user_id,
      p_platform_account_id,
      p_policy_id,
      p_snapshot_id,
      p_source_marketing_sync_id,
      null,
      'abo_sibling_reallocate_v1',
      1,
      v_winner.automation_target_id,
      'INCREASE',
      1000,
      v_evidence || jsonb_build_object(
        'role', 'winner',
        'paired_budget_owner_key', v_loser.budget_owner_key,
        'paired_before_budget_minor', v_loser.daily_budget_minor,
        'paired_decrease_plan_id', v_dec->>'plan_id'
      ),
      p_planned_at
    );

    if v_inc->>'outcome' in ('CREATED', 'QUEUED') then
      v_created := v_created + 1;
    elsif v_inc->>'outcome' = 'EXISTING' then
      v_existing := v_existing + 1;
    else
      -- Fail-closed: if increase blocked after decrease created, cancel orphan decrease.
      if v_dec->>'outcome' in ('CREATED', 'QUEUED') and v_dec ? 'plan_id' then
        update public.mutation_plans mp
        set
          status = 'CANCELLED',
          blocked_reason = 'sibling_reallocate_increase_blocked',
          terminal_at = p_planned_at,
          updated_at = p_planned_at
        where mp.id = (v_dec->>'plan_id')::uuid
          and mp.status = 'PENDING'
          and mp.attempt_count = 0;
      end if;
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

-- Extend run_meta_budget_planner: after existing rules, queue ABO sibling reallocations.
-- Skip owners that already received a plan this run / have pending plans (enforced inside helper).
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

  if position('queue_meta_sibling_budget_reallocate_internal' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'end loop;\\s+'
    || E'return query select\\s+'
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
    $repl$end loop;

  -- ABO sibling success-control: relative ranking, sum-constant reallocation.
  -- No hard min-volume gates; prefer best / least-bad; never stop for low volume.
  -- Sum of sibling ABO ad-set daily budgets stays constant.
  v_result := public.queue_meta_sibling_budget_reallocate_internal(
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

  if position('queue_meta_sibling_budget_reallocate_internal' in v_updated) = 0 then
    raise exception
      'sibling success reallocate patch did not apply to run_meta_budget_planner';
  end if;

  execute v_updated;
end;
$patch_planner$;

revoke all on function public.queue_meta_sibling_budget_reallocate_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.queue_meta_budget_plan_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, text, integer, uuid,
  text, integer, jsonb, timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.rebuild_meta_campaign_recommendations(
  uuid, uuid, date, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.rebuild_meta_campaign_recommendations(
  uuid, uuid, date, text, timestamptz
) to service_role;

comment on function public.queue_meta_sibling_budget_reallocate_internal(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) is
  'Queues matched DECREASE+INCREASE UPDATE_BUDGET plans for ABO sibling ad sets using relative success ranking. Sum of sibling daily budgets stays constant; no min-volume stop.';

comment on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Builds conservative Meta daily exposure, queues safety/budget plans, then ABO sibling success-control reallocations (relative ranking, sum constant, no min-volume stop). No remote mutation.';

comment on view public.meta_ad_set_performance_7d is
  'Ad-set level Meta performance aggregated over the last 7 days ending at each account max performance date, with derived link_cpc/cpl when safe.';

commit;
