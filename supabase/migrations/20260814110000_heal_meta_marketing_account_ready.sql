-- Account-only marketing heal: restore EUR / sync_id / last_success without
-- replacing campaign rows. Used when Graph collections soft-fail (#100) so
-- Beitrag-Push readiness is not stuck on ACCOUNT_UNAVAILABLE forever.

begin;

create or replace function public.heal_meta_marketing_account_ready(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_sync_id uuid,
  p_account jsonb,
  p_usage jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ad_account_id text;
  v_currency text;
begin
  if p_platform_account_id is null
    or p_user_id is null
    or p_sync_id is null
    or jsonb_typeof(p_account) is distinct from 'object'
  then
    raise exception 'heal_meta_marketing_account_ready_invalid_input';
  end if;

  v_ad_account_id := nullif(trim(p_account->>'meta_ad_account_id'), '');
  v_currency := upper(nullif(trim(p_account->>'currency'), ''));

  if v_ad_account_id is null or v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'heal_meta_marketing_account_ready_invalid_account';
  end if;

  update public.platform_accounts
  set
    marketing_meta_ad_account_id = v_ad_account_id,
    marketing_currency = v_currency,
    marketing_timezone_name = nullif(p_account->>'timezone_name', ''),
    marketing_timezone_offset_hours_utc =
      nullif(p_account->>'timezone_offset_hours_utc', '')::numeric,
    marketing_account_status = nullif(p_account->>'account_status', '')::integer,
    marketing_sync_status = 'success',
    marketing_sync_error_code = null,
    marketing_last_success_at = now(),
    marketing_backoff_until = null,
    marketing_consecutive_failures = 0,
    marketing_sync_id = p_sync_id,
    marketing_usage = coalesce(p_usage, '{}'::jsonb),
    -- Keep existing object counts; do not wipe Live-Kampagnen.
    updated_at = now()
  where id = p_platform_account_id
    and user_id = p_user_id
    and platform = 'meta'
    and revoked_at is null;

  if not found then
    raise exception 'heal_meta_marketing_account_ready_not_found';
  end if;

  return jsonb_build_object(
    'status', 'healed',
    'marketing_sync_id', p_sync_id,
    'currency', v_currency
  );
end;
$$;

comment on function public.heal_meta_marketing_account_ready(uuid, uuid, uuid, jsonb, jsonb) is
  'Restore marketing readiness (EUR, sync_id, last_success) without replacing campaign snapshot rows.';

revoke all on function public.heal_meta_marketing_account_ready(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.heal_meta_marketing_account_ready(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

commit;
