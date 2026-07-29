begin;

-- Meta Write Control Plane v1. No browser role can write these relations.
-- Meta writes are represented as immutable plans and executed only after a
-- service-role-only database claim has validated tenant, policy and leases.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.meta_sha256(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

create or replace function public.meta_calculate_exposure_minor(
  p_daily_budget_minor bigint,
  p_multiplier_bps integer
)
returns bigint
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_daily_budget_minor < 0 or p_daily_budget_minor > 100000000000000 then
    raise exception 'Daily budget is outside supported minor-unit range';
  end if;

  if p_multiplier_bps < 10000 or p_multiplier_bps > 50000 then
    raise exception 'Flex-spend multiplier is outside supported range';
  end if;

  return (
    (p_daily_budget_minor * p_multiplier_bps::bigint) + 9999
  ) / 10000;
end;
$$;

create table public.automation_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  previous_policy_id uuid references public.automation_policies(id) on delete restrict,
  version integer not null,
  status text not null default 'OFF'
    check (status in ('OFF', 'READY', 'ACTIVE', 'SUSPENDED', 'EMERGENCY_STOP')),
  currency text not null default 'EUR',
  account_daily_hard_cap_minor bigint,
  default_campaign_daily_hard_cap_minor bigint,
  budget_change_limit_bps integer not null default 2000,
  cooldown_seconds integer not null default 43200,
  standard_flex_spend_multiplier_bps integer not null default 17500,
  shared_budget_flex_spend_multiplier_bps integer not null default 21000,
  allow_budget_changes boolean not null default false,
  allow_status_changes boolean not null default false,
  allow_new_launches boolean not null default false,
  require_verified_domain boolean not null default true,
  policy_payload jsonb not null default '{}'::jsonb,
  policy_hash text not null,
  is_current boolean not null default true,
  customer_confirmed_at timestamptz,
  customer_confirmed_by uuid references public.users(id) on delete restrict,
  activated_at timestamptz,
  suspended_at timestamptz,
  suspension_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_policies_account_version_key
    unique (platform_account_id, version),
  constraint automation_policies_currency_check
    check (currency = upper(currency) and char_length(currency) = 3),
  constraint automation_policies_caps_check
    check (
      (account_daily_hard_cap_minor is null or account_daily_hard_cap_minor > 0)
      and (
        default_campaign_daily_hard_cap_minor is null
        or default_campaign_daily_hard_cap_minor > 0
      )
      and (
        account_daily_hard_cap_minor is null
        or default_campaign_daily_hard_cap_minor is null
        or default_campaign_daily_hard_cap_minor <= account_daily_hard_cap_minor
      )
    ),
  constraint automation_policies_budget_limit_check
    check (budget_change_limit_bps between 1 and 2000),
  constraint automation_policies_cooldown_check
    check (cooldown_seconds >= 43200),
  constraint automation_policies_multiplier_check
    check (
      standard_flex_spend_multiplier_bps between 10000 and 50000
      and shared_budget_flex_spend_multiplier_bps
        between greatest(21000, standard_flex_spend_multiplier_bps) and 50000
    ),
  constraint automation_policies_payload_object_check
    check (jsonb_typeof(policy_payload) = 'object'),
  constraint automation_policies_hash_check
    check (policy_hash ~ '^[0-9a-f]{64}$'),
  constraint automation_policies_active_gate_check
    check (
      status <> 'ACTIVE'
      or (
        is_current
        and currency = 'EUR'
        and account_daily_hard_cap_minor is not null
        and default_campaign_daily_hard_cap_minor is not null
        and customer_confirmed_at is not null
        and customer_confirmed_by is not null
        and activated_at is not null
      )
    ),
  constraint automation_policies_suspension_check
    check (
      status <> 'SUSPENDED'
      or (suspended_at is not null and nullif(suspension_reason, '') is not null)
    )
);

create unique index automation_policies_current_account_key
  on public.automation_policies (platform_account_id)
  where is_current;
create index automation_policies_user_status_idx
  on public.automation_policies (user_id, status, updated_at desc);

create table public.allowed_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  hostname text not null,
  registrable_domain text not null,
  expected_redirect_hostname text,
  observed_redirect_hostname text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'VERIFIED', 'REVOKED', 'FAILED')),
  verification_method text,
  verification_evidence jsonb not null default '{}'::jsonb,
  customer_confirmed_at timestamptz,
  customer_confirmed_by uuid references public.users(id) on delete restrict,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint allowed_domains_account_hostname_key
    unique (platform_account_id, hostname),
  constraint allowed_domains_hostname_check
    check (
      hostname = lower(hostname)
      and char_length(hostname) between 1 and 253
      and hostname !~ '://'
      and hostname !~ '/'
      and hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    ),
  constraint allowed_domains_registrable_check
    check (
      registrable_domain = lower(registrable_domain)
      and char_length(registrable_domain) between 1 and 253
      and registrable_domain !~ '://'
      and registrable_domain !~ '/'
    ),
  constraint allowed_domains_evidence_object_check
    check (jsonb_typeof(verification_evidence) = 'object'),
  constraint allowed_domains_verified_gate_check
    check (
      status <> 'VERIFIED'
      or (
        verified_at is not null
        and customer_confirmed_at is not null
        and customer_confirmed_by is not null
        and nullif(verification_method, '') is not null
      )
    )
);

create index allowed_domains_user_status_idx
  on public.allowed_domains (user_id, status, updated_at desc);

create table public.objective_blueprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  objective text not null,
  version integer not null,
  name text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ACTIVE', 'RETIRED', 'BLOCKED')),
  payload_template jsonb not null,
  required_inputs jsonb not null default '[]'::jsonb,
  compliance_rules jsonb not null default '{}'::jsonb,
  blueprint_hash text not null,
  customer_confirmed_at timestamptz,
  customer_confirmed_by uuid references public.users(id) on delete restrict,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint objective_blueprints_account_objective_version_key
    unique (platform_account_id, objective, version),
  constraint objective_blueprints_objective_check
    check (objective ~ '^[A-Z][A-Z0-9_]{1,99}$'),
  constraint objective_blueprints_version_check check (version > 0),
  constraint objective_blueprints_name_check
    check (char_length(name) between 1 and 255),
  constraint objective_blueprints_json_check
    check (
      jsonb_typeof(payload_template) = 'object'
      and jsonb_typeof(required_inputs) = 'array'
      and jsonb_typeof(compliance_rules) = 'object'
    ),
  constraint objective_blueprints_hash_check
    check (blueprint_hash ~ '^[0-9a-f]{64}$'),
  constraint objective_blueprints_active_gate_check
    check (
      status <> 'ACTIVE'
      or (
        customer_confirmed_at is not null
        and customer_confirmed_by is not null
        and activated_at is not null
      )
    )
);

create unique index objective_blueprints_active_account_objective_key
  on public.objective_blueprints (platform_account_id, objective)
  where status = 'ACTIVE';
create index objective_blueprints_user_status_idx
  on public.objective_blueprints (user_id, status, objective);

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  source_type text not null
    check (source_type in ('EXISTING_META', 'UPLOADED', 'GENERATED')),
  provider_key text,
  provider_model text,
  provider_version text,
  provider_asset_id text,
  source_meta_asset_id text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  sha256 text not null,
  mime_type text not null,
  byte_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  brand_policy_version integer not null,
  generation_input_hash text,
  moderation_status text not null default 'PENDING'
    check (moderation_status in ('PENDING', 'APPROVED', 'REJECTED')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'READY', 'REJECTED', 'REVOKED')),
  meta_image_hash text,
  metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_assets_account_sha256_key
    unique (platform_account_id, sha256),
  constraint brand_assets_hash_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_assets_generation_hash_check
    check (generation_input_hash is null or generation_input_hash ~ '^[0-9a-f]{64}$'),
  constraint brand_assets_mime_check
    check (mime_type ~ '^(image|video)/[a-z0-9.+-]+$'),
  constraint brand_assets_size_check
    check (
      (byte_size is null or byte_size > 0)
      and (width is null or width > 0)
      and (height is null or height > 0)
      and (duration_ms is null or duration_ms >= 0)
      and brand_policy_version > 0
    ),
  constraint brand_assets_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint brand_assets_provider_check
    check (
      source_type <> 'GENERATED'
      or (
        nullif(provider_key, '') is not null
        and nullif(provider_model, '') is not null
        and generation_input_hash is not null
      )
    ),
  constraint brand_assets_ready_gate_check
    check (
      status <> 'READY'
      or (moderation_status = 'APPROVED' and reviewed_at is not null)
    )
);

create index brand_assets_user_status_idx
  on public.brand_assets (user_id, status, updated_at desc);

