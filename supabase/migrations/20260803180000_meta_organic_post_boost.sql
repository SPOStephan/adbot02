-- Organic Facebook/Instagram post boost: per-account defaults, per-post
-- overrides, materializer (object_story_id, no new creatives), planner hook,
-- and canary approval. Tenant isolation remains (user_id, platform_account_id).

begin;

create table if not exists public.meta_boost_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  version integer not null check (version > 0),
  is_current boolean not null default true,
  enabled boolean not null default false,
  auto_boost_new_candidates boolean not null default false,
  require_manual_approval boolean not null default true,
  budget_mode text not null check (budget_mode in ('DAILY', 'LIFETIME')),
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  duration_days integer not null check (duration_days between 1 and 90),
  budget_owner_type text not null
    check (budget_owner_type in ('CAMPAIGN', 'AD_SET')),
  objective text not null default 'OUTCOME_ENGAGEMENT'
    check (objective in ('OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT')),
  optimization_goal text not null default 'POST_ENGAGEMENT',
  billing_event text not null default 'IMPRESSIONS',
  source_filter text not null default 'facebook'
    check (source_filter in ('facebook', 'instagram', 'both')),
  default_countries text[] not null default array['DE']::text[],
  default_cta_type text
    check (default_cta_type is null or default_cta_type ~ '^[A-Z0-9_]{2,64}$'),
  default_destination_url text
    check (
      default_destination_url is null
      or (
        char_length(default_destination_url) between 9 and 2048
        and default_destination_url ~ '^https://'
      )
    ),
  settings_hash text not null check (settings_hash ~ '^[0-9a-f]{64}$'),
  customer_confirmed_at timestamptz not null default now(),
  customer_confirmed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_boost_settings_actor_check
    check (customer_confirmed_by = user_id),
  constraint meta_boost_settings_budget_contract_check check (
    (
      budget_mode = 'DAILY'
      and daily_budget_minor is not null
      and daily_budget_minor > 0
      and lifetime_budget_minor is null
    ) or (
      budget_mode = 'LIFETIME'
      and lifetime_budget_minor is not null
      and lifetime_budget_minor > 0
      and daily_budget_minor is null
      and budget_owner_type = 'CAMPAIGN'
    )
  ),
  constraint meta_boost_settings_countries_check
    check (
      cardinality(default_countries) between 1 and 50
      and default_countries <@ array[
        'DE','AT','CH','NL','BE','FR','IT','ES','PL','US','GB','IE','SE','DK','NO','FI','CZ','PT','LU'
      ]::text[]
    ),
  constraint meta_boost_settings_cta_pair_check check (
    (default_cta_type is null and default_destination_url is null)
    or (default_cta_type is not null and default_destination_url is not null)
  )
);

create unique index if not exists meta_boost_settings_current_account_uidx
  on public.meta_boost_settings (platform_account_id)
  where is_current;

create index if not exists meta_boost_settings_user_idx
  on public.meta_boost_settings (user_id, platform_account_id, version desc);

create table if not exists public.meta_content_boost_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  content_candidate_id uuid not null
    references public.meta_content_candidates(id) on delete cascade,
  mode text not null check (mode in ('INHERIT', 'SKIP', 'BOOST')),
  budget_mode text check (budget_mode in ('DAILY', 'LIFETIME')),
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  duration_days integer check (duration_days is null or duration_days between 1 and 90),
  cta_type text check (cta_type is null or cta_type ~ '^[A-Z0-9_]{2,64}$'),
  destination_url text
    check (
      destination_url is null
      or (
        char_length(destination_url) between 9 and 2048
        and destination_url ~ '^https://'
      )
    ),
  clear_cta boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_content_boost_overrides_candidate_key
    unique (platform_account_id, content_candidate_id),
  constraint meta_content_boost_overrides_budget_check check (
    budget_mode is null
    or (
      budget_mode = 'DAILY'
      and daily_budget_minor is not null
      and daily_budget_minor > 0
      and lifetime_budget_minor is null
    )
    or (
      budget_mode = 'LIFETIME'
      and lifetime_budget_minor is not null
      and lifetime_budget_minor > 0
      and daily_budget_minor is null
    )
  ),
  constraint meta_content_boost_overrides_cta_check check (
    clear_cta
    or (
      (cta_type is null and destination_url is null)
      or (cta_type is not null and destination_url is not null)
    )
  )
);

