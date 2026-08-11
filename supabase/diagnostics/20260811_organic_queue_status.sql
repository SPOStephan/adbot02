-- Read-only Diagnose: steckende Beitrag-Push Warteschlange
-- Im Supabase SQL Editor ausführen. Ändert nichts.

-- 1) Existiert das globale Fix-SQL (#155)?
select
  to_regprocedure(
    'public.meta_organic_boost_effective_require_manual(uuid)'
  ) is not null as has_effective_require_manual,
  to_regprocedure(
    'public.sync_meta_organic_boost_queue_after_allow(uuid,uuid)'
  ) is not null as has_queue_sync,
  to_regprocedure(
    'public.heal_meta_organic_boost_freeze_baked_review(uuid,uuid)'
  ) is not null as has_freeze_bake_heal;

-- 2) Aktueller ACCOUNT Kill-Switch (neueste Zeile je Account)
select distinct on (ks.platform_account_id)
  ks.platform_account_id,
  ks.mode,
  ks.reason,
  ks.created_at
from public.kill_switch_state ks
where ks.scope_type = 'ACCOUNT'
order by ks.platform_account_id, ks.sequence desc;

-- 3) Offene organic Pläne ohne Meta-Binding
select
  mp.id as plan_id,
  mp.status,
  mp.blocked_reason,
  mp.error_class,
  mp.not_before,
  mp.created_at,
  coalesce((mp.planned_payload->>'require_manual_approval')::boolean, true)
    as payload_require_manual,
  case
    when to_regprocedure(
      'public.meta_organic_boost_effective_require_manual(uuid)'
    ) is null then null
    else public.meta_organic_boost_effective_require_manual(mp.id)
  end as effective_require_manual,
  exists (
    select 1
    from public.remote_object_bindings b
    where b.plan_id = mp.id
  ) as has_remote_binding,
  (
    select string_agg(step.status || ':' || step.dispatch_state, ', ')
    from public.mutation_plan_steps step
    where step.plan_id = mp.id
  ) as step_states
from public.mutation_plans mp
where mp.source_rule_key = 'organic-boost'
  and mp.action_type = 'LAUNCH_CHAIN'
  and mp.status in (
    'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING',
    'BLOCKED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED'
  )
  and mp.created_at >= now() - interval '2 days'
order by mp.created_at desc
limit 30;
