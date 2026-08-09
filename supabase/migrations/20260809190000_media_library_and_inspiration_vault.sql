-- Media Library (customer uploads) + Inspiration Vault (platform-internal).
-- Reuses brand_assets. Inspiration assets are never launchable to Meta.

alter table public.brand_assets
  add column if not exists library_scope text not null default 'CUSTOMER';

alter table public.brand_assets
  drop constraint if exists brand_assets_library_scope_check;

alter table public.brand_assets
  add constraint brand_assets_library_scope_check
  check (library_scope in ('CUSTOMER', 'INSPIRATION'));

-- Existing rows are customer library by default.
update public.brand_assets
set library_scope = 'CUSTOMER'
where library_scope is distinct from 'CUSTOMER'
  and library_scope is distinct from 'INSPIRATION';

-- Inspiration may omit tenant Meta account / brand profile.
alter table public.brand_assets
  alter column platform_account_id drop not null;

alter table public.brand_assets
  drop constraint if exists brand_assets_scope_identity_check;

alter table public.brand_assets
  add constraint brand_assets_scope_identity_check
  check (
    (
      library_scope = 'CUSTOMER'
      and platform_account_id is not null
    )
    or (
      library_scope = 'INSPIRATION'
      and platform_account_id is null
      and brand_profile_id is null
      and source_type = 'UPLOADED'
      and source_meta_asset_id is null
      and generation_job_id is null
      and meta_image_hash is null
    )
  );

alter table public.brand_assets
  drop constraint if exists brand_assets_account_sha256_key;

create unique index if not exists brand_assets_customer_account_sha256_uidx
  on public.brand_assets (platform_account_id, sha256)
  where library_scope = 'CUSTOMER' and platform_account_id is not null;

create unique index if not exists brand_assets_inspiration_sha256_uidx
  on public.brand_assets (sha256)
  where library_scope = 'INSPIRATION';

create index if not exists brand_assets_library_scope_idx
  on public.brand_assets (library_scope, created_at desc);

comment on column public.brand_assets.library_scope is
  'CUSTOMER = customer Media Library (launchable). INSPIRATION = platform vault (hidden, never Meta launch).';

-- Customers never see inspiration rows, even if user_id somehow matched.
drop policy if exists brand_assets_select_own on public.brand_assets;
create policy brand_assets_select_own on public.brand_assets
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and library_scope = 'CUSTOMER'
  );

grant select (
  id,
  user_id,
  platform_account_id,
  original_filename,
  source_meta_asset_id,
  source_type,
  library_scope,
  width,
  height,
  meta_image_hash,
  status,
  moderation_status,
  mime_type,
  byte_size,
  created_at,
  updated_at
) on table public.brand_assets to authenticated;

-- Patch tenant-scope guard: allow INSPIRATION without platform_account.
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

  if tg_table_name = 'brand_assets'
    and coalesce(new.library_scope, 'CUSTOMER') = 'INSPIRATION' then
    if new.user_id is null then
      raise exception 'Inspiration vault asset requires an uploader user_id';
    end if;
    if new.platform_account_id is not null
      or new.brand_profile_id is not null
      or new.source_type <> 'UPLOADED'
      or new.meta_image_hash is not null then
      raise exception 'Inspiration vault asset identity is invalid';
    end if;
    if new.reviewed_by is not null and new.reviewed_by <> new.user_id then
      raise exception 'Brand asset reviewer must be the owning customer';
    end if;
    return new;
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
    if coalesce(new.library_scope, 'CUSTOMER') <> 'CUSTOMER' then
      raise exception 'Unexpected brand asset library scope in tenant guard';
    end if;
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