create index if not exists meta_content_boost_overrides_user_idx
  on public.meta_content_boost_overrides (user_id, platform_account_id);

create table if not exists public.meta_organic_boost_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  content_candidate_id uuid not null
    references public.meta_content_candidates(id) on delete restrict,
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  object_story_id text not null,
  settings_hash text not null,
  created_at timestamptz not null default now(),
  constraint meta_organic_boost_links_candidate_key unique (content_candidate_id),
  constraint meta_organic_boost_links_plan_key unique (plan_id),
  constraint meta_organic_boost_links_story_check
    check (char_length(object_story_id) between 3 and 255)
);

create index if not exists meta_organic_boost_links_account_idx
  on public.meta_organic_boost_links (platform_account_id, created_at desc);

create table if not exists public.meta_organic_boost_canary_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  content_candidate_id uuid not null
    references public.meta_content_candidates(id) on delete restrict,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  object_story_id text not null,
  budget_mode text not null check (budget_mode in ('DAILY', 'LIFETIME')),
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  duration_days integer not null check (duration_days between 1 and 90),
  destination_url text,
  reason text not null check (char_length(reason) between 12 and 500),
  approved_by uuid not null references public.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meta_organic_boost_canary_approvals_plan_key unique (plan_id),
  constraint meta_organic_boost_canary_approvals_actor_check
    check (approved_by = user_id),
  constraint meta_organic_boost_canary_approvals_budget_check check (
    (
      budget_mode = 'DAILY'
      and daily_budget_minor > 0
      and lifetime_budget_minor is null
    ) or (
      budget_mode = 'LIFETIME'
      and lifetime_budget_minor > 0
      and daily_budget_minor is null
    )
  )
);

create trigger guard_meta_boost_settings_tenant_scope
  before insert or update on public.meta_boost_settings
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_content_boost_overrides_tenant_scope
  before insert or update on public.meta_content_boost_overrides
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_organic_boost_links_tenant_scope
  before insert or update on public.meta_organic_boost_links
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_organic_boost_canary_approvals_tenant_scope
  before insert or update on public.meta_organic_boost_canary_approvals
  for each row execute function public.guard_meta_control_tenant_scope();

create trigger guard_meta_organic_boost_canary_approvals_append_only
  before update or delete on public.meta_organic_boost_canary_approvals
  for each row execute function public.guard_meta_append_only();

alter table public.meta_boost_settings enable row level security;
alter table public.meta_content_boost_overrides enable row level security;
alter table public.meta_organic_boost_links enable row level security;
alter table public.meta_organic_boost_canary_approvals enable row level security;

revoke all on public.meta_boost_settings from anon, authenticated;
revoke all on public.meta_content_boost_overrides from anon, authenticated;
revoke all on public.meta_organic_boost_links from anon, authenticated;
revoke all on public.meta_organic_boost_canary_approvals from anon, authenticated;

grant select on public.meta_boost_settings to authenticated;
grant select on public.meta_content_boost_overrides to authenticated;
grant select (
  id, user_id, platform_account_id, content_candidate_id, plan_id,
  object_story_id, created_at
) on public.meta_organic_boost_links to authenticated;
grant select on public.meta_organic_boost_canary_approvals to authenticated;

grant all on public.meta_boost_settings to service_role;
grant all on public.meta_content_boost_overrides to service_role;
grant all on public.meta_organic_boost_links to service_role;
grant all on public.meta_organic_boost_canary_approvals to service_role;

create policy meta_boost_settings_select_own
  on public.meta_boost_settings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy meta_content_boost_overrides_select_own
  on public.meta_content_boost_overrides for select to authenticated
  using ((select auth.uid()) = user_id);

create policy meta_organic_boost_links_select_own
  on public.meta_organic_boost_links for select to authenticated
  using ((select auth.uid()) = user_id);

create policy meta_organic_boost_canary_approvals_select_own
  on public.meta_organic_boost_canary_approvals for select to authenticated
  using ((select auth.uid()) = user_id);

