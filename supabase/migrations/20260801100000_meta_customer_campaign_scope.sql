-- Customer-controlled Meta automation scope.
-- Existing synced campaigns remain fail-closed until the customer explicitly
-- selects a campaign or an individual budget owner for autonomous management.

create table public.automation_scope_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  selection_type text not null
    check (selection_type in ('CAMPAIGN', 'TARGET')),
  selection_key text not null,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  automation_target_id uuid
    references public.automation_targets(id) on delete restrict,
  status text not null check (status in ('MANAGED', 'SUSPENDED')),
  reason text not null check (char_length(reason) between 8 and 500),
  customer_confirmed_at timestamptz not null,
  customer_confirmed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_scope_selection_identity_check check (
    (selection_type = 'CAMPAIGN'
      and campaign_id is not null
      and automation_target_id is null
      and selection_key = campaign_id::text)
    or
    (selection_type = 'TARGET'
      and campaign_id is not null
      and automation_target_id is not null
      and selection_key = automation_target_id::text)
  ),
  constraint automation_scope_selection_account_key
    unique (platform_account_id, selection_type, selection_key)
);

create index automation_scope_selections_user_status_idx
  on public.automation_scope_selections (user_id, platform_account_id, status);
create index automation_scope_selections_campaign_idx
  on public.automation_scope_selections (platform_account_id, campaign_id);

alter table public.automation_scope_selections enable row level security;

create policy automation_scope_selections_select_own
  on public.automation_scope_selections
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on table public.automation_scope_selections to authenticated;
grant select, insert, update on table public.automation_scope_selections to service_role;

create or replace function public.resolve_meta_automation_scope_status(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_automation_target_id uuid,
  p_campaign_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.automation_scope_selections selection
      where selection.user_id = p_user_id
        and selection.platform_account_id = p_platform_account_id
        and selection.selection_type = 'CAMPAIGN'
        and selection.campaign_id = p_campaign_id
        and selection.status = 'SUSPENDED'
    ) then 'SUSPENDED'
    when exists (
      select 1
      from public.automation_scope_selections selection
      where selection.user_id = p_user_id
        and selection.platform_account_id = p_platform_account_id
        and selection.selection_type = 'TARGET'
        and selection.automation_target_id = p_automation_target_id
        and selection.status = 'SUSPENDED'
    ) then 'SUSPENDED'
    when exists (
      select 1
      from public.automation_scope_selections selection
      where selection.user_id = p_user_id
        and selection.platform_account_id = p_platform_account_id
        and selection.selection_type = 'TARGET'
        and selection.automation_target_id = p_automation_target_id
        and selection.status = 'MANAGED'
    ) then 'MANAGED'
    when exists (
      select 1
      from public.automation_scope_selections selection
      where selection.user_id = p_user_id
        and selection.platform_account_id = p_platform_account_id
        and selection.selection_type = 'CAMPAIGN'
        and selection.campaign_id = p_campaign_id
        and selection.status = 'MANAGED'
    ) then 'MANAGED'
    else 'SUSPENDED'
  end;
$$;

create or replace function public.apply_meta_automation_scope_to_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'RETIRED' then
    return new;
  end if;

  -- A customer-authorized launch chain writes a fresh successful-mutation
  -- timestamp while projecting its reconciled remote objects. Preserve that
  -- explicit launch authorization; ordinary planner refreshes never change this
  -- timestamp and therefore remain governed by the selection table.
  if TG_OP = 'INSERT'
    and new.status = 'MANAGED'
    and new.last_successful_mutation_at is not null then
    return new;
  end if;

  if TG_OP = 'UPDATE'
    and new.status = 'MANAGED'
    and new.last_successful_mutation_at is not null
    and new.last_successful_mutation_at
      is distinct from old.last_successful_mutation_at then
    return new;
  end if;

  -- Planner-created targets carry a reconciliation timestamp. Direct bootstrap
  -- fixtures without any observed Meta state remain untouched.
  if new.last_reconciled_at is not null then
    new.status := public.resolve_meta_automation_scope_status(
      new.user_id,
      new.platform_account_id,
      new.id,
      new.campaign_id
    );
  end if;

  return new;
end;
$$;

-- Freeze every previously implicit target before the trigger starts enforcing
-- the explicit selection contract for subsequent planner refreshes.
update public.automation_targets
set
  status = 'SUSPENDED',
  row_version = row_version + 1,
  updated_at = now()
where status = 'MANAGED';

create trigger automation_targets_apply_customer_scope
before insert or update of user_id, platform_account_id, campaign_id, status,
  last_reconciled_at
on public.automation_targets
for each row execute function public.apply_meta_automation_scope_to_target();

