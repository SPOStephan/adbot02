-- Explicit customer boost modes: OFF / REVIEW / AUTO.
-- REVIEW plans new posts for per-post approval; AUTO executes with defaults.

begin;

alter table public.meta_boost_settings
  add column if not exists boost_mode text;

update public.meta_boost_settings
set boost_mode = case
  when not enabled then 'OFF'
  when require_manual_approval then 'REVIEW'
  else 'AUTO'
end
where boost_mode is null;

alter table public.meta_boost_settings
  alter column boost_mode set default 'OFF';

alter table public.meta_boost_settings
  alter column boost_mode set not null;

alter table public.meta_boost_settings
  drop constraint if exists meta_boost_settings_boost_mode_check;

alter table public.meta_boost_settings
  add constraint meta_boost_settings_boost_mode_check
  check (boost_mode in ('OFF', 'REVIEW', 'AUTO'));

alter table public.meta_boost_settings
  drop constraint if exists meta_boost_settings_mode_flag_check;

alter table public.meta_boost_settings
  add constraint meta_boost_settings_mode_flag_check check (
    (
      boost_mode = 'OFF'
      and enabled = false
      and auto_boost_new_candidates = false
      and require_manual_approval = true
    ) or (
      boost_mode = 'REVIEW'
      and enabled = true
      and auto_boost_new_candidates = true
      and require_manual_approval = true
    ) or (
      boost_mode = 'AUTO'
      and enabled = true
      and auto_boost_new_candidates = true
      and require_manual_approval = false
      and budget_mode = 'DAILY'
    )
  );

drop function if exists public.put_meta_boost_settings_version(
  uuid, uuid, boolean, boolean, boolean, text, bigint, bigint, integer, text,
  text, text, text[], text, text
);