-- Hold/freeze canary gates: organic boosts may auto-execute when explicitly
-- configured and the plan payload says so.
create or replace function public.hold_meta_launch_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action_type <> 'LAUNCH_CHAIN' or new.safety_action then
    return new;
  end if;

  if new.source_rule_key = 'organic-boost'
    and coalesce((new.planned_payload->>'require_manual_approval')::boolean, true) = false then
    new.not_before := coalesce(new.not_before, now());
    new.max_attempts := greatest(coalesce(new.max_attempts, 1), 1);
    return new;
  end if;

  new.not_before := 'infinity'::timestamptz;
  new.max_attempts := 1;
  return new;
end;
$$;

create or replace function public.freeze_meta_launch_plan_for_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action_type <> 'LAUNCH_CHAIN' or new.safety_action then
    return new;
  end if;

  if new.source_rule_key = 'organic-boost'
    and coalesce((new.planned_payload->>'require_manual_approval')::boolean, true) = false then
    perform public.append_meta_mutation_audit_event(
      new.user_id,
      new.platform_account_id,
      new.policy_id,
      new.id,
      null,
      null,
      'SYSTEM',
      'meta-organic-boost-auto',
      'ORGANIC_BOOST_AUTO_QUEUED',
      '{}'::jsonb,
      jsonb_build_object(
        'payload_hash', new.payload_hash,
        'content_candidate_id', new.planned_payload->>'content_candidate_id',
        'object_story_id', new.planned_payload->>'object_story_id'
      ),
      '{}'::jsonb,
      jsonb_build_object('plan_status', new.status, 'not_before', new.not_before),
      jsonb_build_object('launch_kind', 'ORGANIC_BOOST'),
      null, null, null, null, null, now()
    );
    return new;
  end if;

  perform public.append_meta_kill_switch_state(
    'PLAN',
    new.user_id,
    new.platform_account_id,
    new.id,
    'FREEZE_WRITES',
    'Aktiv-Launch wartet auf exakte Kundenbestätigung',
    'SYSTEM',
    'meta-launch-canary-gate'
  );

  perform public.append_meta_mutation_audit_event(
    new.user_id,
    new.platform_account_id,
    new.policy_id,
    new.id,
    null,
    null,
    'SYSTEM',
    'meta-launch-canary-gate',
    'LAUNCH_CANARY_CONFIRMATION_REQUIRED',
    '{}'::jsonb,
    jsonb_build_object(
      'payload_hash', new.payload_hash,
      'not_before', 'infinity',
      'max_attempts', 1
    ),
    '{}'::jsonb,
    jsonb_build_object('plan_status', new.status),
    jsonb_build_object(
      'objective', new.planned_payload->>'objective',
      'destination_url', new.planned_payload->>'destination_url',
      'daily_budget_minor', new.planned_payload->>'daily_budget_minor',
      'target_status', new.intended_after->>'status',
      'launch_kind', coalesce(new.planned_payload->>'launch_kind', 'ACTIVE_LAUNCH')
    ),
    null, null, null, null, null, now()
  );

  return new;
end;
$$;

create or replace function public.put_meta_boost_settings_version(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_enabled boolean,
  p_auto_boost_new_candidates boolean,
  p_require_manual_approval boolean,
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
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_enabled is null
    or p_auto_boost_new_candidates is null
    or p_require_manual_approval is null
    or p_budget_mode not in ('DAILY', 'LIFETIME')
    or p_duration_days is null
    or p_duration_days < 1
    or p_duration_days > 90
    or p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or p_objective not in ('OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT')
    or p_source_filter not in ('facebook', 'instagram', 'both') then
    raise exception 'Boost settings input is incomplete or invalid';
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

  if p_auto_boost_new_candidates and not p_enabled then
    raise exception 'Auto-boost requires boost settings to be enabled';
  end if;

  if not p_require_manual_approval and not p_auto_boost_new_candidates then
    raise exception 'Auto-execute without manual approval requires auto-boost';
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
    'schema_version', 1,
    'enabled', p_enabled,
    'auto_boost_new_candidates', p_auto_boost_new_candidates,
    'require_manual_approval', p_require_manual_approval,
    'budget_mode', p_budget_mode,
    'daily_budget_minor', p_daily_budget_minor,
    'lifetime_budget_minor', p_lifetime_budget_minor,
    'duration_days', p_duration_days,
    'budget_owner_type', p_budget_owner_type,
    'objective', p_objective,
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
    enabled, auto_boost_new_candidates, require_manual_approval,
    budget_mode, daily_budget_minor, lifetime_budget_minor, duration_days,
    budget_owner_type, objective, optimization_goal, billing_event,
    source_filter, default_countries, default_cta_type, default_destination_url,
    settings_hash, customer_confirmed_at, customer_confirmed_by
  ) values (
    v_id, p_user_id, p_platform_account_id, v_version, true,
    p_enabled, p_auto_boost_new_candidates, p_require_manual_approval,
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
    jsonb_build_object('settings_id', v_id, 'version', v_version),
    jsonb_build_object('settings_hash', v_hash),
    null, null, null, null, null, now()
  );

  return v_id;