create table public.automation_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  target_type text not null check (target_type in ('CAMPAIGN', 'AD_SET', 'AD')),
  target_key text not null,
  platform_object_id text not null,
  campaign_scope_key text not null,
  budget_owner_type text
    check (budget_owner_type is null or budget_owner_type in ('CAMPAIGN', 'AD_SET')),
  budget_owner_key text,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  ad_group_id uuid references public.ad_groups(id) on delete restrict,
  ad_id uuid references public.ads(id) on delete restrict,
  status text not null default 'MANAGED'
    check (status in ('MANAGED', 'SUSPENDED', 'RETIRED')),
  last_successful_mutation_at timestamptz,
  last_reconciled_at timestamptz,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_targets_account_type_remote_key
    unique (platform_account_id, target_type, platform_object_id),
  constraint automation_targets_account_target_key
    unique (platform_account_id, target_key),
  constraint automation_targets_key_length_check
    check (
      char_length(target_key) between 1 and 255
      and char_length(campaign_scope_key) between 1 and 255
      and char_length(platform_object_id) between 1 and 255
      and (budget_owner_key is null or char_length(budget_owner_key) between 1 and 255)
    ),
  constraint automation_targets_budget_owner_check
    check ((budget_owner_type is null) = (budget_owner_key is null)),
  constraint automation_targets_local_identity_check
    check (
      (target_type = 'CAMPAIGN' and campaign_id is not null and ad_group_id is null and ad_id is null)
      or (target_type = 'AD_SET' and campaign_id is not null and ad_group_id is not null and ad_id is null)
      or (target_type = 'AD' and campaign_id is not null and ad_group_id is not null and ad_id is not null)
    )
);

create index automation_targets_user_status_idx
  on public.automation_targets (user_id, status, target_type);
create index automation_targets_account_budget_owner_idx
  on public.automation_targets (platform_account_id, budget_owner_key)
  where budget_owner_key is not null;

create table public.campaign_budget_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  campaign_scope_key text not null,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  daily_hard_cap_minor bigint not null check (daily_hard_cap_minor > 0),
  customer_confirmed_at timestamptz not null,
  customer_confirmed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_budget_limits_policy_scope_key
    unique (policy_id, campaign_scope_key),
  constraint campaign_budget_limits_scope_length_check
    check (char_length(campaign_scope_key) between 1 and 255)
);

create index campaign_budget_limits_user_policy_idx
  on public.campaign_budget_limits (user_id, policy_id);

create table public.daily_budget_exposure_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  account_day date not null,
  account_timezone_name text not null,
  source_marketing_sync_id uuid not null,
  currency text not null,
  status text not null default 'BUILDING'
    check (status in ('BUILDING', 'COMPLETE', 'STALE')),
  observed_budget_owner_count integer not null default 0,
  reserved_exposure_minor bigint not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_exposure_snapshots_account_day_sync_key
    unique (platform_account_id, account_day, source_marketing_sync_id),
  constraint daily_exposure_snapshots_values_check
    check (
      currency = upper(currency)
      and char_length(currency) = 3
      and observed_budget_owner_count >= 0
      and reserved_exposure_minor >= 0
    ),
  constraint daily_exposure_snapshots_complete_check
    check (status <> 'COMPLETE' or completed_at is not null)
);

create index daily_exposure_snapshots_account_status_idx
  on public.daily_budget_exposure_snapshots (
    platform_account_id, account_day desc, status, created_at desc
  );

