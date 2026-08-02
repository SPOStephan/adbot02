create or replace function public.guard_meta_exposure_non_decreasing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_new_snapshot public.daily_budget_exposure_snapshots%rowtype;
  v_snapshot_relink_allowed boolean := true;
begin
  if new.policy_id is distinct from old.policy_id
    or new.snapshot_id is distinct from old.snapshot_id then
    v_snapshot_relink_allowed := false;

    select snapshot.* into v_old_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.id = old.snapshot_id;

    select snapshot.* into v_new_snapshot
    from public.daily_budget_exposure_snapshots snapshot
    where snapshot.id = new.snapshot_id;

    if v_old_snapshot.id is not null
      and v_new_snapshot.id is not null
      and v_old_snapshot.user_id = old.user_id
      and v_old_snapshot.platform_account_id = old.platform_account_id
      and v_old_snapshot.policy_id = old.policy_id
      and v_old_snapshot.account_day = old.account_day
      and v_old_snapshot.currency = old.currency
      and v_new_snapshot.user_id = new.user_id
      and v_new_snapshot.platform_account_id = new.platform_account_id
      and v_new_snapshot.policy_id = new.policy_id
      and v_new_snapshot.account_day = new.account_day
      and v_new_snapshot.currency = new.currency
      and v_new_snapshot.status in ('BUILDING', 'COMPLETE')
      and v_new_snapshot.created_at >= v_old_snapshot.created_at
      and exists (
        select 1
        from public.platform_accounts account
        where account.id = new.platform_account_id
          and account.user_id = new.user_id
          and account.marketing_sync_status = 'success'
          and account.marketing_sync_id =
            v_new_snapshot.source_marketing_sync_id
      )
      and exists (
        select 1
        from public.automation_policies policy
        where policy.id = new.policy_id
          and policy.user_id = new.user_id
          and policy.platform_account_id = new.platform_account_id
          and policy.is_current
          and policy.status = 'ACTIVE'
          and policy.currency = new.currency
      ) then
      v_snapshot_relink_allowed := true;
    end if;
  end if;

  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or not v_snapshot_relink_allowed
    or new.account_day is distinct from old.account_day
    or new.campaign_scope_key is distinct from old.campaign_scope_key
    or new.budget_owner_key is distinct from old.budget_owner_key
    or new.budget_owner_type is distinct from old.budget_owner_type
    or (old.shared_budget_enabled and not new.shared_budget_enabled)
    or new.currency is distinct from old.currency
    or new.max_daily_budget_minor < old.max_daily_budget_minor
    or new.flex_spend_multiplier_bps < old.flex_spend_multiplier_bps
    or new.created_at is distinct from old.created_at then
    raise exception 'Daily budget exposure identity and maxima cannot decrease';
  end if;

  return new;
end;
$$;

do $migration$
declare
  v_function regprocedure :=
    'public.refresh_meta_budget_planner_snapshot_internal(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text;
  v_old_upsert_prefix constant text :=
    E'do update set\n    automation_target_id = excluded.automation_target_id,';
  v_new_upsert_prefix constant text :=
    E'do update set\n    policy_id = excluded.policy_id,\n    snapshot_id = excluded.snapshot_id,\n    automation_target_id = excluded.automation_target_id,';
  v_occurrences integer;
begin
  select pg_get_functiondef(v_function) into v_definition;

  v_occurrences :=
    (char_length(v_definition)
      - char_length(replace(v_definition, v_old_upsert_prefix, '')))
    / char_length(v_old_upsert_prefix);
  if v_occurrences <> 2 then
    raise exception
      'Expected exactly two budget-exposure upsert prefixes, found %',
      v_occurrences;
  end if;

  v_definition := replace(
    v_definition,
    v_old_upsert_prefix,
    v_new_upsert_prefix
  );

  v_occurrences :=
    (char_length(v_definition)
      - char_length(replace(v_definition, v_new_upsert_prefix, '')))
    / char_length(v_new_upsert_prefix);
  if v_occurrences <> 2
    or position(v_old_upsert_prefix in v_definition) > 0 then
    raise exception 'Budget-exposure snapshot relink patch invariant failed';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.guard_meta_exposure_non_decreasing() is
  'Keeps daily exposure identity and maxima monotone while allowing a forward relink to the current same-day marketing snapshot and active policy.';

comment on function public.refresh_meta_budget_planner_snapshot_internal(
  uuid, uuid, uuid, uuid, timestamptz
) is
  'Refreshes budget targets and daily exposure state; repeated same-day syncs relink each exposure row to the current policy and snapshot.';
