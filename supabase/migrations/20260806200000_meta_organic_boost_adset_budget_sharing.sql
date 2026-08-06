-- Meta v24+ requires is_adset_budget_sharing_enabled on campaign create when
-- budget lives on the ad set (typical Beitrag-Push). Missing field → Graph #100
-- on validate-campaign. Also re-queue failed/stuck organic AUTO plans and clear
-- soft kill-switch reasons when Freigeben (ALLOW) is effective.

begin;

-- Patch materialize: always set is_adset_budget_sharing_enabled on campaigns.
do $patch$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.materialize_meta_organic_boost_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
  ) into v_def;

  if v_def is null then
    raise exception 'materialize_meta_organic_boost_plan not found';
  end if;

  if position('is_adset_budget_sharing_enabled' in v_def) > 0 then
    return;
  end if;

  if position('''special_ad_categories'', ''[]''::jsonb' in v_def) = 0
    and position('''special_ad_categories'', ''[]''::jsonb' in replace(v_def, ' ', '')) = 0 then
    -- Tolerate formatting differences from pg_get_functiondef.
    null;
  end if;

  v_updated := replace(
    v_def,
    '''special_ad_categories'', ''[]''::jsonb',
    '''special_ad_categories'', ''[]''::jsonb,'
    || E'\n    ''is_adset_budget_sharing_enabled'', (v_budget_owner_type = ''AD_SET'')'
  );

  if position('is_adset_budget_sharing_enabled' in v_updated) = 0 then
    v_updated := replace(
      v_def,
      '''special_ad_categories'', ''[]''::jsonb',
      '''special_ad_categories'', ''[]''::jsonb, ''is_adset_budget_sharing_enabled'', (v_budget_owner_type = ''AD_SET'')'
    );
  end if;

  if position('is_adset_budget_sharing_enabled' in v_updated) = 0 then
    raise exception 'Failed to add is_adset_budget_sharing_enabled to materialize_meta_organic_boost_plan';
  end if;

  execute v_updated;
end;
$patch$;

-- Intent guards off only for this one-time payload repair.
alter table public.mutation_plans
  disable trigger guard_meta_mutation_plan_update;
alter table public.mutation_plan_steps
  disable trigger guard_meta_mutation_step_update;

with repaired as (
  select
    mp.id,
    jsonb_set(
      mp.planned_payload,
      '{campaign,is_adset_budget_sharing_enabled}',
      to_jsonb(
        coalesce(mp.planned_payload->>'budget_owner_type', 'AD_SET') = 'AD_SET'
      ),
      true
    ) as payload
  from public.mutation_plans mp
  where mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
    and mp.status in (
      'FAILED', 'PENDING', 'RETRYABLE', 'STALE', 'BLOCKED',
      'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING'
    )
)
update public.mutation_plans mp
set
  planned_payload = repaired.payload,
  payload_hash = public.meta_sha256(repaired.payload::text),
  status = 'PENDING',
  attempt_count = 0,
  max_attempts = greatest(coalesce(mp.max_attempts, 1), 3),
  lease_token = null,
  lease_owner = null,
  lease_expires_at = null,
  error_class = null,
  blocked_reason = null,
  terminal_at = null,
  not_before = least(coalesce(mp.not_before, now()), now()),
  updated_at = now()
from repaired
where mp.id = repaired.id;

update public.mutation_plan_steps mps
set
  planned_request = case
    when mps.step_key in ('validate-campaign', 'create-campaign-paused') then
      jsonb_set(
        coalesce(mps.planned_request, '{}'::jsonb),
        '{payload,is_adset_budget_sharing_enabled}',
        to_jsonb(
          coalesce(mp.planned_payload->>'budget_owner_type', 'AD_SET') = 'AD_SET'
        ),
        true
      )
    else mps.planned_request
  end,
  request_hash = public.meta_sha256((
    case
      when mps.step_key in ('validate-campaign', 'create-campaign-paused') then
        jsonb_set(
          coalesce(mps.planned_request, '{}'::jsonb),
          '{payload,is_adset_budget_sharing_enabled}',
          to_jsonb(
            coalesce(mp.planned_payload->>'budget_owner_type', 'AD_SET') = 'AD_SET'
          ),
          true
        )
      else mps.planned_request
    end
  )::text),
  status = 'PENDING',
  dispatch_state = 'NOT_DISPATCHED',
  dispatch_started_at = null,
  remote_applied_at = null,
  remote_request_id = null,
  response_fingerprint = null,
  validation_fingerprint = null,
  validated_at = null,
  started_at = null,
  error_class = null,
  error_code = null,
  attempt_count = 0,
  completed_at = null,
  updated_at = now()
from public.mutation_plans mp
where mps.plan_id = mp.id
  and mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'PENDING'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and mps.status <> 'SKIPPED';

alter table public.mutation_plan_steps
  enable trigger guard_meta_mutation_step_update;
alter table public.mutation_plans
  enable trigger guard_meta_mutation_plan_update;

update public.mutation_executions me
set
  status = 'ABANDONED',
  finished_at = coalesce(me.finished_at, now()),
  error_class = coalesce(me.error_class, 'PREFLIGHT'),
  error_code = coalesce(me.error_code, 'organic_payload_repaired')
from public.mutation_plans mp
where me.plan_id = mp.id
  and mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'PENDING'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING', 'RETRYABLE');

-- If Freigeben is effective, drop stale soft kill-switch hints so Ampel is honest.
update public.mutation_plans mp
set
  blocked_reason = null,
  error_class = case
    when mp.error_class in ('KILL_SWITCH', 'PREFLIGHT') then null
    else mp.error_class
  end,
  not_before = least(coalesce(mp.not_before, now()), now()),
  updated_at = now()
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status in ('PENDING', 'RETRYABLE')
  and coalesce(mp.blocked_reason, '') in (
    'organic_preflight_kill_switch',
    'writes_frozen'
  )
  and (
    select ks.mode
    from public.get_effective_meta_kill_switch(
      mp.user_id, mp.platform_account_id, mp.id
    ) ks
  ) = 'ALLOW';

commit;