-- Creative-asset tenant guard also requires platform_account; skip for vault.
create or replace function public.guard_creative_asset_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'brand_assets'
    and coalesce(new.library_scope, 'CUSTOMER') = 'INSPIRATION' then
    if new.platform_account_id is not null
      or new.brand_profile_id is not null
      or new.generation_job_id is not null then
      raise exception 'Inspiration vault asset must not bind Meta tenant scope';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = new.platform_account_id
      and pa.user_id = new.user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Creative asset account scope is invalid';
  end if;

  if tg_table_name = 'brand_profiles' then
    if new.previous_profile_id is not null and not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.previous_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Previous brand profile scope is invalid';
    end if;

    if new.customer_confirmed_by is not null
      and new.customer_confirmed_by <> new.user_id then
      raise exception 'Brand profile confirmer must be the owning customer';
    end if;
  elsif tg_table_name = 'creative_asset_jobs' then
    if not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.brand_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Creative asset job profile scope is invalid';
    end if;

    if new.result_asset_id is not null and not exists (
      select 1 from public.brand_assets ba
      where ba.id = new.result_asset_id
        and ba.user_id = new.user_id
        and ba.platform_account_id = new.platform_account_id
    ) then
      raise exception 'Creative asset job result scope is invalid';
    end if;
  elsif tg_table_name = 'brand_assets' then
    if new.brand_profile_id is not null and not exists (
      select 1 from public.brand_profiles bp
      where bp.id = new.brand_profile_id
        and bp.user_id = new.user_id
        and bp.platform_account_id = new.platform_account_id
        and bp.version = new.brand_policy_version
    ) then
      raise exception 'Brand asset profile scope is invalid';
    end if;

    if new.generation_job_id is not null and not exists (
      select 1 from public.creative_asset_jobs caj
      where caj.id = new.generation_job_id
        and caj.user_id = new.user_id
        and caj.platform_account_id = new.platform_account_id
        and caj.brand_profile_id = new.brand_profile_id
    ) then
      raise exception 'Brand asset generation job scope is invalid';
    end if;
  end if;

  return new;
end;
$$;

-- Hard stop: inspiration assets must never enter launch plans or upload-image steps.
create or replace function public.guard_brand_asset_not_inspiration_for_launch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids uuid[] := array[]::uuid[];
  v_asset_id uuid;
  v_payload jsonb;
begin
  if tg_table_name = 'mutation_plans'
    and new.action_type = 'LAUNCH_CHAIN' then
    if jsonb_typeof(new.planned_payload->'brand_asset_ids') = 'array' then
      select coalesce(array_agg(value::uuid), array[]::uuid[])
      into v_asset_ids
      from jsonb_array_elements_text(new.planned_payload->'brand_asset_ids') as t(value)
      where value ~* '^[0-9a-f-]{36}$';
    end if;

    if exists (
      select 1
      from public.brand_assets asset
      where asset.id = any (v_asset_ids)
        and asset.library_scope <> 'CUSTOMER'
    ) then
      raise exception 'Inspiration vault assets cannot be used in Meta launch plans';
    end if;
  end if;

  if tg_table_name = 'mutation_plan_steps' then
    v_payload := coalesce(new.planned_request, '{}'::jsonb);
    if coalesce(v_payload->>'operation', '') = 'UPLOAD_IMAGE'
      or coalesce(new.object_type, '') = 'IMAGE' then
      begin
        v_asset_id := nullif(v_payload->>'brand_asset_id', '')::uuid;
      exception when others then
        v_asset_id := null;
      end;
      if v_asset_id is not null and exists (
        select 1
        from public.brand_assets asset
        where asset.id = v_asset_id
          and asset.library_scope <> 'CUSTOMER'
      ) then
        raise exception 'Inspiration vault assets cannot be used in Meta mutation steps';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_mutation_plans_no_inspiration_launch on public.mutation_plans;
create trigger guard_mutation_plans_no_inspiration_launch
  before insert or update on public.mutation_plans
  for each row execute function public.guard_brand_asset_not_inspiration_for_launch();

drop trigger if exists guard_mutation_steps_no_inspiration_launch on public.mutation_plan_steps;
create trigger guard_mutation_steps_no_inspiration_launch
  before insert or update on public.mutation_plan_steps
  for each row execute function public.guard_brand_asset_not_inspiration_for_launch();

