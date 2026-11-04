-- Conversion-Ereignisse Teil 2: Lead-Underperformer-Regel nur für LEAD-Kampagnen.
--
-- Adbot kann Lead-Kampagnen (OUTCOME_LEADS) jetzt auch auf andere Ereignisse
-- optimieren, z. B. COMPLETE_REGISTRATION. performance_data.leads zählt aber nur
-- Lead-Aktionen; eine Registrierungs-Kampagne hätte dort 0 Leads und würde von
-- lead_underperformer_pause_v1 fälschlich als schwach pausiert (und könnte nie
-- Referenz sein).
--
-- Änderung: meta_lead_campaign_window lässt Kampagnen aus, deren Adbot-Launch
-- (active-launch-chain) ein promoted_object.custom_event_type ungleich LEAD hat.
-- Bestehende Kampagnen (Event LEAD oder ohne promoted_object) und Fremd-
-- kampagnen ohne Adbot-Launch bleiben exakt wie bisher im Fenster.
-- Signatur, Rückgabe, Rechte und alle anderen Bedingungen sind unverändert.

begin;

create or replace function public.meta_lead_campaign_window(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_window_end date,
  p_planned_at timestamptz
)
returns table (
  campaign_id uuid,
  platform_campaign_id text,
  name text,
  spend numeric,
  leads bigint,
  first_day date,
  start_time timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.platform_campaign_id,
    c.name,
    coalesce(sum(pd.spend), 0),
    coalesce(sum(pd.leads), 0)::bigint,
    min(pd.date),
    c.start_time
  from public.campaigns c
  join public.performance_data pd
    on pd.campaign_id = c.id
   and pd.user_id = p_user_id
   and pd.platform_account_id = p_platform_account_id
   and pd.platform = 'meta'
   and pd.date between p_window_end - 6 and p_window_end
  where c.user_id = p_user_id
    and c.platform_account_id = p_platform_account_id
    and c.is_current
    and upper(coalesce(c.objective, '')) in ('OUTCOME_LEADS', 'LEAD_GENERATION')
    and upper(coalesce(c.status, '')) = 'ACTIVE'
    and upper(coalesce(c.effective_status, c.status, '')) = 'ACTIVE'
    and (c.stop_time is null or c.stop_time > p_planned_at)
    -- lead_window_lead_event_only: Adbot launches optimised on another event
    -- (e.g. COMPLETE_REGISTRATION) are not judged by cost per lead.
    and not exists (
      select 1
      from public.remote_object_bindings binding
      join public.mutation_plans launch on launch.id = binding.plan_id
      where binding.platform_account_id = p_platform_account_id
        and binding.user_id = p_user_id
        and binding.object_type = 'CAMPAIGN'
        and binding.remote_object_id = c.platform_campaign_id
        and launch.source_rule_key = 'active-launch-chain'
        and upper(btrim(coalesce(
          launch.planned_payload #>> '{ad_set,promoted_object,custom_event_type}',
          'LEAD'
        ))) <> 'LEAD'
    )
  group by c.id, c.platform_campaign_id, c.name, c.start_time;
$$;

revoke all on function public.meta_lead_campaign_window(uuid, uuid, date, timestamptz)
  from public, anon, authenticated, service_role;

commit;
