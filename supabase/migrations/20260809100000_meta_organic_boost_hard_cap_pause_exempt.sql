-- Beitrag-Push campaigns must not be SAFETY_PAUSED when account/campaign
-- hard-cap exposure is breached. Exposure still counts (new launches stay
-- gated by preflight); only the mid-flight pause is blocked for organic-boost.

begin;

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

  if position('organic_boost_hard_cap_exempt' in v_definition) > 0 then
    return;
  end if;

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

  -- Beitrag-Push: never mid-flight SAFETY_PAUSE (hard-cap still blocks new launches).
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
  ) then
    return jsonb_build_object(
      'outcome', 'BLOCKED',
      'reason', 'organic_boost_hard_cap_exempt'
    );
  end if;$repl$,
    1
  );

  if position('organic_boost_hard_cap_exempt' in v_updated) = 0 then
    raise exception
      'organic-boost hard-cap pause exemption did not apply to queue_meta_hard_cap_pause_internal';
  end if;

  execute v_updated;
end;
$patch_pause$;

comment on function public.queue_meta_hard_cap_pause_internal(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz
) is
  'Queues SAFETY_PAUSE for hard-cap exposure breach on MANAGED campaigns except Beitrag-Push (organic-boost) campaigns, which stay ACTIVE mid-flight.';

-- Planner candidate loop: skip organic-boost so account breaches still pause
-- other MANAGED campaigns without counting boost rows as blocked noise.
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

  if position('organic_boost_hard_cap_exempt' in v_definition) > 0 then
    return;
  end if;

  -- Insert exemption into the hard-cap SAFETY_PAUSE candidate WHERE clause.
  v_updated := regexp_replace(
    v_definition,
    E'and coalesce\\(c\\.effective_status, c\\.status\\) = ''ACTIVE''\\s+'
    || E'and \\(\\s+'
    || E'v_account_breach\\s+'
    || E'or target\\.campaign_scope_key = any\\(v_breach_campaigns\\)\\s+'
    || E'\\)',
    $repl$and coalesce(c.effective_status, c.status) = 'ACTIVE'
        and not exists (
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
              binding.remote_object_id = c.platform_campaign_id
              or binding.local_campaign_id = c.id
            )
            and boost_plan.source_rule_key = 'organic-boost'
            and boost_plan.action_type = 'LAUNCH_CHAIN'
        )
        and (
          v_account_breach
          or target.campaign_scope_key = any(v_breach_campaigns)
        )
        -- organic_boost_hard_cap_exempt$repl$,
    1
  );

  if position('organic_boost_hard_cap_exempt' in v_updated) = 0 then
    raise exception
      'organic-boost hard-cap pause exemption did not apply to run_meta_budget_planner';
  end if;

  execute v_updated;
end;
$patch_planner$;

comment on function public.run_meta_budget_planner(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Builds conservative Meta daily exposure, queues SAFETY_PAUSE on hard-cap breach for non-Beitrag-Push MANAGED campaigns, and under-cap queues ACTIVATE day-resume for prior hard-cap SAFETY_PAUSE campaigns. No remote mutation.';

commit;
