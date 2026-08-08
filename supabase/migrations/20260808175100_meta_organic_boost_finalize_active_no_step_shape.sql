-- 08175000 failed: setting steps to REMOTE_APPLIED without dispatch_started_at /
-- remote_applied_at violates mutation_plan_steps_dispatch_shape_check.
-- Only finalize the plan row; leave step wire-state untouched.

begin;

create or replace function public.finalize_meta_organic_boost_already_active_plans(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
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

  -- Do not mutate mutation_plan_steps here: dispatch_shape / remote_applied
  -- checks require dispatch_started_at + remote_applied_at. Plan SUCCEEDED is
  -- enough to clear due counts for Ampel/Abruf.
  update public.mutation_plans mp
  set
    status = 'SUCCEEDED',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_class = null,
    blocked_reason = null,
    terminal_at = coalesce(mp.terminal_at, now()),
    updated_at = now()
  where mp.user_id = p_user_id
    and mp.platform_account_id = p_platform_account_id
    and mp.source_rule_key = 'organic-boost'
    and mp.action_type = 'LAUNCH_CHAIN'
    and mp.status in (
      'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING'
    )
    and exists (
      select 1
      from public.remote_object_bindings binding
      join public.campaigns campaign
        on campaign.platform_account_id = binding.platform_account_id
       and campaign.user_id = binding.user_id
       and campaign.is_current
       and (
         campaign.platform_campaign_id = binding.remote_object_id
         or campaign.id = binding.local_campaign_id
       )
      where binding.plan_id = mp.id
        and binding.user_id = p_user_id
        and binding.platform_account_id = p_platform_account_id
        and binding.object_type = 'CAMPAIGN'
        and upper(coalesce(campaign.effective_status, campaign.status, '')) = 'ACTIVE'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid)
  to service_role;

comment on function public.finalize_meta_organic_boost_already_active_plans(uuid, uuid) is
  'Marks organic LAUNCH_CHAIN plans SUCCEEDED when Meta campaign is ACTIVE; does not rewrite step dispatch shape.';

-- Re-run finalize for stuck accounts (safe, plan-only).
do $oneshot$
declare
  r record;
begin
  for r in
    select distinct mp.user_id, mp.platform_account_id
    from public.mutation_plans mp
    where mp.source_rule_key = 'organic-boost'
      and mp.action_type = 'LAUNCH_CHAIN'
      and mp.status in (
        'PENDING', 'RETRYABLE', 'CLAIMED', 'EXECUTING', 'RECONCILING'
      )
  loop
    perform public.finalize_meta_organic_boost_already_active_plans(
      r.user_id, r.platform_account_id
    );
  end loop;
end;
$oneshot$;

commit;