create or replace function public.put_meta_boost_settings_version(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_boost_mode text,
  p_budget_mode text,
  p_daily_budget_minor bigint,
  p_lifetime_budget_minor bigint,
  p_duration_days integer,
  p_budget_owner_type text,
  p_objective text,
  p_source_filter text,
  p_default_countries text[],
  p_default_cta_type text,
  p_default_destination_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_version integer;
  v_current public.meta_boost_settings%rowtype;
  v_payload jsonb;
  v_hash text;
  v_countries text[];
  v_enabled boolean;
  v_auto boolean;
  v_require_manual boolean;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_boost_mode not in ('OFF', 'REVIEW', 'AUTO')
    or p_budget_mode not in ('DAILY', 'LIFETIME')
    or p_duration_days is null
    or p_duration_days < 1
    or p_duration_days > 90
    or p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or p_objective not in ('OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT')
    or p_source_filter not in ('facebook', 'instagram', 'both') then
    raise exception 'Boost settings input is incomplete or invalid';
  end if;

  if p_boost_mode = 'AUTO' and p_budget_mode <> 'DAILY' then
    raise exception 'Automatic boost mode requires a daily budget with fixed duration';
  end if;

  if p_budget_mode = 'DAILY' then
    if p_daily_budget_minor is null or p_daily_budget_minor <= 0
      or p_lifetime_budget_minor is not null then
      raise exception 'Daily boost budget is invalid';
    end if;
  else
    if p_lifetime_budget_minor is null or p_lifetime_budget_minor <= 0
      or p_daily_budget_minor is not null
      or p_budget_owner_type <> 'CAMPAIGN' then
      raise exception 'Lifetime boost budget is invalid';
    end if;
  end if;

  if (p_default_cta_type is null) <> (p_default_destination_url is null) then
    raise exception 'CTA type and destination URL must be set together';
  end if;

  if p_default_destination_url is not null
    and p_default_destination_url !~ '^https://[^/\s]+' then
    raise exception 'Boost destination URL must be HTTPS';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
      and pa.marketing_currency = 'EUR'
  ) then
    raise exception 'Boost settings require an active EUR Meta account';
  end if;

  v_countries := coalesce(p_default_countries, array['DE']::text[]);
  if cardinality(v_countries) < 1 or cardinality(v_countries) > 50 then
    raise exception 'Boost country targeting is invalid';
  end if;

  if p_boost_mode = 'OFF' then
    v_enabled := false;
    v_auto := false;
    v_require_manual := true;
  elsif p_boost_mode = 'REVIEW' then
    v_enabled := true;
    v_auto := true;
    v_require_manual := true;
  else
    v_enabled := true;
    v_auto := true;
    v_require_manual := false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('boost-settings:' || p_platform_account_id::text, 0)
  );

  select settings.* into v_current
  from public.meta_boost_settings settings
  where settings.platform_account_id = p_platform_account_id
    and settings.user_id = p_user_id
    and settings.is_current
  for update;

  v_payload := jsonb_build_object(
    'schema_version', 2,
    'boost_mode', p_boost_mode,
    'enabled', v_enabled,
    'auto_boost_new_candidates', v_auto,
    'require_manual_approval', v_require_manual,
    'budget_mode', p_budget_mode,
    'daily_budget_minor', p_daily_budget_minor,
    'lifetime_budget_minor', p_lifetime_budget_minor,
    'duration_days', p_duration_days,
    'budget_owner_type', p_budget_owner_type,
    'objective', p_objective,
    'optimization_goal', 'POST_ENGAGEMENT',
    'source_filter', p_source_filter,
    'default_countries', to_jsonb(v_countries),
    'default_cta_type', p_default_cta_type,
    'default_destination_url', p_default_destination_url
  );
  v_hash := public.meta_sha256(v_payload::text);

  if v_current.id is not null and v_current.settings_hash = v_hash then
    return v_current.id;
  end if;

  select coalesce(max(settings.version), 0) + 1
  into v_version
  from public.meta_boost_settings settings
  where settings.platform_account_id = p_platform_account_id
    and settings.user_id = p_user_id;

  if v_current.id is not null then
    update public.meta_boost_settings
    set is_current = false, updated_at = now()
    where id = v_current.id;
  end if;

  insert into public.meta_boost_settings (
    id, user_id, platform_account_id, version, is_current,
    boost_mode, enabled, auto_boost_new_candidates, require_manual_approval,
    budget_mode, daily_budget_minor, lifetime_budget_minor, duration_days,
    budget_owner_type, objective, optimization_goal, billing_event,
    source_filter, default_countries, default_cta_type, default_destination_url,
    settings_hash, customer_confirmed_at, customer_confirmed_by
  ) values (
    v_id, p_user_id, p_platform_account_id, v_version, true,
    p_boost_mode, v_enabled, v_auto, v_require_manual,
    p_budget_mode, p_daily_budget_minor, p_lifetime_budget_minor, p_duration_days,
    p_budget_owner_type, p_objective, 'POST_ENGAGEMENT', 'IMPRESSIONS',
    p_source_filter, v_countries, p_default_cta_type, p_default_destination_url,
    v_hash, now(), p_user_id
  );

  perform public.append_meta_mutation_audit_event(
    p_user_id, p_platform_account_id, null, null, null, null,
    'CUSTOMER', p_user_id::text, 'CUSTOMER_BOOST_SETTINGS_CONFIRMED',
    coalesce(to_jsonb(v_current), '{}'::jsonb),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'settings_id', v_id,
      'version', v_version,
      'boost_mode', p_boost_mode
    ),
    jsonb_build_object('settings_hash', v_hash),
    null, null, null, null, null, now()
  );

  return v_id;
end;
$$;

revoke all on function public.put_meta_boost_settings_version(
  uuid, uuid, text, text, bigint, bigint, integer, text, text, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.put_meta_boost_settings_version(
  uuid, uuid, text, text, bigint, bigint, integer, text, text, text, text[], text, text
) to service_role;

comment on column public.meta_boost_settings.boost_mode is
  'OFF = disabled; REVIEW = plan new posts for per-post approval; AUTO = plan and execute with account defaults.';

commit;