create or replace function public.set_meta_customer_automation_scope(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_selection_type text,
  p_selection_id uuid,
  p_status text,
  p_reason text
)
returns table (
  selection_id uuid,
  affected_target_count bigint,
  managed_budget_owner_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_campaign_id uuid;
  v_target_id uuid;
  v_selection_id uuid;
  v_policy_id uuid;
  v_before_status text := 'SUSPENDED';
  v_affected_count bigint := 0;
  v_managed_budget_owner_count bigint := 0;
begin
  if p_selection_type not in ('CAMPAIGN', 'TARGET')
    or p_status not in ('MANAGED', 'SUSPENDED')
    or char_length(v_reason) < 8
    or char_length(v_reason) > 500 then
    raise exception 'Customer automation scope input is invalid';
  end if;

  if not exists (
    select 1
    from public.platform_accounts account
    where account.id = p_platform_account_id
      and account.user_id = p_user_id
      and account.platform = 'meta'
      and account.revoked_at is null
  ) then
    raise exception 'Customer automation scope account is invalid';
  end if;

  if p_status = 'MANAGED' and not exists (
    select 1
    from public.platform_accounts account
    where account.id = p_platform_account_id
      and account.user_id = p_user_id
      and account.platform = 'meta'
      and account.revoked_at is null
      and account.marketing_currency = 'EUR'
      and 'ads_management' = any(account.meta_scopes)
  ) then
    raise exception 'MANAGED scope requires EUR and ads_management';
  end if;

  select policy.id
  into v_policy_id
  from public.automation_policies policy
  where policy.user_id = p_user_id
    and policy.platform_account_id = p_platform_account_id
    and policy.is_current
    and policy.status = 'ACTIVE'
    and policy.currency = 'EUR'
    and policy.allow_budget_changes
  order by policy.version desc
  limit 1;

  if p_status = 'MANAGED' and v_policy_id is null then
    raise exception 'MANAGED scope requires an active budget policy';
  end if;

  if p_selection_type = 'CAMPAIGN' then
    select campaign.id
    into v_campaign_id
    from public.campaigns campaign
    where campaign.id = p_selection_id
      and campaign.user_id = p_user_id
      and campaign.platform_account_id = p_platform_account_id
      and campaign.is_current;

    if v_campaign_id is null then
      raise exception 'Customer automation campaign is invalid';
    end if;
  else
    select target.id, target.campaign_id
    into v_target_id, v_campaign_id
    from public.automation_targets target
    where target.id = p_selection_id
      and target.user_id = p_user_id
      and target.platform_account_id = p_platform_account_id
      and target.status <> 'RETIRED'
      and target.budget_owner_key is not null;

    if v_target_id is null or v_campaign_id is null then
      raise exception 'Customer automation budget owner is invalid';
    end if;
  end if;

  select selection.status
  into v_before_status
  from public.automation_scope_selections selection
  where selection.user_id = p_user_id
    and selection.platform_account_id = p_platform_account_id
    and selection.selection_type = p_selection_type
    and selection.selection_key = p_selection_id::text;

  v_before_status := coalesce(v_before_status, 'SUSPENDED');

  insert into public.automation_scope_selections (
    user_id,
    platform_account_id,
    selection_type,
    selection_key,
    campaign_id,
    automation_target_id,
    status,
    reason,
    customer_confirmed_at,
    customer_confirmed_by,
    updated_at
  ) values (
    p_user_id,
    p_platform_account_id,
    p_selection_type,
    p_selection_id::text,
    v_campaign_id,
    v_target_id,
    p_status,
    v_reason,
    now(),
    p_user_id,
    now()
  )
  on conflict (platform_account_id, selection_type, selection_key)
  do update set
    status = excluded.status,
    reason = excluded.reason,
    customer_confirmed_at = excluded.customer_confirmed_at,
    customer_confirmed_by = excluded.customer_confirmed_by,
    updated_at = now()
  returning id into v_selection_id;

  update public.automation_targets target
  set
    status = public.resolve_meta_automation_scope_status(
      target.user_id,
      target.platform_account_id,
      target.id,
      target.campaign_id
    ),
    row_version = target.row_version + 1,
    updated_at = now()
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.campaign_id = v_campaign_id
    and target.status <> 'RETIRED';

  get diagnostics v_affected_count = row_count;

  select count(*)
  into v_managed_budget_owner_count
  from public.automation_targets target
  where target.user_id = p_user_id
    and target.platform_account_id = p_platform_account_id
    and target.campaign_id = v_campaign_id
    and target.status = 'MANAGED'
    and target.budget_owner_key is not null;

  perform public.append_meta_mutation_audit_event(
    p_user_id,
    p_platform_account_id,
    v_policy_id,
    null,
    null,
    null,
    'CUSTOMER',
    p_user_id::text,
    'AUTOMATION_SCOPE_CHANGED',
    jsonb_build_object(
      'selection_type', p_selection_type,
      'selection_id', p_selection_id,
      'status', v_before_status
    ),
    jsonb_build_object(
      'selection_type', p_selection_type,
      'selection_id', p_selection_id,
      'status', p_status,
      'reason', v_reason
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'selection_id', v_selection_id,
      'status', p_status,
      'affected_target_count', v_affected_count,
      'managed_budget_owner_count', v_managed_budget_owner_count
    ),
    jsonb_build_object('contract_version', 1),
    null,
    null,
    null,
    null,
    null,
    now()
  );

  return query select
    v_selection_id,
    v_affected_count,
    v_managed_budget_owner_count;
end;
$$;

comment on table public.automation_scope_selections is
  'Current customer-confirmed management scope for synced Meta campaigns and individual budget owners; every change is also recorded in the append-only mutation audit chain.';
comment on function public.set_meta_customer_automation_scope(uuid, uuid, text, uuid, text, text) is
  'Selects or suspends one tenant-owned Meta campaign or budget owner and recalculates its fail-closed automation targets.';

revoke all on function public.resolve_meta_automation_scope_status(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.apply_meta_automation_scope_to_target()
  from public, anon, authenticated;
revoke all on function public.set_meta_customer_automation_scope(
  uuid, uuid, text, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.resolve_meta_automation_scope_status(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.set_meta_customer_automation_scope(
  uuid, uuid, text, uuid, text, text
) to service_role;
