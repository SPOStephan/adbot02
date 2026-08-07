-- Meta Graph #100 subcode 4834005:
-- "Budgetaufteilung auf Anzeigengruppenebene kann nicht ohne Gebotsstrategie
--  verwendet werden" when is_adset_budget_sharing_enabled=true without
-- campaign.bid_strategy. Beitrag-Push uses AD_SET budgets + sharing=true,
-- so the campaign must carry bid_strategy=LOWEST_COST_WITHOUT_CAP.

begin;

-- ---------------------------------------------------------------------------
-- 1) Patch materialize: add campaign bid_strategy next to budget sharing
-- ---------------------------------------------------------------------------
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

  if position(
    '''bid_strategy'', ''LOWEST_COST_WITHOUT_CAP'''
    in v_def
  ) > 0
    and position('is_adset_budget_sharing_enabled' in v_def) > 0
    and position(
      '''is_adset_budget_sharing_enabled'', (v_budget_owner_type = ''AD_SET''), ''bid_strategy'', ''LOWEST_COST_WITHOUT_CAP'''
      in v_def
    ) > 0 then
    return;
  end if;

  if position('is_adset_budget_sharing_enabled' in v_def) = 0 then
    raise exception
      'materialize_meta_organic_boost_plan missing is_adset_budget_sharing_enabled — apply 20260806200000 first';
  end if;

  v_updated := replace(
    v_def,
    '''is_adset_budget_sharing_enabled'', (v_budget_owner_type = ''AD_SET'')',
    '''is_adset_budget_sharing_enabled'', (v_budget_owner_type = ''AD_SET''), ''bid_strategy'', ''LOWEST_COST_WITHOUT_CAP'''
  );

  if position(
    '''is_adset_budget_sharing_enabled'', (v_budget_owner_type = ''AD_SET''), ''bid_strategy'', ''LOWEST_COST_WITHOUT_CAP'''
    in v_updated
  ) = 0 then
    raise exception
      'Failed to add campaign bid_strategy for ad set budget sharing';
  end if;

  execute v_updated;
end;
$patch$;

-- ---------------------------------------------------------------------------
-- 2) Repair queued/failed AUTO organic plans + steps
-- ---------------------------------------------------------------------------
alter table public.mutation_plans
  disable trigger guard_meta_mutation_plan_update;
alter table public.mutation_plan_steps
  disable trigger guard_meta_mutation_step_update;

with repaired as (
  select
    mp.id,
    jsonb_set(
      jsonb_set(
        mp.planned_payload,
        '{campaign,is_adset_budget_sharing_enabled}',
        to_jsonb(
          coalesce(mp.planned_payload->>'budget_owner_type', 'AD_SET') = 'AD_SET'
        ),
        true
      ),
      '{campaign,bid_strategy}',
      '"LOWEST_COST_WITHOUT_CAP"'::jsonb,
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
        jsonb_set(
          coalesce(mps.planned_request, '{}'::jsonb),
          '{payload,is_adset_budget_sharing_enabled}',
          to_jsonb(
            coalesce(mp.planned_payload->>'budget_owner_type', 'AD_SET') = 'AD_SET'
          ),
          true
        ),
        '{payload,bid_strategy}',
        '"LOWEST_COST_WITHOUT_CAP"'::jsonb,
        true
      )
    else mps.planned_request
  end,
  request_hash = public.meta_sha256((
    case
      when mps.step_key in ('validate-campaign', 'create-campaign-paused') then
        jsonb_set(
          jsonb_set(
            coalesce(mps.planned_request, '{}'::jsonb),
            '{payload,is_adset_budget_sharing_enabled}',
            to_jsonb(
              coalesce(mp.planned_payload->>'budget_owner_type', 'AD_SET') = 'AD_SET'
            ),
            true
          ),
          '{payload,bid_strategy}',
          '"LOWEST_COST_WITHOUT_CAP"'::jsonb,
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
  error_detail = null,
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
  error_code = coalesce(me.error_code, 'organic_payload_repaired_bid_strategy')
from public.mutation_plans mp
where me.plan_id = mp.id
  and mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status = 'PENDING'
  and coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true) = false
  and me.status in ('CLAIMED', 'RUNNING', 'RECONCILING', 'RETRYABLE', 'FAILED');

-- Clear account lease if a failed write left it sticky.
update public.meta_account_operation_leases lease
set
  lease_kind = null,
  lease_token = null,
  owner_id = null,
  acquired_at = null,
  expires_at = null,
  updated_at = now()
from public.platform_accounts account
where lease.platform_account_id = account.id
  and account.platform = 'meta'
  and account.revoked_at is null
  and lease.expires_at is not null
  and lease.expires_at <= now();

commit;