create table public.mutation_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  source_marketing_sync_id uuid not null,
  source_recommendation_id uuid
    references public.campaign_recommendations(id) on delete restrict,
  source_rule_key text,
  source_rule_version integer,
  action_type text not null check (action_type in (
    'UPDATE_BUDGET', 'PAUSE', 'ACTIVATE', 'LAUNCH_CHAIN', 'LAUNCH_AD',
    'SAFETY_PAUSE'
  )),
  target_type text not null check (target_type in (
    'ACCOUNT', 'CAMPAIGN', 'AD_SET', 'AD', 'CHAIN'
  )),
  target_key text not null,
  campaign_scope_key text,
  budget_owner_key text,
  automation_target_id uuid references public.automation_targets(id) on delete restrict,
  idempotency_key text not null,
  expected_before jsonb not null,
  intended_after jsonb not null,
  planned_payload jsonb not null,
  payload_hash text not null,
  validation_fingerprint text,
  validated_at timestamptz,
  status text not null default 'PENDING' check (status in (
    'PENDING', 'PREFLIGHT_FAILED', 'CLAIMED', 'EXECUTING', 'RECONCILING',
    'SUCCEEDED', 'RETRYABLE', 'BLOCKED', 'COMPENSATION_REQUIRED', 'FAILED',
    'CANCELLED', 'STALE'
  )),
  priority integer not null default 50 check (priority between 1 and 100),
  safety_action boolean not null default false,
  not_before timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  blocked_reason text,
  error_class text,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mutation_plans_idempotency_key unique (idempotency_key),
  constraint mutation_plans_key_hash_check
    check (
      idempotency_key ~ '^[0-9a-f]{64}$'
      and payload_hash ~ '^[0-9a-f]{64}$'
      and (
        validation_fingerprint is null
        or validation_fingerprint ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint mutation_plans_json_check
    check (
      jsonb_typeof(expected_before) = 'object'
      and jsonb_typeof(intended_after) = 'object'
      and jsonb_typeof(planned_payload) = 'object'
    ),
  constraint mutation_plans_target_key_check
    check (
      char_length(target_key) between 1 and 255
      and (campaign_scope_key is null or char_length(campaign_scope_key) between 1 and 255)
      and (budget_owner_key is null or char_length(budget_owner_key) between 1 and 255)
    ),
  constraint mutation_plans_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint mutation_plans_lease_check
    check (
      (lease_token is null and lease_owner is null and lease_expires_at is null)
      or (lease_token is not null and nullif(lease_owner, '') is not null and lease_expires_at is not null)
    ),
  constraint mutation_plans_validation_check
    check ((validation_fingerprint is null) = (validated_at is null)),
  constraint mutation_plans_terminal_check
    check (
      status not in (
        'PREFLIGHT_FAILED', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'CANCELLED', 'STALE'
      )
      or terminal_at is not null
    ),
  constraint mutation_plans_safety_type_check
    check (not safety_action or action_type = 'SAFETY_PAUSE')
);

create index mutation_plans_due_idx
  on public.mutation_plans (priority desc, not_before, created_at)
  where status in ('PENDING', 'RETRYABLE');
create index mutation_plans_user_status_idx
  on public.mutation_plans (user_id, status, created_at desc);
create index mutation_plans_target_history_idx
  on public.mutation_plans (
    platform_account_id, target_key, status, created_at desc
  );

create table public.mutation_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  step_index integer not null,
  step_key text not null,
  operation text not null check (operation in (
    'VALIDATE', 'CREATE', 'UPDATE', 'READ', 'RECONCILE', 'COMPENSATE'
  )),
  object_type text not null check (object_type in (
    'ACCOUNT', 'CAMPAIGN', 'AD_SET', 'CREATIVE', 'IMAGE', 'AD'
  )),
  depends_on_step_id uuid references public.mutation_plan_steps(id) on delete restrict,
  planned_request jsonb not null,
  request_hash text not null,
  expected_result jsonb not null default '{}'::jsonb,
  compensation_operation text
    check (compensation_operation is null or compensation_operation in ('PAUSE', 'NONE')),
  status text not null default 'PENDING' check (status in (
    'PENDING', 'VALIDATED', 'CLAIMED', 'RUNNING', 'REMOTE_APPLIED',
    'RECONCILED', 'RETRYABLE', 'FAILED', 'COMPENSATION_REQUIRED', 'SKIPPED'
  )),
  attempt_count integer not null default 0,
  not_before timestamptz not null default now(),
  validation_fingerprint text,
  validated_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_class text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mutation_plan_steps_plan_index_key unique (plan_id, step_index),
  constraint mutation_plan_steps_plan_step_key unique (plan_id, step_key),
  constraint mutation_plan_steps_index_check check (step_index >= 0),
  constraint mutation_plan_steps_key_check
    check (char_length(step_key) between 1 and 100),
  constraint mutation_plan_steps_json_check
    check (
      jsonb_typeof(planned_request) = 'object'
      and jsonb_typeof(expected_result) = 'object'
    ),
  constraint mutation_plan_steps_hash_check
    check (
      request_hash ~ '^[0-9a-f]{64}$'
      and (
        validation_fingerprint is null
        or validation_fingerprint ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint mutation_plan_steps_validation_check
    check ((validation_fingerprint is null) = (validated_at is null)),
  constraint mutation_plan_steps_attempt_check check (attempt_count >= 0)
);

create index mutation_plan_steps_plan_status_idx
  on public.mutation_plan_steps (plan_id, status, step_index);

create table public.mutation_executions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  attempt_number integer not null,
  worker_id text not null,
  lease_token uuid not null,
  status text not null default 'CLAIMED' check (status in (
    'CLAIMED', 'RUNNING', 'RECONCILING', 'SUCCEEDED', 'RETRYABLE',
    'COMPENSATION_REQUIRED', 'FAILED', 'ABANDONED'
  )),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  error_class text,
  error_code text,
  error_message text,
  usage_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mutation_executions_plan_attempt_key
    unique (plan_id, attempt_number),
  constraint mutation_executions_worker_check
    check (char_length(worker_id) between 1 and 255),
  constraint mutation_executions_attempt_check check (attempt_number > 0),
  constraint mutation_executions_usage_object_check
    check (jsonb_typeof(usage_snapshot) = 'object'),
  constraint mutation_executions_finished_check
    check (
      status not in (
        'SUCCEEDED', 'RETRYABLE', 'COMPENSATION_REQUIRED', 'FAILED', 'ABANDONED'
      )
      or finished_at is not null
    )
);

create index mutation_executions_account_started_idx
  on public.mutation_executions (platform_account_id, started_at desc);

create table public.remote_object_bindings (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  step_id uuid not null references public.mutation_plan_steps(id) on delete restrict,
  execution_id uuid references public.mutation_executions(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  object_type text not null check (object_type in (
    'CAMPAIGN', 'AD_SET', 'CREATIVE', 'IMAGE', 'AD'
  )),
  remote_object_id text not null,
  deterministic_name text,
  request_fingerprint text not null,
  remote_fingerprint text,
  local_campaign_id uuid references public.campaigns(id) on delete restrict,
  local_ad_group_id uuid references public.ad_groups(id) on delete restrict,
  local_ad_id uuid references public.ads(id) on delete restrict,
  local_creative_id uuid references public.creatives(id) on delete restrict,
  bound_at timestamptz not null default now(),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint remote_object_bindings_account_object_remote_key
    unique (platform_account_id, object_type, remote_object_id),
  constraint remote_object_bindings_plan_step_key unique (plan_id, step_id),
  constraint remote_object_bindings_remote_id_check
    check (char_length(remote_object_id) between 1 and 255),
  constraint remote_object_bindings_hash_check
    check (
      request_fingerprint ~ '^[0-9a-f]{64}$'
      and (remote_fingerprint is null or remote_fingerprint ~ '^[0-9a-f]{64}$')
    )
);

create index remote_object_bindings_plan_idx
  on public.remote_object_bindings (plan_id, object_type);

create table public.daily_budget_exposures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  snapshot_id uuid not null
    references public.daily_budget_exposure_snapshots(id) on delete restrict,
  plan_id uuid references public.mutation_plans(id) on delete restrict,
  automation_target_id uuid references public.automation_targets(id) on delete restrict,
  account_day date not null,
  campaign_scope_key text not null,
  budget_owner_key text not null,
  budget_owner_type text not null check (budget_owner_type in ('CAMPAIGN', 'AD_SET')),
  shared_budget_enabled boolean not null default false,
  currency text not null,
  max_daily_budget_minor bigint not null,
  flex_spend_multiplier_bps integer not null,
  reserved_exposure_minor bigint generated always as (
    ((max_daily_budget_minor * flex_spend_multiplier_bps::bigint) + 9999) / 10000
  ) stored,
  source text not null check (source in ('SNAPSHOT', 'PLAN', 'RECONCILIATION')),
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_budget_exposures_account_day_owner_key
    unique (platform_account_id, account_day, budget_owner_key),
  constraint daily_budget_exposures_values_check
    check (
      char_length(campaign_scope_key) between 1 and 255
      and char_length(budget_owner_key) between 1 and 255
      and currency = upper(currency)
      and char_length(currency) = 3
      and max_daily_budget_minor between 0 and 100000000000000
      and flex_spend_multiplier_bps between 10000 and 50000
      and (not shared_budget_enabled or flex_spend_multiplier_bps >= 21000)
    )
);

create index daily_budget_exposures_account_day_idx
  on public.daily_budget_exposures (
    platform_account_id, account_day, campaign_scope_key
  );

create table public.budget_mutation_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid not null references public.automation_policies(id) on delete restrict,
  plan_id uuid not null references public.mutation_plans(id) on delete restrict,
  step_id uuid not null references public.mutation_plan_steps(id) on delete restrict,
  execution_id uuid not null references public.mutation_executions(id) on delete restrict,
  automation_target_id uuid not null
    references public.automation_targets(id) on delete restrict,
  budget_owner_key text not null,
  currency text not null,
  before_budget_minor bigint not null,
  after_budget_minor bigint not null,
  absolute_delta_minor bigint generated always as (
    case
      when after_budget_minor >= before_budget_minor
        then after_budget_minor - before_budget_minor
      else before_budget_minor - after_budget_minor
    end
  ) stored,
  remote_request_id text,
  executed_at timestamptz not null,
  reconciled_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint budget_mutation_ledger_plan_step_key unique (plan_id, step_id),
  constraint budget_mutation_ledger_values_check
    check (
      char_length(budget_owner_key) between 1 and 255
      and currency = upper(currency)
      and char_length(currency) = 3
      and before_budget_minor >= 0
      and after_budget_minor >= 0
      and before_budget_minor <> after_budget_minor
      and reconciled_at >= executed_at
    )
);

create index budget_mutation_ledger_target_window_idx
  on public.budget_mutation_ledger (
    automation_target_id, executed_at desc
  );

create table public.mutation_audit_events (
  event_sequence bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  policy_id uuid references public.automation_policies(id) on delete restrict,
  plan_id uuid references public.mutation_plans(id) on delete restrict,
  step_id uuid references public.mutation_plan_steps(id) on delete restrict,
  execution_id uuid references public.mutation_executions(id) on delete restrict,
  actor_type text not null check (actor_type in (
    'CUSTOMER', 'SYSTEM', 'CRON', 'EXECUTOR', 'RECONCILER', 'PROVIDER'
  )),
  actor_id text,
  event_type text not null,
  before_state jsonb not null default '{}'::jsonb,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  provider_key text,
  provider_model text,
  provider_version text,
  remote_request_id text,
  error_class text,
  previous_event_hash text,
  event_hash text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint mutation_audit_events_json_check
    check (
      jsonb_typeof(before_state) = 'object'
      and jsonb_typeof(request_payload) = 'object'
      and jsonb_typeof(response_payload) = 'object'
      and jsonb_typeof(after_state) = 'object'
      and jsonb_typeof(metadata) = 'object'
    ),
  constraint mutation_audit_events_hash_check
    check (
      event_hash ~ '^[0-9a-f]{64}$'
      and (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$')
    ),
  constraint mutation_audit_events_type_check
    check (event_type ~ '^[A-Z][A-Z0-9_]{1,99}$'),
  constraint mutation_audit_events_secret_key_check
    check (
      (before_state || request_payload || response_payload || after_state || metadata)::text
        !~* '"(access_token|authorization|client_secret|app_secret|refresh_token|token_iv|token_auth_tag)"[[:space:]]*:'
    )
);

create index mutation_audit_events_account_sequence_idx
  on public.mutation_audit_events (platform_account_id, event_sequence desc);
create index mutation_audit_events_plan_sequence_idx
  on public.mutation_audit_events (plan_id, event_sequence)
  where plan_id is not null;

create table public.kill_switch_state (
  sequence bigint generated always as identity primary key,
  id uuid not null unique default gen_random_uuid(),
  scope_type text not null check (scope_type in ('SYSTEM', 'ACCOUNT', 'PLAN')),
  user_id uuid references public.users(id) on delete restrict,
  platform_account_id uuid references public.platform_accounts(id) on delete restrict,
  plan_id uuid references public.mutation_plans(id) on delete restrict,
  mode text not null check (mode in ('ALLOW', 'FREEZE_WRITES', 'PAUSE_MANAGED')),
  reason text not null,
  actor_type text not null check (actor_type in ('CUSTOMER', 'SYSTEM', 'OPERATOR')),
  actor_id text,
  created_at timestamptz not null default now(),
  constraint kill_switch_state_scope_check
    check (
      (scope_type = 'SYSTEM' and user_id is null and platform_account_id is null and plan_id is null)
      or (
        scope_type = 'ACCOUNT'
        and user_id is not null
        and platform_account_id is not null
        and plan_id is null
      )
      or (
        scope_type = 'PLAN'
        and user_id is not null
        and platform_account_id is not null
        and plan_id is not null
      )
    ),
  constraint kill_switch_state_reason_check
    check (char_length(reason) between 1 and 1000)
);

create index kill_switch_system_latest_idx
  on public.kill_switch_state (sequence desc)
  where scope_type = 'SYSTEM';
create index kill_switch_account_latest_idx
  on public.kill_switch_state (platform_account_id, sequence desc)
  where scope_type = 'ACCOUNT';
create index kill_switch_plan_latest_idx
  on public.kill_switch_state (plan_id, sequence desc)
  where scope_type = 'PLAN';

create table public.automation_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts(id) on delete restrict,
  plan_id uuid references public.mutation_plans(id) on delete restrict,
  dedup_key text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  alert_type text not null,
  title text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_alerts_account_dedup_key
    unique (platform_account_id, dedup_key),
  constraint automation_alerts_details_object_check
    check (jsonb_typeof(details) = 'object'),
  constraint automation_alerts_status_time_check
    check (
      (status <> 'ACKNOWLEDGED' or acknowledged_at is not null)
      and (status <> 'RESOLVED' or resolved_at is not null)
    )
);

