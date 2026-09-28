-- READ-ONLY Diagnose: Warum blieb die Anzeige der Kampagne 120247773607010571 inaktiv?
-- Keine Schreibzugriffe. Ergebnis: eine Zeile, eine JSON-Spalte "diagnose".
with target as (
  select b.plan_id, b.user_id, b.platform_account_id
  from public.remote_object_bindings b
  where b.remote_object_id = '120247773607010571'
  limit 1
), plan as (
  select mp.id, mp.status, mp.source_rule_key, mp.action_type,
         mp.attempt_count, mp.max_attempts, mp.not_before, mp.lease_owner,
         mp.lease_expires_at, mp.blocked_reason, mp.error_class,
         mp.terminal_at, mp.created_at, mp.updated_at,
         (mp.lease_token is not null) as has_lease
  from public.mutation_plans mp join target t on t.plan_id = mp.id
  limit 1
), steps as (
  select s.step_index, s.step_key, s.operation, s.object_type, s.status,
         s.dispatch_state, s.attempt_count,
         (s.depends_on_step_id is not null) as has_dependency,
         s.not_before, s.error_class, s.error_code,
         left(s.error_detail, 300) as error_detail,
         s.planned_request->>'status' as planned_status,
         s.started_at, s.dispatch_started_at, s.remote_applied_at,
         s.completed_at, s.updated_at,
         (select left(coalesce(sn.snapshot_payload->>'status','') || '/' ||
                 coalesce(sn.snapshot_payload->>'effective_status',''), 80)
            from public.meta_mutation_remote_snapshots sn
           where sn.step_id = s.id
           order by sn.observed_at desc limit 1) as read_snapshot_status
  from public.mutation_plan_steps s join target t on t.plan_id = s.plan_id
  order by s.step_index
  limit 120
), bindings as (
  select b.object_type, b.remote_object_id, b.bound_at, s.step_key
  from public.remote_object_bindings b
  join target t on t.plan_id = b.plan_id
  left join public.mutation_plan_steps s on s.id = b.step_id
  order by b.bound_at
  limit 60
), executions as (
  select e.id, e.attempt_number, e.worker_id, e.status, e.started_at,
         e.last_heartbeat_at, e.finished_at, e.error_class, e.error_code,
         left(e.error_message, 300) as error_message
  from public.mutation_executions e join target t on t.plan_id = e.plan_id
  order by e.started_at desc
  limit 20
), audit as (
  select a.occurred_at, a.event_type, a.actor_type, a.actor_id,
         s.step_key, a.error_class,
         left(a.after_state::text, 300) as after_state,
         left(a.metadata::text, 200) as metadata
  from public.mutation_audit_events a
  join target t on t.plan_id = a.plan_id
  left join public.mutation_plan_steps s on s.id = a.step_id
  order by a.occurred_at desc
  limit 150
), kill_switch as (
  select k.sequence, k.scope_type, k.mode, k.plan_id, left(k.reason, 160) as reason,
         k.actor_type, k.actor_id, k.created_at
  from public.kill_switch_state k join target t
    on k.user_id = t.user_id and k.platform_account_id = t.platform_account_id
  where k.created_at > now() - interval '3 days'
  order by k.sequence desc
  limit 60
), effective_kill as (
  select ks.mode, ks.scope_type, left(ks.reason, 160) as reason, ks.created_at
  from target t,
       public.get_effective_meta_kill_switch(t.user_id, t.platform_account_id, t.plan_id) ks
  limit 1
), sibling_launches as (
  select mp.id, mp.status, mp.attempt_count, mp.max_attempts, mp.blocked_reason,
         mp.error_class, mp.created_at, mp.updated_at, mp.terminal_at,
         (select a.approved_at from public.meta_launch_canary_approvals a
           where a.plan_id = mp.id) as approved_at,
         (select string_agg(b.object_type || ':' || b.remote_object_id, ', ')
            from public.remote_object_bindings b
           where b.plan_id = mp.id and b.object_type in ('CAMPAIGN','AD')) as remote_ids
  from public.mutation_plans mp join target t
    on mp.user_id = t.user_id and mp.platform_account_id = t.platform_account_id
  where mp.action_type = 'LAUNCH_CHAIN'
    and mp.created_at > now() - interval '3 days'
  order by mp.created_at
  limit 20
), account_lease as (
  select l.lease_kind, l.owner_id, l.acquired_at, l.expires_at
  from public.meta_account_operation_leases l join target t
    on l.platform_account_id = t.platform_account_id and l.user_id = t.user_id
  limit 5
), boost_auto as (
  select exists (
    select 1 from public.meta_boost_settings ms join target t
      on ms.user_id = t.user_id and ms.platform_account_id = t.platform_account_id
    where ms.is_current and ms.enabled and ms.boost_mode = 'AUTO'
      and ms.auto_boost_new_candidates
      and ms.require_manual_approval is not true
  ) as organic_auto_keeps_account_allow
)
select jsonb_build_object(
  'now', now(),
  'target', (select to_jsonb(t) from target t),
  'plan', (select to_jsonb(p) from plan p),
  'approval', (select jsonb_build_object('approved_at', a.approved_at)
                 from public.meta_launch_canary_approvals a join target t on t.plan_id = a.plan_id limit 1),
  'steps', (select jsonb_agg(to_jsonb(s) order by s.step_index) from steps s),
  'bindings', (select jsonb_agg(to_jsonb(b)) from bindings b),
  'executions', (select jsonb_agg(to_jsonb(e)) from executions e),
  'audit', (select jsonb_agg(to_jsonb(a) order by a.occurred_at) from audit a),
  'kill_switch_history', (select jsonb_agg(to_jsonb(k) order by k.sequence) from kill_switch k),
  'effective_kill_switch', (select to_jsonb(e) from effective_kill e),
  'sibling_launches', (select jsonb_agg(to_jsonb(s) order by s.created_at) from sibling_launches s),
  'account_lease', (select jsonb_agg(to_jsonb(l)) from account_lease l),
  'boost_auto', (select to_jsonb(b) from boost_auto b)
) as diagnose;
