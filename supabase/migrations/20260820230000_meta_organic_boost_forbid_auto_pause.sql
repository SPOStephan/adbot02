-- Forensics + permanent guards: automated PAUSE must never stop Beitrag-Push
-- mid-flight. Hard-cap exemption was binding-only (gap if binding missing).
-- Sibling pause excluded by name. Pending auto-pause plans are cancelled.

begin;

-- ── Forensics: what paused Organic Boost after it was live? ─────────────────
create or replace function public.diagnose_meta_organic_boost_delivery_stops(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Meta account operation scope is invalid';
  end if;

  select jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(row_to_json(c) order by c.updated_at desc)
      from (
        select
          campaign.id as local_campaign_id,
          campaign.platform_campaign_id,
          campaign.name,
          campaign.status,
          campaign.effective_status,
          campaign.start_time,
          campaign.stop_time,
          campaign.updated_at
        from public.campaigns campaign
        where campaign.user_id = p_user_id
          and campaign.platform_account_id = p_platform_account_id
          and campaign.is_current
          and campaign.name ilike 'Organic Boost%'
        order by campaign.updated_at desc
        limit 50
      ) c
    ), '[]'::jsonb),
    'auto_pause_plans', coalesce((
      select jsonb_agg(row_to_json(p) order by p.created_at desc)
      from (
        select
          mp.id as plan_id,
          mp.status as plan_status,
          mp.action_type,
          mp.source_rule_key,
          mp.target_key,
          mp.blocked_reason,
          mp.error_class,
          mp.created_at,
          mp.terminal_at,
          mp.planned_payload->>'object_id' as object_id,
          mp.planned_payload->>'status' as intended_status,
          mp.planned_payload->>'safety_reason' as safety_reason
        from public.mutation_plans mp
        where mp.user_id = p_user_id
          and mp.platform_account_id = p_platform_account_id
          and mp.action_type in ('SAFETY_PAUSE', 'PAUSE')
          and (
            mp.target_key ilike '%Organic Boost%'
            or coalesce(mp.planned_payload->>'object_id', '') in (
              select campaign.platform_campaign_id
              from public.campaigns campaign
              where campaign.user_id = p_user_id
                and campaign.platform_account_id = p_platform_account_id
                and campaign.is_current
                and campaign.name ilike 'Organic Boost%'
            )
            or exists (
              select 1
              from public.remote_object_bindings binding
              join public.meta_organic_boost_links link
                on link.plan_id = binding.plan_id
               and link.user_id = binding.user_id
               and link.platform_account_id = binding.platform_account_id
              where binding.user_id = p_user_id
                and binding.platform_account_id = p_platform_account_id
                and binding.object_type = 'CAMPAIGN'
                and (
                  binding.remote_object_id = mp.planned_payload->>'object_id'
                  or ('campaign:' || binding.remote_object_id) = mp.target_key
                )
            )
          )
        order by mp.created_at desc
        limit 100
      ) p
    ), '[]'::jsonb),
    'activate_steps', coalesce((
      select jsonb_agg(row_to_json(s) order by s.created_at desc)
      from (
        select
          mp.id as plan_id,
          mp.status as plan_status,
          mps.step_key,
          mps.object_type,
          mps.dispatch_state,
          mps.error_code,
          mps.error_detail,
          mps.remote_applied_at,
          mps.updated_at as created_at
        from public.mutation_plans mp
        join public.meta_organic_boost_links link
          on link.plan_id = mp.id
         and link.user_id = mp.user_id
         and link.platform_account_id = mp.platform_account_id
        join public.mutation_plan_steps mps
          on mps.plan_id = mp.id
         and mps.step_key in (
           'create-ad-paused',
           'activate-ad-set',
           'activate-campaign',
           'activate-ad'
         )
        where mp.user_id = p_user_id
          and mp.platform_account_id = p_platform_account_id
          and mp.source_rule_key = 'organic-boost'
        order by mps.updated_at desc
        limit 200
      ) s
    ), '[]'::jsonb),
    'kill_switch', (
      select jsonb_build_object(
        'mode', ks.mode,
        'reason', ks.reason,
        'created_at', ks.created_at
      )
      from public.kill_switch_state ks
      where ks.user_id = p_user_id
        and ks.platform_account_id = p_platform_account_id
        and ks.scope_type = 'ACCOUNT'
      order by ks.sequence desc
      limit 1
    )
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.diagnose_meta_organic_boost_delivery_stops(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.diagnose_meta_organic_boost_delivery_stops(uuid, uuid)
  to service_role;

comment on function public.diagnose_meta_organic_boost_delivery_stops(uuid, uuid) is
  'Forensics: Organic Boost campaign status, automated PAUSE plans, activate-step wire state, kill-switch.';

-- ── Cancel pending automated pauses aimed at Beitrag-Push ───────────────────
update public.mutation_plans mp
set
  status = 'SUPERSEDED',
  blocked_reason = 'organic_boost_auto_pause_forbidden',
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  terminal_at = coalesce(mp.terminal_at, now()),
  updated_at = now()
where mp.action_type in ('SAFETY_PAUSE', 'PAUSE')
  and mp.status in (
    'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING', 'HELD', 'BLOCKED'
  )
  and mp.source_rule_key in (
    'hard_cap_exposure_breach',
    'ad_sibling_success_pause_7d'
  )
  and (
    exists (
      select 1
      from public.campaigns campaign
      where campaign.user_id = mp.user_id
        and campaign.platform_account_id = mp.platform_account_id
        and campaign.is_current
        and campaign.name ilike 'Organic Boost%'
        and (
          campaign.platform_campaign_id = mp.planned_payload->>'object_id'
          or mp.target_key = 'campaign:' || campaign.platform_campaign_id
        )
    )
    or exists (
      select 1
      from public.remote_object_bindings binding
      join public.meta_organic_boost_links link
        on link.plan_id = binding.plan_id
       and link.user_id = binding.user_id
       and link.platform_account_id = binding.platform_account_id
      where binding.user_id = mp.user_id
        and binding.platform_account_id = mp.platform_account_id
        and binding.object_type = 'CAMPAIGN'
        and (
          binding.remote_object_id = mp.planned_payload->>'object_id'
          or mp.target_key = 'campaign:' || binding.remote_object_id
        )
    )
  );

-- ── Harden hard-cap pause: name OR binding exemption ────────────────────────
do $patch_pause$
declare
  v_function regprocedure :=
    'public.queue_meta_hard_cap_pause_internal(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;
  if v_definition is null then
    raise exception 'queue_meta_hard_cap_pause_internal not found';
  end if;

  if position('organic_boost_name_exempt' in v_definition) > 0 then
    return;
  end if;

  -- Prefer inserting right after existing binding exemption.
  if position('organic_boost_hard_cap_exempt' in v_definition) > 0 then
    v_updated := replace(
      v_definition,
      $old$return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'organic_boost_hard_cap_exempt'
    );
  end if;$old$,
      $new$return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'organic_boost_hard_cap_exempt'
    );
  end if;

  -- Defense in depth: name match when binding/plan link is missing.
  if coalesce(v_campaign.name, '') ilike 'Organic Boost%' then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'organic_boost_name_exempt'
    );
  end if;$new$
    );
  else
    -- Exemption missing entirely — inject before payload build after campaign_not_active.
    v_updated := regexp_replace(
      v_definition,
      E'if not found\\s+'
      || E'or coalesce\\(v_campaign\\.effective_status, v_campaign\\.status\\) <> ''ACTIVE'' then\\s+'
      || E'return jsonb_build_object\\(\\s+'
      || E'''outcome'', ''BLOCKED'', ''reason'', ''campaign_not_active''\\s+'
      || E'\\);\\s+'
      || E'end if;',
      $repl$if not found
    or coalesce(v_campaign.effective_status, v_campaign.status) <> 'ACTIVE' then
    return jsonb_build_object(
      'outcome', 'BLOCKED', 'reason', 'campaign_not_active'
    );
  end if;

  if exists (
    select 1
    from public.remote_object_bindings binding
    join public.mutation_plans boost_plan
      on boost_plan.id = binding.plan_id
     and boost_plan.user_id = binding.user_id
     and boost_plan.platform_account_id = binding.platform_account_id
    where binding.user_id = p_user_id
      and binding.platform_account_id = p_platform_account_id
      and binding.object_type = 'CAMPAIGN'
      and (
        binding.remote_object_id = v_target.platform_object_id
        or binding.local_campaign_id = v_campaign.id
      )
      and boost_plan.source_rule_key = 'organic-boost'
      and boost_plan.action_type = 'LAUNCH_CHAIN'
  ) or coalesce(v_campaign.name, '') ilike 'Organic Boost%' then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'organic_boost_name_exempt'
    );
  end if;$repl$,
      1
    );
  end if;

  if position('organic_boost_name_exempt' in v_updated) = 0 then
    raise exception
      'organic-boost name exemption did not apply to queue_meta_hard_cap_pause_internal';
  end if;

  execute v_updated;
end;
$patch_pause$;

-- Planner candidate loop: also skip by Organic Boost name.
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

  if position('organic_boost_name_exempt' in v_definition) > 0 then
    return;
  end if;

  if position('organic_boost_hard_cap_exempt' in v_definition) > 0 then
    v_updated := replace(
      v_definition,
      '-- organic_boost_hard_cap_exempt',
      $new$and c.name not ilike 'Organic Boost%'
        -- organic_boost_name_exempt
        -- organic_boost_hard_cap_exempt$new$
    );
  else
    v_updated := regexp_replace(
      v_definition,
      E'and coalesce\\(c\\.effective_status, c\\.status\\) = ''ACTIVE''',
      $repl$and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and c.name not ilike 'Organic Boost%'
        -- organic_boost_name_exempt$repl$,
      1
    );
  end if;

  if position('organic_boost_name_exempt' in v_updated) = 0 then
    raise exception
      'organic-boost name exemption did not apply to run_meta_budget_planner';
  end if;

  execute v_updated;
end;
$patch_planner$;

-- Sibling success pause: never target Organic Boost campaigns.
do $patch_sibling$
declare
  v_function regprocedure :=
    'public.queue_meta_ad_sibling_success_pause_scan_internal(uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;
  if v_definition is null then
    -- Optional until sibling migration applied.
    return;
  end if;

  if position('organic_boost_sibling_pause_exempt' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'and coalesce\\(c\\.effective_status, c\\.status\\) = ''ACTIVE''\\s+'
    || E'and c\\.objective in \\(',
    $repl$and coalesce(c.effective_status, c.status) = 'ACTIVE'
      and c.name not ilike 'Organic Boost%'
      -- organic_boost_sibling_pause_exempt
      and c.objective in ($repl$,
    1
  );

  if position('organic_boost_sibling_pause_exempt' in v_updated) = 0 then
    raise exception
      'organic-boost sibling pause exemption did not apply';
  end if;

  execute v_updated;
end;
$patch_sibling$;

commit;