create index automation_alerts_user_status_idx
  on public.automation_alerts (user_id, status, severity, last_seen_at desc);

create table public.meta_account_operation_leases (
  platform_account_id uuid primary key
    references public.platform_accounts(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  lease_kind text check (lease_kind is null or lease_kind in ('READ_SYNC', 'WRITE_EXECUTION')),
  lease_token uuid,
  owner_id text,
  acquired_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint meta_account_operation_leases_shape_check
    check (
      (
        lease_kind is null and lease_token is null and owner_id is null
        and acquired_at is null and expires_at is null
      )
      or (
        lease_kind is not null and lease_token is not null
        and nullif(owner_id, '') is not null
        and acquired_at is not null and expires_at is not null
        and expires_at > acquired_at
      )
    )
);

-- Foreign-key support indexes keep tenant checks, plan traversal and RESTRICT
-- validation bounded as the immutable ledgers grow.
create index automation_policies_previous_idx
  on public.automation_policies (previous_policy_id)
  where previous_policy_id is not null;
create index automation_policies_confirmer_idx
  on public.automation_policies (customer_confirmed_by)
  where customer_confirmed_by is not null;
create index allowed_domains_confirmer_idx
  on public.allowed_domains (customer_confirmed_by)
  where customer_confirmed_by is not null;
create index objective_blueprints_confirmer_idx
  on public.objective_blueprints (customer_confirmed_by)
  where customer_confirmed_by is not null;
create index brand_assets_reviewer_idx
  on public.brand_assets (reviewed_by)
  where reviewed_by is not null;
create index automation_targets_campaign_idx
  on public.automation_targets (campaign_id);
create index automation_targets_ad_group_idx
  on public.automation_targets (ad_group_id)
  where ad_group_id is not null;
create index automation_targets_ad_idx
  on public.automation_targets (ad_id)
  where ad_id is not null;
create index campaign_budget_limits_account_idx
  on public.campaign_budget_limits (platform_account_id);
create index campaign_budget_limits_campaign_idx
  on public.campaign_budget_limits (campaign_id)
  where campaign_id is not null;
create index campaign_budget_limits_confirmer_idx
  on public.campaign_budget_limits (customer_confirmed_by);
create index daily_exposure_snapshots_policy_idx
  on public.daily_budget_exposure_snapshots (policy_id);
create index daily_exposure_snapshots_user_idx
  on public.daily_budget_exposure_snapshots (user_id);
create index mutation_plans_policy_idx
  on public.mutation_plans (policy_id);
create index mutation_plans_recommendation_idx
  on public.mutation_plans (source_recommendation_id)
  where source_recommendation_id is not null;
create index mutation_plans_automation_target_idx
  on public.mutation_plans (automation_target_id)
  where automation_target_id is not null;
create index mutation_plan_steps_user_idx
  on public.mutation_plan_steps (user_id);
create index mutation_plan_steps_account_idx
  on public.mutation_plan_steps (platform_account_id);
create index mutation_plan_steps_dependency_idx
  on public.mutation_plan_steps (depends_on_step_id)
  where depends_on_step_id is not null;
create index mutation_executions_user_idx
  on public.mutation_executions (user_id);
create index remote_bindings_step_idx
  on public.remote_object_bindings (step_id);
create index remote_bindings_execution_idx
  on public.remote_object_bindings (execution_id)
  where execution_id is not null;
create index remote_bindings_user_idx
  on public.remote_object_bindings (user_id);
create index remote_bindings_campaign_idx
  on public.remote_object_bindings (local_campaign_id)
  where local_campaign_id is not null;
create index remote_bindings_ad_group_idx
  on public.remote_object_bindings (local_ad_group_id)
  where local_ad_group_id is not null;
create index remote_bindings_ad_idx
  on public.remote_object_bindings (local_ad_id)
  where local_ad_id is not null;
create index remote_bindings_creative_idx
  on public.remote_object_bindings (local_creative_id)
  where local_creative_id is not null;
create index daily_budget_exposures_user_idx
  on public.daily_budget_exposures (user_id);
create index daily_budget_exposures_policy_idx
  on public.daily_budget_exposures (policy_id);
create index daily_budget_exposures_snapshot_idx
  on public.daily_budget_exposures (snapshot_id);
create index daily_budget_exposures_plan_idx
  on public.daily_budget_exposures (plan_id)
  where plan_id is not null;
create index daily_budget_exposures_target_idx
  on public.daily_budget_exposures (automation_target_id)
  where automation_target_id is not null;
create index budget_ledger_user_idx
  on public.budget_mutation_ledger (user_id);
create index budget_ledger_account_idx
  on public.budget_mutation_ledger (platform_account_id);
create index budget_ledger_policy_idx
  on public.budget_mutation_ledger (policy_id);
create index budget_ledger_step_idx
  on public.budget_mutation_ledger (step_id);
create index budget_ledger_execution_idx
  on public.budget_mutation_ledger (execution_id);
create index mutation_audit_user_idx
  on public.mutation_audit_events (user_id);
create index mutation_audit_policy_idx
  on public.mutation_audit_events (policy_id)
  where policy_id is not null;
create index mutation_audit_step_idx
  on public.mutation_audit_events (step_id)
  where step_id is not null;
create index mutation_audit_execution_idx
  on public.mutation_audit_events (execution_id)
  where execution_id is not null;
create index kill_switch_user_idx
  on public.kill_switch_state (user_id)
  where user_id is not null;
create index automation_alerts_plan_idx
  on public.automation_alerts (plan_id)
  where plan_id is not null;
create index meta_account_leases_user_idx
  on public.meta_account_operation_leases (user_id);

-- Every tenant-scoped control row must reference objects from exactly the same
-- customer and Meta connector. This protects against service-code mistakes in
-- addition to RLS, which only controls browser visibility.
create or replace function public.guard_meta_control_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'kill_switch_state' then
    if new.scope_type = 'SYSTEM' then
      return new;
    end if;
  end if;

  if new.user_id is null or new.platform_account_id is null or not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = new.platform_account_id
      and pa.user_id = new.user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Cross-tenant or non-Meta control-plane account reference rejected';
  end if;

  if tg_table_name = 'automation_policies' then
    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Policy confirmer must be the owning customer';
    end if;
    if new.previous_policy_id is not null and not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.previous_policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Previous policy belongs to another tenant or account';
    end if;
  elsif tg_table_name = 'allowed_domains' then
    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Domain confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'objective_blueprints' then
    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Blueprint confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'brand_assets' then
    if new.reviewed_by is not null and new.reviewed_by <> new.user_id then
      raise exception 'Brand asset reviewer must be the owning customer';
    end if;
  elsif tg_table_name = 'automation_targets' then
    if not exists (
      select 1 from public.campaigns c
      where c.id = new.campaign_id
        and c.user_id = new.user_id
        and c.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation target campaign scope is invalid';
    end if;
    if new.ad_group_id is not null and not exists (
      select 1 from public.ad_groups ag
      where ag.id = new.ad_group_id
        and ag.campaign_id = new.campaign_id
        and ag.user_id = new.user_id
        and ag.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation target ad-set scope is invalid';
    end if;
    if new.ad_id is not null and not exists (
      select 1 from public.ads a
      where a.id = new.ad_id
        and a.ad_group_id = new.ad_group_id
        and a.user_id = new.user_id
        and a.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation target ad scope is invalid';
    end if;
  elsif tg_table_name = 'campaign_budget_limits' then
    if new.customer_confirmed_by <> new.user_id or not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Campaign budget limit policy or confirmer scope is invalid';
    end if;
    if new.campaign_id is not null and not exists (
      select 1 from public.campaigns c
      where c.id = new.campaign_id
        and c.user_id = new.user_id
        and c.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Campaign budget limit campaign scope is invalid';
    end if;
  elsif tg_table_name = 'daily_budget_exposure_snapshots' then
    if not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Exposure snapshot policy scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_plans' then
    if not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation plan policy scope is invalid';
    end if;
    if new.automation_target_id is not null and not exists (
      select 1 from public.automation_targets target
      where target.id = new.automation_target_id
        and target.user_id = new.user_id
        and target.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation plan target scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_plan_steps' then
    if not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation step plan scope is invalid';
    end if;
    if new.depends_on_step_id is not null and not exists (
      select 1 from public.mutation_plan_steps mps
      where mps.id = new.depends_on_step_id
        and mps.plan_id = new.plan_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation step dependency scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_executions' then
    if not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Mutation execution plan scope is invalid';
    end if;
  elsif tg_table_name = 'remote_object_bindings' then
    if not exists (
      select 1
      from public.mutation_plans mp
      join public.mutation_plan_steps mps
        on mps.id = new.step_id and mps.plan_id = mp.id
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Remote object binding plan or step scope is invalid';
    end if;
    if new.execution_id is not null and not exists (
      select 1 from public.mutation_executions me
      where me.id = new.execution_id
        and me.plan_id = new.plan_id
        and me.user_id = new.user_id
        and me.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Remote object binding execution scope is invalid';
    end if;
  elsif tg_table_name = 'daily_budget_exposures' then
    if not exists (
      select 1
      from public.automation_policies ap
      join public.daily_budget_exposure_snapshots s
        on s.id = new.snapshot_id and s.policy_id = ap.id
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
        and s.user_id = new.user_id
        and s.platform_account_id = new.platform_account_id
        and s.account_day = new.account_day
    ) then
      raise exception 'Daily exposure policy or snapshot scope is invalid';
    end if;
    if new.plan_id is not null and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Daily exposure plan scope is invalid';
    end if;
    if new.automation_target_id is not null and not exists (
      select 1 from public.automation_targets target
      where target.id = new.automation_target_id
        and target.user_id = new.user_id
        and target.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Daily exposure target scope is invalid';
    end if;
  elsif tg_table_name = 'budget_mutation_ledger' then
    if not exists (
      select 1
      from public.mutation_plans mp
      join public.mutation_plan_steps mps
        on mps.id = new.step_id and mps.plan_id = mp.id
      join public.mutation_executions me
        on me.id = new.execution_id and me.plan_id = mp.id
      join public.automation_targets target
        on target.id = new.automation_target_id
      where mp.id = new.plan_id
        and mp.policy_id = new.policy_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
        and me.user_id = new.user_id
        and me.platform_account_id = new.platform_account_id
        and target.user_id = new.user_id
        and target.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Budget ledger execution scope is invalid';
    end if;
  elsif tg_table_name = 'mutation_audit_events' then
    if new.policy_id is not null and not exists (
      select 1 from public.automation_policies ap
      where ap.id = new.policy_id
        and ap.user_id = new.user_id
        and ap.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit policy scope is invalid';
    end if;
    if new.plan_id is not null and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit plan scope is invalid';
    end if;
    if new.step_id is not null and not exists (
      select 1 from public.mutation_plan_steps mps
      where mps.id = new.step_id
        and mps.plan_id = new.plan_id
        and mps.user_id = new.user_id
        and mps.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit step scope is invalid';
    end if;
    if new.execution_id is not null and not exists (
      select 1 from public.mutation_executions me
      where me.id = new.execution_id
        and me.plan_id = new.plan_id
        and me.user_id = new.user_id
        and me.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Audit execution scope is invalid';
    end if;
  elsif tg_table_name = 'kill_switch_state' then
    if new.scope_type = 'PLAN' and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Plan kill-switch scope is invalid';
    end if;
  elsif tg_table_name = 'automation_alerts' then
    if new.plan_id is not null and not exists (
      select 1 from public.mutation_plans mp
      where mp.id = new.plan_id
        and mp.user_id = new.user_id
        and mp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Automation alert plan scope is invalid';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_automation_policies_tenant_scope
  before insert or update on public.automation_policies
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_allowed_domains_tenant_scope
  before insert or update on public.allowed_domains
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_objective_blueprints_tenant_scope
  before insert or update on public.objective_blueprints
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_brand_assets_tenant_scope
  before insert or update on public.brand_assets
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_automation_targets_tenant_scope
  before insert or update on public.automation_targets
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_campaign_budget_limits_tenant_scope
  before insert or update on public.campaign_budget_limits
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_daily_exposure_snapshots_tenant_scope
  before insert or update on public.daily_budget_exposure_snapshots
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_mutation_plans_tenant_scope
  before insert or update on public.mutation_plans
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_mutation_plan_steps_tenant_scope
  before insert or update on public.mutation_plan_steps
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_mutation_executions_tenant_scope
  before insert or update on public.mutation_executions
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_remote_object_bindings_tenant_scope
  before insert or update on public.remote_object_bindings
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_daily_budget_exposures_tenant_scope
  before insert or update on public.daily_budget_exposures
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_budget_mutation_ledger_tenant_scope
  before insert or update on public.budget_mutation_ledger
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_mutation_audit_events_tenant_scope
  before insert or update on public.mutation_audit_events
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_kill_switch_state_tenant_scope
  before insert or update on public.kill_switch_state
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_automation_alerts_tenant_scope
  before insert or update on public.automation_alerts
  for each row execute function public.guard_meta_control_tenant_scope();
create trigger guard_meta_account_operation_leases_tenant_scope
  before insert or update on public.meta_account_operation_leases
  for each row execute function public.guard_meta_control_tenant_scope();

-- Immutable intent fields cannot be changed after plan creation.
create or replace function public.guard_meta_mutation_plan_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.policy_id is distinct from old.policy_id
    or new.source_marketing_sync_id is distinct from old.source_marketing_sync_id
    or new.source_recommendation_id is distinct from old.source_recommendation_id
    or new.source_rule_key is distinct from old.source_rule_key
    or new.source_rule_version is distinct from old.source_rule_version
    or new.action_type is distinct from old.action_type
    or new.target_type is distinct from old.target_type
    or new.target_key is distinct from old.target_key
    or new.campaign_scope_key is distinct from old.campaign_scope_key
    or new.budget_owner_key is distinct from old.budget_owner_key
    or new.automation_target_id is distinct from old.automation_target_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.expected_before is distinct from old.expected_before
    or new.intended_after is distinct from old.intended_after
    or new.planned_payload is distinct from old.planned_payload
    or new.payload_hash is distinct from old.payload_hash
    or new.safety_action is distinct from old.safety_action
    or new.created_at is distinct from old.created_at then
    raise exception 'Mutation plan intent is immutable';
  end if;

  return new;
end;
$$;

create trigger guard_meta_mutation_plan_update
  before update on public.mutation_plans
  for each row execute function public.guard_meta_mutation_plan_update();

create or replace function public.guard_meta_mutation_step_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_id is distinct from old.plan_id
    or new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.step_index is distinct from old.step_index
    or new.step_key is distinct from old.step_key
    or new.operation is distinct from old.operation
    or new.object_type is distinct from old.object_type
    or new.depends_on_step_id is distinct from old.depends_on_step_id
    or new.planned_request is distinct from old.planned_request
    or new.request_hash is distinct from old.request_hash
    or new.expected_result is distinct from old.expected_result
    or new.compensation_operation is distinct from old.compensation_operation
    or new.created_at is distinct from old.created_at then
    raise exception 'Mutation step intent is immutable';
  end if;

  return new;
end;
$$;

create trigger guard_meta_mutation_step_update
  before update on public.mutation_plan_steps
  for each row execute function public.guard_meta_mutation_step_update();

create or replace function public.guard_meta_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger budget_mutation_ledger_append_only
  before update or delete on public.budget_mutation_ledger
  for each row execute function public.guard_meta_append_only();
create trigger mutation_audit_events_append_only
  before update or delete on public.mutation_audit_events
  for each row execute function public.guard_meta_append_only();
create trigger kill_switch_state_append_only
  before update or delete on public.kill_switch_state
  for each row execute function public.guard_meta_append_only();

create or replace function public.guard_meta_exposure_non_decreasing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.policy_id is distinct from old.policy_id
    or new.snapshot_id is distinct from old.snapshot_id
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

create trigger guard_meta_exposure_non_decreasing
  before update on public.daily_budget_exposures
  for each row execute function public.guard_meta_exposure_non_decreasing();

create or replace function public.claim_meta_account_operation(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_lease_kind text,
  p_owner_id text,
  p_lease_seconds integer default 300
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_claimed uuid;
begin
  if p_lease_kind not in ('READ_SYNC', 'WRITE_EXECUTION')
    or nullif(p_owner_id, '') is null then
    raise exception 'Invalid Meta operation lease request';
  end if;

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

  insert into public.meta_account_operation_leases (
    platform_account_id, user_id
  ) values (
    p_platform_account_id, p_user_id
  ) on conflict (platform_account_id) do nothing;

  update public.meta_account_operation_leases
  set
    lease_kind = p_lease_kind,
    lease_token = v_token,
    owner_id = p_owner_id,
    acquired_at = now(),
    expires_at = now() + make_interval(
      secs => greatest(30, least(900, p_lease_seconds))
    ),
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
    and (expires_at is null or expires_at <= now())
  returning lease_token into v_claimed;

  return v_claimed;
end;
$$;

create or replace function public.heartbeat_meta_account_operation(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meta_account_operation_leases
  set
    expires_at = now() + make_interval(
      secs => greatest(30, least(900, p_lease_seconds))
    ),
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
    and lease_token = p_lease_token
    and expires_at > now();

  return found;
end;
$$;

create or replace function public.release_meta_account_operation(
  p_platform_account_id uuid,
  p_user_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meta_account_operation_leases
  set
    lease_kind = null,
    lease_token = null,
    owner_id = null,
    acquired_at = null,
    expires_at = null,
    updated_at = now()
  where platform_account_id = p_platform_account_id
    and user_id = p_user_id
    and lease_token = p_lease_token;

  return found;
end;
$$;

create or replace function public.append_meta_mutation_audit_event(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_plan_id uuid,
  p_step_id uuid,
  p_execution_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_event_type text,
  p_before_state jsonb default '{}'::jsonb,
  p_request_payload jsonb default '{}'::jsonb,
  p_response_payload jsonb default '{}'::jsonb,
  p_after_state jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_provider_key text default null,
  p_provider_model text default null,
  p_provider_version text default null,
  p_remote_request_id text default null,
  p_error_class text default null,
  p_occurred_at timestamptz default now()
)
returns table (
  event_id uuid,
  event_sequence bigint,
  event_hash text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_hash text;
  v_event_hash text;
  v_event_id uuid := gen_random_uuid();
  v_event_sequence bigint;
  v_canonical jsonb;
begin
  if p_actor_type not in (
      'CUSTOMER', 'SYSTEM', 'CRON', 'EXECUTOR', 'RECONCILER', 'PROVIDER'
    )
    or p_event_type !~ '^[A-Z][A-Z0-9_]{1,99}$' then
    raise exception 'Invalid audit event classification';
  end if;

  if jsonb_typeof(coalesce(p_before_state, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_request_payload, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_response_payload, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_after_state, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Audit payloads must be JSON objects';
  end if;

  if (
    coalesce(p_before_state, '{}'::jsonb)
    || coalesce(p_request_payload, '{}'::jsonb)
    || coalesce(p_response_payload, '{}'::jsonb)
    || coalesce(p_after_state, '{}'::jsonb)
    || coalesce(p_metadata, '{}'::jsonb)
  )::text ~* '"(access_token|authorization|client_secret|app_secret|refresh_token|token_iv|token_auth_tag)"[[:space:]]*:' then
    raise exception 'Sensitive key rejected from audit event';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Audit event Meta account scope is invalid';
  end if;

  if p_policy_id is not null and not exists (
    select 1 from public.automation_policies ap
    where ap.id = p_policy_id
      and ap.user_id = p_user_id
      and ap.platform_account_id = p_platform_account_id
  ) then
    raise exception 'Audit event policy scope is invalid';
  end if;

  if p_plan_id is not null and not exists (
    select 1 from public.mutation_plans mp
    where mp.id = p_plan_id
      and mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
  ) then
    raise exception 'Audit event plan scope is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_platform_account_id::text, 0)
  );

  select mae.event_hash into v_previous_hash
  from public.mutation_audit_events mae
  where mae.platform_account_id = p_platform_account_id
  order by mae.event_sequence desc
  limit 1;

  v_canonical := jsonb_build_object(
    'id', v_event_id,
    'user_id', p_user_id,
    'platform_account_id', p_platform_account_id,
    'policy_id', p_policy_id,
    'plan_id', p_plan_id,
    'step_id', p_step_id,
    'execution_id', p_execution_id,
    'actor_type', p_actor_type,
    'actor_id', p_actor_id,
    'event_type', p_event_type,
    'before_state', coalesce(p_before_state, '{}'::jsonb),
    'request_payload', coalesce(p_request_payload, '{}'::jsonb),
    'response_payload', coalesce(p_response_payload, '{}'::jsonb),
    'after_state', coalesce(p_after_state, '{}'::jsonb),
    'metadata', coalesce(p_metadata, '{}'::jsonb),
    'provider_key', p_provider_key,
    'provider_model', p_provider_model,
    'provider_version', p_provider_version,
    'remote_request_id', p_remote_request_id,
    'error_class', p_error_class,
    'occurred_at', p_occurred_at,
    'previous_event_hash', v_previous_hash
  );

  v_event_hash := public.meta_sha256(
    coalesce(v_previous_hash, '') || v_canonical::text
  );

  insert into public.mutation_audit_events (
    id, user_id, platform_account_id, policy_id, plan_id, step_id,
    execution_id, actor_type, actor_id, event_type, before_state,
    request_payload, response_payload, after_state, metadata, provider_key,
    provider_model, provider_version, remote_request_id, error_class,
    previous_event_hash, event_hash, occurred_at
  ) values (
    v_event_id, p_user_id, p_platform_account_id, p_policy_id, p_plan_id,
    p_step_id, p_execution_id, p_actor_type, p_actor_id, p_event_type,
    coalesce(p_before_state, '{}'::jsonb),
    coalesce(p_request_payload, '{}'::jsonb),
    coalesce(p_response_payload, '{}'::jsonb),
    coalesce(p_after_state, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb), p_provider_key, p_provider_model,
    p_provider_version, p_remote_request_id, p_error_class,
    v_previous_hash, v_event_hash, p_occurred_at
  ) returning mutation_audit_events.event_sequence into v_event_sequence;

  return query select v_event_id, v_event_sequence, v_event_hash;
end;
$$;

create or replace function public.append_meta_kill_switch_state(
  p_scope_type text,
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid,
  p_mode text,
  p_reason text,
  p_actor_type text,
  p_actor_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_scope_type not in ('SYSTEM', 'ACCOUNT', 'PLAN')
    or p_mode not in ('ALLOW', 'FREEZE_WRITES', 'PAUSE_MANAGED')
    or p_actor_type not in ('CUSTOMER', 'SYSTEM', 'OPERATOR')
    or nullif(p_reason, '') is null then
    raise exception 'Invalid kill-switch state';
  end if;

  if p_scope_type = 'SYSTEM' then
    if p_user_id is not null or p_platform_account_id is not null or p_plan_id is not null then
      raise exception 'System kill-switch scope must not contain tenant IDs';
    end if;
  elsif not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Kill-switch Meta account scope is invalid';
  elsif p_scope_type = 'ACCOUNT' and p_plan_id is not null then
    raise exception 'Account kill-switch must not contain a plan';
  elsif p_scope_type = 'PLAN' and not exists (
    select 1 from public.mutation_plans mp
    where mp.id = p_plan_id
      and mp.user_id = p_user_id
      and mp.platform_account_id = p_platform_account_id
  ) then
    raise exception 'Kill-switch plan scope is invalid';
  end if;

  insert into public.kill_switch_state (
    id, scope_type, user_id, platform_account_id, plan_id, mode, reason,
    actor_type, actor_id
  ) values (
    v_id, p_scope_type, p_user_id, p_platform_account_id, p_plan_id, p_mode,
    p_reason, p_actor_type, p_actor_id
  );

  if p_scope_type <> 'SYSTEM' then
    perform public.append_meta_mutation_audit_event(
      p_user_id,
      p_platform_account_id,
      null,
      p_plan_id,
      null,
      null,
      case when p_actor_type = 'CUSTOMER' then 'CUSTOMER' else 'SYSTEM' end,
      p_actor_id,
      'KILL_SWITCH_CHANGED',
      '{}'::jsonb,
      jsonb_build_object('scope_type', p_scope_type),
      '{}'::jsonb,
      jsonb_build_object('mode', p_mode, 'reason', p_reason),
      jsonb_build_object('kill_switch_event_id', v_id),
      null, null, null, null, null, now()
    );
  end if;

  return v_id;
end;
$$;

create or replace function public.get_effective_meta_kill_switch(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid default null
)
returns table (
  mode text,
  scope_type text,
  event_id uuid,
  reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
  ) then
    raise exception 'Kill-switch lookup scope is invalid';
  end if;

  return query
  with latest_system as (
    select kss.*
    from public.kill_switch_state kss
    where kss.scope_type = 'SYSTEM'
    order by kss.sequence desc
    limit 1
  ), latest_account as (
    select kss.*
    from public.kill_switch_state kss
    where kss.scope_type = 'ACCOUNT'
      and kss.user_id = p_user_id
      and kss.platform_account_id = p_platform_account_id
    order by kss.sequence desc
    limit 1
  ), latest_plan as (
    select kss.*
    from public.kill_switch_state kss
    where p_plan_id is not null
      and kss.scope_type = 'PLAN'
      and kss.user_id = p_user_id
      and kss.platform_account_id = p_platform_account_id
      and kss.plan_id = p_plan_id
    order by kss.sequence desc
    limit 1
  ), blocking as (
    select ls.*, 3 as precedence from latest_system ls where ls.mode <> 'ALLOW'
    union all
    select la.*, 2 as precedence from latest_account la where la.mode <> 'ALLOW'
    union all
    select lp.*, 1 as precedence from latest_plan lp where lp.mode <> 'ALLOW'
  )
  select b.mode, b.scope_type, b.id, b.reason, b.created_at
  from blocking b
  order by b.precedence desc
  limit 1;

  if not found then
    return query select
      'ALLOW'::text,
      null::text,
      null::uuid,
      null::text,
      null::timestamptz;
  end if;
end;
$$;

create or replace function public.reserve_meta_daily_budget_exposure(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_policy_id uuid,
  p_snapshot_id uuid,
  p_plan_id uuid,
  p_automation_target_id uuid,
  p_account_day date,
  p_campaign_scope_key text,
  p_budget_owner_key text,
  p_budget_owner_type text,
  p_shared_budget_enabled boolean,
  p_currency text,
  p_daily_budget_minor bigint,
  p_flex_spend_multiplier_bps integer,
  p_source text
)
returns table (
  exposure_id uuid,
  owner_reserved_exposure_minor bigint,
  campaign_reserved_exposure_minor bigint,
  account_reserved_exposure_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.automation_policies%rowtype;
  v_exposure public.daily_budget_exposures%rowtype;
  v_campaign_cap bigint;
  v_campaign_total bigint;
  v_account_total bigint;
begin
  select * into v_policy
  from public.automation_policies ap
  where ap.id = p_policy_id
    and ap.user_id = p_user_id
    and ap.platform_account_id = p_platform_account_id
    and ap.is_current
    and ap.status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active current automation policy is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_platform_account_id::text || ':' || p_account_day::text,
      0
    )
  );

  if p_currency <> v_policy.currency or p_currency <> 'EUR' then
    raise exception 'Exposure currency does not match active EUR policy';
  end if;

  if p_flex_spend_multiplier_bps > 50000
    or (
      not p_shared_budget_enabled
      and p_flex_spend_multiplier_bps < v_policy.standard_flex_spend_multiplier_bps
    )
    or (
      p_shared_budget_enabled
      and p_flex_spend_multiplier_bps < v_policy.shared_budget_flex_spend_multiplier_bps
    ) then
    raise exception 'Exposure multiplier is below policy safety minimum';
  end if;

  if p_budget_owner_type not in ('CAMPAIGN', 'AD_SET')
    or p_source not in ('SNAPSHOT', 'PLAN', 'RECONCILIATION') then
    raise exception 'Invalid budget exposure classification';
  end if;

  if not exists (
    select 1
    from public.daily_budget_exposure_snapshots s
    where s.id = p_snapshot_id
      and s.user_id = p_user_id
      and s.platform_account_id = p_platform_account_id
      and s.policy_id = p_policy_id
      and s.account_day = p_account_day
      and s.currency = p_currency
      and s.status = 'COMPLETE'
  ) then
    raise exception 'Complete matching daily exposure snapshot is required';
  end if;

  perform 1
  from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = p_account_day
  for update;

  insert into public.daily_budget_exposures (
    user_id, platform_account_id, policy_id, snapshot_id, plan_id,
    automation_target_id, account_day, campaign_scope_key, budget_owner_key,
    budget_owner_type, shared_budget_enabled, currency, max_daily_budget_minor,
    flex_spend_multiplier_bps, source, last_observed_at, updated_at
  ) values (
    p_user_id, p_platform_account_id, p_policy_id, p_snapshot_id, p_plan_id,
    p_automation_target_id, p_account_day, p_campaign_scope_key,
    p_budget_owner_key, p_budget_owner_type, p_shared_budget_enabled, p_currency,
    p_daily_budget_minor, p_flex_spend_multiplier_bps, p_source, now(), now()
  )
  on conflict (platform_account_id, account_day, budget_owner_key)
  do update set
    plan_id = coalesce(excluded.plan_id, public.daily_budget_exposures.plan_id),
    automation_target_id = coalesce(
      excluded.automation_target_id,
      public.daily_budget_exposures.automation_target_id
    ),
    shared_budget_enabled = (
      public.daily_budget_exposures.shared_budget_enabled
      or excluded.shared_budget_enabled
    ),
    max_daily_budget_minor = greatest(
      public.daily_budget_exposures.max_daily_budget_minor,
      excluded.max_daily_budget_minor
    ),
    flex_spend_multiplier_bps = greatest(
      public.daily_budget_exposures.flex_spend_multiplier_bps,
      excluded.flex_spend_multiplier_bps
    ),
    source = excluded.source,
    last_observed_at = now(),
    updated_at = now()
  returning * into v_exposure;

  select coalesce(cbl.daily_hard_cap_minor, v_policy.default_campaign_daily_hard_cap_minor)
    into v_campaign_cap
  from (select 1) seed
  left join public.campaign_budget_limits cbl
    on cbl.policy_id = p_policy_id
   and cbl.user_id = p_user_id
   and cbl.platform_account_id = p_platform_account_id
   and cbl.campaign_scope_key = p_campaign_scope_key;

  select coalesce(sum(dbe.reserved_exposure_minor), 0)
    into v_campaign_total
  from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = p_account_day
    and dbe.campaign_scope_key = p_campaign_scope_key;

  select coalesce(sum(dbe.reserved_exposure_minor), 0)
    into v_account_total
  from public.daily_budget_exposures dbe
  where dbe.platform_account_id = p_platform_account_id
    and dbe.account_day = p_account_day;

  if v_campaign_total > v_campaign_cap then
    raise exception 'Campaign daily hard cap would be exceeded';
  end if;

  if v_account_total > v_policy.account_daily_hard_cap_minor then
    raise exception 'Account daily hard cap would be exceeded';
  end if;

  return query select
    v_exposure.id,
    v_exposure.reserved_exposure_minor,
    v_campaign_total,
    v_account_total;
end;
$$;

-- RLS and grants: authenticated users have own-row read-only access. All writes
-- remain server-side; sensitive leases are never exposed to browser roles.
alter table public.automation_policies enable row level security;
alter table public.allowed_domains enable row level security;
alter table public.objective_blueprints enable row level security;
alter table public.brand_assets enable row level security;
alter table public.automation_targets enable row level security;
alter table public.campaign_budget_limits enable row level security;
alter table public.daily_budget_exposure_snapshots enable row level security;
alter table public.daily_budget_exposures enable row level security;
alter table public.budget_mutation_ledger enable row level security;
alter table public.mutation_plans enable row level security;
alter table public.mutation_plan_steps enable row level security;
alter table public.mutation_executions enable row level security;
alter table public.remote_object_bindings enable row level security;
alter table public.mutation_audit_events enable row level security;
alter table public.kill_switch_state enable row level security;
alter table public.automation_alerts enable row level security;
alter table public.meta_account_operation_leases enable row level security;

revoke all on table public.automation_policies from public, anon, authenticated;
revoke all on table public.allowed_domains from public, anon, authenticated;
revoke all on table public.objective_blueprints from public, anon, authenticated;
revoke all on table public.brand_assets from public, anon, authenticated;
revoke all on table public.automation_targets from public, anon, authenticated;
revoke all on table public.campaign_budget_limits from public, anon, authenticated;
revoke all on table public.daily_budget_exposure_snapshots from public, anon, authenticated;
revoke all on table public.daily_budget_exposures from public, anon, authenticated;
revoke all on table public.budget_mutation_ledger from public, anon, authenticated;
revoke all on table public.mutation_plans from public, anon, authenticated;
revoke all on table public.mutation_plan_steps from public, anon, authenticated;
revoke all on table public.mutation_executions from public, anon, authenticated;
revoke all on table public.remote_object_bindings from public, anon, authenticated;
revoke all on table public.mutation_audit_events from public, anon, authenticated;
revoke all on table public.kill_switch_state from public, anon, authenticated;
revoke all on table public.automation_alerts from public, anon, authenticated;
revoke all on table public.meta_account_operation_leases from public, anon, authenticated;

-- Service role can read control state; writes use security-definer RPCs.
grant select on table public.automation_policies to service_role;
grant select on table public.allowed_domains to service_role;
grant select on table public.objective_blueprints to service_role;
grant select on table public.brand_assets to service_role;
grant select on table public.automation_targets to service_role;
grant select on table public.campaign_budget_limits to service_role;
grant select on table public.daily_budget_exposure_snapshots to service_role;
grant select on table public.daily_budget_exposures to service_role;
grant select on table public.budget_mutation_ledger to service_role;
grant select on table public.mutation_plans to service_role;
grant select on table public.mutation_plan_steps to service_role;
grant select on table public.mutation_executions to service_role;
grant select on table public.remote_object_bindings to service_role;
grant select on table public.mutation_audit_events to service_role;
grant select on table public.kill_switch_state to service_role;
grant select on table public.automation_alerts to service_role;
grant select on table public.meta_account_operation_leases to service_role;

-- Browser-safe own-row columns.
grant select (
  id, user_id, platform_account_id, previous_policy_id, version, status,
  currency, account_daily_hard_cap_minor, default_campaign_daily_hard_cap_minor,
  budget_change_limit_bps, cooldown_seconds,
  standard_flex_spend_multiplier_bps, shared_budget_flex_spend_multiplier_bps,
  allow_budget_changes, allow_status_changes, allow_new_launches,
  require_verified_domain, is_current, customer_confirmed_at,
  customer_confirmed_by, activated_at, suspended_at, suspension_reason,
  created_at, updated_at
) on public.automation_policies to authenticated;

grant select (
  id, user_id, platform_account_id, hostname, registrable_domain,
  expected_redirect_hostname, observed_redirect_hostname, status,
  verification_method, customer_confirmed_at, customer_confirmed_by,
  verified_at, revoked_at, created_at, updated_at
) on public.allowed_domains to authenticated;

grant select (
  id, user_id, platform_account_id, objective, version, name, status,
  required_inputs, customer_confirmed_at, customer_confirmed_by,
  activated_at, retired_at, created_at, updated_at
) on public.objective_blueprints to authenticated;

grant select (
  id, user_id, platform_account_id, source_type, provider_key,
  provider_model, provider_version, source_meta_asset_id, original_filename,
  sha256, mime_type, byte_size, width, height, duration_ms,
  brand_policy_version, moderation_status, status, meta_image_hash,
  reviewed_at, reviewed_by, created_at, updated_at
) on public.brand_assets to authenticated;

grant select on table public.automation_targets to authenticated;
grant select on table public.campaign_budget_limits to authenticated;
grant select on table public.daily_budget_exposure_snapshots to authenticated;
grant select on table public.daily_budget_exposures to authenticated;
grant select on table public.budget_mutation_ledger to authenticated;
grant select (
  id, user_id, platform_account_id, policy_id, source_marketing_sync_id,
  source_recommendation_id, source_rule_key, source_rule_version, action_type,
  target_type, target_key, campaign_scope_key, budget_owner_key,
  automation_target_id, status, priority, safety_action, not_before,
  attempt_count, max_attempts, blocked_reason, error_class, terminal_at,
  created_at, updated_at
) on public.mutation_plans to authenticated;
grant select (
  id, plan_id, user_id, platform_account_id, step_index, step_key,
  operation, object_type, depends_on_step_id, status, attempt_count,
  not_before, validated_at, started_at, completed_at, error_class,
  error_code, created_at, updated_at
) on public.mutation_plan_steps to authenticated;
grant select (
  id, plan_id, user_id, platform_account_id, attempt_number, worker_id,
  status, started_at, last_heartbeat_at, finished_at, error_class,
  error_code, error_message, created_at
) on public.mutation_executions to authenticated;
grant select on table public.remote_object_bindings to authenticated;
grant select (
  event_sequence, id, user_id, platform_account_id, policy_id, plan_id,
  step_id, execution_id, actor_type, actor_id, event_type, before_state,
  request_payload, response_payload, after_state, metadata, provider_key,
  provider_model, provider_version, remote_request_id, error_class,
  previous_event_hash, event_hash, occurred_at, created_at
) on public.mutation_audit_events to authenticated;
grant select (
  sequence, id, scope_type, user_id, platform_account_id, plan_id, mode,
  reason, actor_type, actor_id, created_at
) on public.kill_switch_state to authenticated;
grant select on table public.automation_alerts to authenticated;

create policy automation_policies_select_own on public.automation_policies
  for select to authenticated using ((select auth.uid()) = user_id);
create policy allowed_domains_select_own on public.allowed_domains
  for select to authenticated using ((select auth.uid()) = user_id);
create policy objective_blueprints_select_own on public.objective_blueprints
  for select to authenticated using ((select auth.uid()) = user_id);
create policy brand_assets_select_own on public.brand_assets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy automation_targets_select_own on public.automation_targets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy campaign_budget_limits_select_own on public.campaign_budget_limits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_exposure_snapshots_select_own
  on public.daily_budget_exposure_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_budget_exposures_select_own on public.daily_budget_exposures
  for select to authenticated using ((select auth.uid()) = user_id);
create policy budget_mutation_ledger_select_own on public.budget_mutation_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
create policy mutation_plans_select_own on public.mutation_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy mutation_plan_steps_select_own on public.mutation_plan_steps
  for select to authenticated using ((select auth.uid()) = user_id);
create policy mutation_executions_select_own on public.mutation_executions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy remote_object_bindings_select_own on public.remote_object_bindings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy mutation_audit_events_select_own on public.mutation_audit_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy kill_switch_state_select_own on public.kill_switch_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy automation_alerts_select_own on public.automation_alerts
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on function public.meta_sha256(text) from public, anon, authenticated;
revoke all on function public.meta_calculate_exposure_minor(bigint, integer)
  from public, anon, authenticated;
revoke all on function public.claim_meta_account_operation(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_meta_account_operation(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_meta_account_operation(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.append_meta_mutation_audit_event(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.append_meta_kill_switch_state(
  text, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.get_effective_meta_kill_switch(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_meta_daily_budget_exposure(
  uuid, uuid, uuid, uuid, uuid, uuid, date, text, text, text,
  boolean, text, bigint, integer, text
) from public, anon, authenticated;

-- Trigger helpers are never remotely executable.
revoke all on function public.guard_meta_control_tenant_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_meta_mutation_plan_update()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_meta_mutation_step_update()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_meta_append_only()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_meta_exposure_non_decreasing()
  from public, anon, authenticated, service_role;

grant execute on function public.meta_sha256(text) to service_role;
grant execute on function public.meta_calculate_exposure_minor(bigint, integer)
  to service_role;
grant execute on function public.claim_meta_account_operation(uuid, uuid, text, text, integer)
  to service_role;
grant execute on function public.heartbeat_meta_account_operation(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.release_meta_account_operation(uuid, uuid, uuid)
  to service_role;
grant execute on function public.append_meta_mutation_audit_event(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.append_meta_kill_switch_state(
  text, uuid, uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.get_effective_meta_kill_switch(uuid, uuid, uuid)
  to service_role;
grant execute on function public.reserve_meta_daily_budget_exposure(
  uuid, uuid, uuid, uuid, uuid, uuid, date, text, text, text,
  boolean, text, bigint, integer, text
) to service_role;

comment on table public.automation_policies is
  'Versioned customer governance. ACTIVE requires confirmed EUR account and campaign hard caps.';
comment on table public.daily_budget_exposures is
  'Monotonic per-account-day maximum budget exposure including Meta flex-spend safety multiplier.';
comment on table public.budget_mutation_ledger is
  'Append-only reconciled budget movements used for rolling 24-hour cumulative-change enforcement.';
comment on table public.mutation_plans is
  'Immutable idempotent desired Meta mutations; only lease and execution state may change.';
comment on table public.mutation_audit_events is
  'Append-only SHA-256 chained, secret-sanitized mutation audit stream.';
comment on table public.kill_switch_state is
  'Append-only system, account and plan kill-switch state events. Latest state per scope is effective.';
comment on table public.meta_account_operation_leases is
  'Shared account lease preventing read-sync and Meta write execution from overlapping.';

commit;
