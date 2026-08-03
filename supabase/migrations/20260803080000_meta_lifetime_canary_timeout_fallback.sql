-- Narrow last-success fallback for the lifetime budget canary.
-- A failed latest attempt is tolerated only when its error code is exactly
-- marketing_timeout. The existing successful marketing_sync_id,
-- marketing_last_success_at freshness window, campaign last_seen_sync_id,
-- exact expected-before budget, policy, scope, lease and kill-switch guards
-- remain mandatory and unchanged.

do $migration$
declare
  v_definition text;
  v_old_count integer;
  v_new_count integer;
  v_freshness_old_count integer;
  v_freshness_new_count integer;
  v_status_old constant text := $guard$pa.marketing_sync_status = 'success'$guard$;
  v_status_new constant text := $guard$(pa.marketing_sync_status = 'success'
       or (
         pa.marketing_sync_status = 'error'
         and pa.marketing_sync_error_code = 'marketing_timeout'
       ))$guard$;
  v_approval_freshness_old constant text := $guard$and pa.marketing_last_success_at is not null
    and 'ads_management' = any(pa.meta_scopes)$guard$;
  v_approval_freshness_new constant text := $guard$and pa.marketing_last_success_at is not null
    and pa.marketing_last_success_at >= v_approved_at - interval '2 hours'
    and pa.marketing_last_success_at <= v_approved_at + interval '1 minute'
    and 'ads_management' = any(pa.meta_scopes)$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.list_meta_budget_canary_plans(uuid)'::regprocedure
  ) into strict v_definition;
  v_old_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_old, '')))
    / pg_catalog.length(v_status_old);
  v_new_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_new, '')))
    / pg_catalog.length(v_status_new);

  if not ((v_old_count = 1 and v_new_count = 0)
      or (v_old_count = 0 and v_new_count = 1))
    or pg_catalog.strpos(
      v_definition,
      $guard$pa.marketing_sync_id = mp.source_marketing_sync_id$guard$
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      $guard$pa.marketing_last_success_at >= now() - interval '2 hours'$guard$
    ) = 0 then
    raise exception 'Unexpected budget canary listing definition';
  end if;

  if v_old_count = 1 then
    execute pg_catalog.replace(v_definition, v_status_old, v_status_new);
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.approve_meta_budget_canary_plan(uuid,uuid,uuid,text,bigint,bigint,text)'::regprocedure
  ) into strict v_definition;
  v_old_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_old, '')))
    / pg_catalog.length(v_status_old);
  v_new_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_new, '')))
    / pg_catalog.length(v_status_new);
  v_freshness_old_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(
        v_definition, v_approval_freshness_old, ''
      ))) / pg_catalog.length(v_approval_freshness_old);
  v_freshness_new_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(
        v_definition, v_approval_freshness_new, ''
      ))) / pg_catalog.length(v_approval_freshness_new);

  if not (
      (v_old_count = 1 and v_new_count = 0
        and v_freshness_old_count = 1 and v_freshness_new_count = 0)
      or
      (v_old_count = 0 and v_new_count = 1
        and v_freshness_old_count = 0 and v_freshness_new_count = 1)
    )
    or pg_catalog.strpos(
      v_definition,
      $guard$pa.marketing_sync_id = v_plan.source_marketing_sync_id$guard$
    ) = 0 then
    raise exception 'Unexpected budget canary approval definition';
  end if;

  if v_old_count = 1 then
    v_definition := pg_catalog.replace(
      v_definition, v_status_old, v_status_new
    );
    execute pg_catalog.replace(
      v_definition, v_approval_freshness_old, v_approval_freshness_new
    );
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.materialize_meta_customer_lifetime_budget_canary_plan(uuid,uuid,uuid,uuid,bigint,bigint,text,timestamptz)'::regprocedure
  ) into strict v_definition;
  v_old_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_old, '')))
    / pg_catalog.length(v_status_old);
  v_new_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_status_new, '')))
    / pg_catalog.length(v_status_new);

  if not ((v_old_count = 1 and v_new_count = 0)
      or (v_old_count = 0 and v_new_count = 1))
    or pg_catalog.strpos(
      v_definition,
      $guard$v_campaign.last_seen_sync_id is distinct from v_account.marketing_sync_id$guard$
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      $guard$pa.marketing_last_success_at >= p_planned_at - interval '2 hours'$guard$
    ) = 0 then
    raise exception 'Unexpected lifetime budget canary materializer definition';
  end if;

  if v_old_count = 1 then
    execute pg_catalog.replace(v_definition, v_status_old, v_status_new);
  end if;
end;
$migration$;

revoke all on function public.list_meta_budget_canary_plans(uuid)
  from public, anon, service_role;
grant execute on function public.list_meta_budget_canary_plans(uuid)
  to authenticated;

revoke all on function public.approve_meta_budget_canary_plan(
  uuid, uuid, uuid, text, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.approve_meta_budget_canary_plan(
  uuid, uuid, uuid, text, bigint, bigint, text
) to service_role;

revoke all on function public.materialize_meta_customer_lifetime_budget_canary_plan(
  uuid, uuid, uuid, uuid, bigint, bigint, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_meta_customer_lifetime_budget_canary_plan(
  uuid, uuid, uuid, uuid, bigint, bigint, text, timestamptz
) to service_role;

comment on function public.materialize_meta_customer_lifetime_budget_canary_plan(
  uuid, uuid, uuid, uuid, bigint, bigint, text, timestamptz
) is 'Materializes one customer-confirmed lifetime-budget canary. A fresh last-success snapshot may survive only a subsequent marketing_timeout; all sync-id, before-state, policy, scope, lease, approval and fail-closed guards remain mandatory.';