end;
$$;

revoke all on function public.put_meta_boost_settings_version(
  uuid, uuid, boolean, boolean, boolean, text, bigint, bigint, integer, text,
  text, text, text[], text, text
) from public, anon, authenticated;
grant execute on function public.put_meta_boost_settings_version(
  uuid, uuid, boolean, boolean, boolean, text, bigint, bigint, integer, text,
  text, text, text[], text, text
) to service_role;

create or replace function public.upsert_meta_content_boost_override(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_content_candidate_id uuid,
  p_mode text,
  p_budget_mode text,
  p_daily_budget_minor bigint,
  p_lifetime_budget_minor bigint,
  p_duration_days integer,
  p_cta_type text,
  p_destination_url text,
  p_clear_cta boolean,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_candidate public.meta_content_candidates%rowtype;
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_content_candidate_id is null
    or p_mode not in ('INHERIT', 'SKIP', 'BOOST')
    or p_clear_cta is null then
    raise exception 'Boost override input is incomplete';
  end if;

  select candidate.* into v_candidate
  from public.meta_content_candidates candidate
  where candidate.id = p_content_candidate_id
    and candidate.user_id = p_user_id
    and candidate.platform_account_id = p_platform_account_id
  for update;

  if not found then
    raise exception 'Content candidate not found for tenant';
  end if;

  if p_budget_mode is not null then
    if p_budget_mode = 'DAILY' then
      if p_daily_budget_minor is null or p_daily_budget_minor <= 0
        or p_lifetime_budget_minor is not null then
        raise exception 'Override daily budget is invalid';
      end if;
    elsif p_budget_mode = 'LIFETIME' then
      if p_lifetime_budget_minor is null or p_lifetime_budget_minor <= 0
        or p_daily_budget_minor is not null then
        raise exception 'Override lifetime budget is invalid';
      end if;
    else
      raise exception 'Override budget mode is invalid';
    end if;
  elsif p_daily_budget_minor is not null or p_lifetime_budget_minor is not null then
    raise exception 'Override budget amount requires budget mode';
  end if;

  if p_clear_cta then
    if p_cta_type is not null or p_destination_url is not null then
      raise exception 'clear_cta cannot be combined with CTA values';
    end if;
  elsif (p_cta_type is null) <> (p_destination_url is null) then
    raise exception 'CTA type and destination URL must be set together';
  elsif p_destination_url is not null
    and p_destination_url !~ '^https://[^/\s]+' then
    raise exception 'Override destination URL must be HTTPS';
  end if;

  insert into public.meta_content_boost_overrides (
    user_id, platform_account_id, content_candidate_id, mode,
    budget_mode, daily_budget_minor, lifetime_budget_minor, duration_days,
    cta_type, destination_url, clear_cta, notes, updated_at
  ) values (
    p_user_id, p_platform_account_id, p_content_candidate_id, p_mode,
    p_budget_mode, p_daily_budget_minor, p_lifetime_budget_minor, p_duration_days,
    p_cta_type, p_destination_url, p_clear_cta, nullif(btrim(coalesce(p_notes, '')), ''),
    now()
  )
  on conflict (platform_account_id, content_candidate_id) do update
  set
    mode = excluded.mode,
    budget_mode = excluded.budget_mode,
    daily_budget_minor = excluded.daily_budget_minor,
    lifetime_budget_minor = excluded.lifetime_budget_minor,
    duration_days = excluded.duration_days,
    cta_type = excluded.cta_type,
    destination_url = excluded.destination_url,
    clear_cta = excluded.clear_cta,
    notes = excluded.notes,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_meta_content_boost_override(
  uuid, uuid, uuid, text, text, bigint, bigint, integer, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.upsert_meta_content_boost_override(
  uuid, uuid, uuid, text, text, bigint, bigint, integer, text, text, boolean, text
) to service_role;

commit;