-- Customer Media Library upload → READY brand asset (launchable).
create or replace function public.register_uploaded_brand_asset(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brand_profile_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid := gen_random_uuid();
  v_existing public.brand_assets%rowtype;
  v_profile public.brand_profiles%rowtype;
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := p_user_id::text || '/' || p_platform_account_id::text || '/';
begin
  if p_user_id is null
    or p_platform_account_id is null
    or p_brand_profile_id is null then
    raise exception 'Uploaded brand asset identity is incomplete';
  end if;

  if v_sha256 !~ '^[0-9a-f]{64}$'
    or v_mime_type not in ('image/png', 'image/jpeg')
    or p_byte_size is null
    or p_byte_size <= 0
    or p_byte_size > 10485760
    or p_width is null
    or p_width not between 256 and 4096
    or p_height is null
    or p_height not between 256 and 4096
    or char_length(v_file_name) not between 1 and 255
    or v_bucket is null
    or char_length(v_bucket) > 63
    or v_path is null
    or char_length(v_path) > 1024
    or v_path not like v_expected_prefix || '%'
    or v_path like '%..%' then
    raise exception 'Uploaded brand asset metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Uploaded brand asset metadata is invalid or unsafe';
  end if;

  perform 1
  from public.platform_accounts pa
  where pa.id = p_platform_account_id
    and pa.user_id = p_user_id
    and pa.platform = 'meta'
    and pa.revoked_at is null;

  if not found then
    raise exception 'Meta platform account is required for Media Library upload';
  end if;

  select profile.*
  into v_profile
  from public.brand_profiles profile
  where profile.id = p_brand_profile_id
    and profile.user_id = p_user_id
    and profile.platform_account_id = p_platform_account_id
    and profile.status = 'ACTIVE'
    and profile.customer_confirmed_at is not null
    and profile.activated_at is not null;

  if not found then
    raise exception 'Active confirmed brand profile is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'upload-brand-asset:' || p_platform_account_id::text || ':' || v_sha256,
      0
    )
  );

  select asset.*
  into v_existing
  from public.brand_assets asset
  where asset.library_scope = 'CUSTOMER'
    and asset.platform_account_id = p_platform_account_id
    and asset.sha256 = v_sha256
  for update;

  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.library_scope <> 'CUSTOMER'
      or v_existing.status = 'REVOKED' then
      raise exception 'Brand asset hash conflicts with another asset identity';
    end if;
    return v_existing.id;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height, brand_policy_version,
    moderation_status, status, metadata, reviewed_at, reviewed_by,
    created_at, updated_at
  ) values (
    v_asset_id, p_user_id, p_platform_account_id, p_brand_profile_id,
    'UPLOADED', 'CUSTOMER', v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height, v_profile.version,
    'APPROVED', 'READY', v_metadata, now(), p_user_id, now(), now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_uploaded_brand_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.register_uploaded_brand_asset(
  uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) to service_role;

-- Platform Inspiration Vault upload (never launchable).
create or replace function public.register_inspiration_vault_asset(
  p_uploader_user_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_filename text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid := gen_random_uuid();
  v_existing public.brand_assets%rowtype;
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_expected_prefix text := 'inspiration/' || p_uploader_user_id::text || '/';
begin
  if p_uploader_user_id is null then
    raise exception 'Inspiration vault uploader is required';
  end if;

  if not exists (
    select 1 from public.site_admins sa where sa.user_id = p_uploader_user_id
  ) then
    raise exception 'Only site admins may write to the inspiration vault';
  end if;

  if v_sha256 !~ '^[0-9a-f]{64}$'
    or v_mime_type not in ('image/png', 'image/jpeg')
    or p_byte_size is null
    or p_byte_size <= 0
    or p_byte_size > 10485760
    or p_width is null
    or p_width not between 256 and 4096
    or p_height is null
    or p_height not between 256 and 4096
    or char_length(v_file_name) not between 1 and 255
    or v_bucket is null
    or char_length(v_bucket) > 63
    or v_path is null
    or char_length(v_path) > 1024
    or v_path not like v_expected_prefix || '%'
    or v_path like '%..%' then
    raise exception 'Inspiration vault asset metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Inspiration vault metadata is invalid or unsafe';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('inspiration-vault:' || v_sha256, 0)
  );

  select asset.*
  into v_existing
  from public.brand_assets asset
  where asset.library_scope = 'INSPIRATION'
    and asset.sha256 = v_sha256
  for update;

  if found then
    return v_existing.id;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height, brand_policy_version,
    moderation_status, status, metadata, reviewed_at, reviewed_by,
    created_at, updated_at
  ) values (
    v_asset_id, p_uploader_user_id, null, null,
    'UPLOADED', 'INSPIRATION', v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height, 1,
    'APPROVED', 'READY', v_metadata, now(), p_uploader_user_id, now(), now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_inspiration_vault_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.register_inspiration_vault_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) to service_role;
