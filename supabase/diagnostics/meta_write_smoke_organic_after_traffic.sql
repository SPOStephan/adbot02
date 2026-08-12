-- Meta-Write Smoke: Beitrag-Push darf nach Traffic/Launch-Arbeit nicht stranguliert sein.
-- Read-only. In Supabase SQL Editor ausführen.
-- Erwartung bei AUTO + Freigeben: Abschnitt FAILING liefert 0 Zeilen.

-- ---------------------------------------------------------------------------
-- 1) Functions aus Guardrail-Fixes vorhanden?
-- ---------------------------------------------------------------------------
select
  to_regprocedure(
    'public.meta_organic_boost_effective_require_manual(uuid)'
  ) is not null as has_effective_require_manual,
  to_regprocedure(
    'public.sync_meta_organic_boost_queue_after_allow(uuid,uuid)'
  ) is not null as has_queue_sync,
  to_regprocedure(
    'public.lift_meta_organic_boost_stale_plan_freeze(uuid,uuid)'
  ) is not null as has_plan_freeze_lift,
  to_regprocedure(
    'public.heal_meta_organic_boost_freeze_baked_review(uuid,uuid)'
  ) is not null as has_freeze_bake_heal;

-- ---------------------------------------------------------------------------
-- 2) ACCOUNT kill je Meta-Account (UI-Sicht)
-- ---------------------------------------------------------------------------
select distinct on (ks.platform_account_id)
  ks.platform_account_id,
  pa.account_name,
  ks.mode as account_mode,
  ks.reason,
  ks.created_at
from public.kill_switch_state ks
join public.platform_accounts pa
  on pa.id = ks.platform_account_id
 and pa.user_id = ks.user_id
where ks.scope_type = 'ACCOUNT'
  and pa.platform = 'meta'
  and pa.revoked_at is null
order by ks.platform_account_id, ks.sequence desc;

-- ---------------------------------------------------------------------------
-- 3) SYSTEM kill (darf ACCOUNT-ALLOW überstimmen)
-- ---------------------------------------------------------------------------
select
  ks.mode as system_mode,
  ks.reason,
  ks.created_at,
  ks.actor_type
from public.kill_switch_state ks
where ks.scope_type = 'SYSTEM'
order by ks.sequence desc
limit 3;

-- ---------------------------------------------------------------------------
-- 4) Beitrag-Push Settings (AUTO?)
-- ---------------------------------------------------------------------------
select
  s.platform_account_id,
  s.boost_mode,
  s.enabled,
  s.auto_boost_new_candidates,
  s.require_manual_approval
from public.meta_boost_settings s
where s.is_current
order by s.platform_account_id;

-- ---------------------------------------------------------------------------
-- 5) FAILING: wire-freie organic Queue, die unter AUTO+Account-ALLOW
--    trotzdem nicht ALLOW ist (PLAN/SYSTEM Freeze / Soft-Block-Schleife)
-- ---------------------------------------------------------------------------
select
  mp.id as plan_id,
  mp.platform_account_id,
  mp.status,
  mp.blocked_reason,
  mp.not_before,
  mp.created_at,
  coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true)
    as payload_require_manual,
  public.meta_organic_boost_effective_require_manual(mp.id)
    as effective_require_manual,
  ks.mode as effective_mode,
  ks.scope_type as effective_scope,
  ks.reason as effective_reason,
  case
    when public.meta_organic_boost_effective_require_manual(mp.id) = false
      and ks.mode is distinct from 'ALLOW'
      then 'FAIL: AUTO-Plan effective kill != ALLOW'
    when mp.blocked_reason in (
      'organic_preflight_kill_switch', 'writes_frozen'
    )
      and ks.mode = 'ALLOW'
      then 'FAIL: sticky soft-block despite effective ALLOW'
    when mp.not_before > now() + interval '30 seconds'
      and ks.mode = 'ALLOW'
      and public.meta_organic_boost_effective_require_manual(mp.id) = false
      then 'FAIL: not_before far future despite ALLOW+AUTO'
    else 'ok'
  end as smoke_result
from public.mutation_plans mp
join public.meta_boost_settings s
  on s.user_id = mp.user_id
 and s.platform_account_id = mp.platform_account_id
 and s.is_current
 and s.enabled
 and s.boost_mode = 'AUTO'
 and s.auto_boost_new_candidates
 and s.require_manual_approval is not true
cross join lateral public.get_effective_meta_kill_switch(
  mp.user_id, mp.platform_account_id, mp.id
) ks
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status in (
    'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING',
    'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED'
  )
  and mp.created_at >= now() - interval '7 days'
  and not exists (
    select 1
    from public.remote_object_bindings b
    where b.plan_id = mp.id
  )
  and (
    (
      public.meta_organic_boost_effective_require_manual(mp.id) = false
      and ks.mode is distinct from 'ALLOW'
    )
    or (
      mp.blocked_reason in (
        'organic_preflight_kill_switch', 'writes_frozen'
      )
      and ks.mode = 'ALLOW'
    )
    or (
      mp.not_before > now() + interval '30 seconds'
      and ks.mode = 'ALLOW'
      and public.meta_organic_boost_effective_require_manual(mp.id) = false
    )
  )
order by mp.created_at desc;

-- ---------------------------------------------------------------------------
-- 6) Spot-check: letzte organic Pläne inkl. effective kill (Info)
-- ---------------------------------------------------------------------------
select
  mp.id as plan_id,
  mp.status,
  mp.blocked_reason,
  mp.created_at,
  public.meta_organic_boost_effective_require_manual(mp.id)
    as effective_require_manual,
  ks.mode as effective_mode,
  ks.scope_type as effective_scope,
  exists (
    select 1 from public.remote_object_bindings b where b.plan_id = mp.id
  ) as has_remote_binding
from public.mutation_plans mp
cross join lateral public.get_effective_meta_kill_switch(
  mp.user_id, mp.platform_account_id, mp.id
) ks
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.created_at >= now() - interval '2 days'
order by mp.created_at desc
limit 20;
