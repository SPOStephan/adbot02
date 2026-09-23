-- Adbot motif library (PLATFORM): admin-curated images Adbot may use 1:1
-- or as inspiration for every customer. Distinct from INSPIRATION vault
-- (never launch / never copy 1:1).
-- CUSTOMER library stays per-tenant. Launch still requires CUSTOMER clones.
-- Does NOT redefine organic boost, kill-switch, or launch materialize.

begin;

alter table public.brand_assets
  drop constraint if exists brand_assets_library_scope_check;

alter table public.brand_assets
  add constraint brand_assets_library_scope_check
  check (library_scope in ('CUSTOMER', 'INSPIRATION', 'PLATFORM'));

alter table public.brand_assets
  drop constraint if exists brand_assets_scope_identity_check;

alter table public.brand_assets
  add constraint brand_assets_scope_identity_check
  check (
    (
      library_scope = 'CUSTOMER'
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
    or (
      library_scope = 'PLATFORM'
      and platform_account_id is null
      and brand_profile_id is null
      and source_type = 'UPLOADED'
      and source_meta_asset_id is null
      and generation_job_id is null
      and meta_image_hash is null
    )
  );

create unique index if not exists brand_assets_platform_sha256_uidx
  on public.brand_assets (sha256)
  where library_scope = 'PLATFORM';

comment on column public.brand_assets.library_scope is
  'CUSTOMER = tenant Media Library (launchable). INSPIRATION = admin vault, never 1:1. PLATFORM = admin motif library, Adbot may clone 1:1 or use as inspiration.';

-- PLATFORM rows are reusable motifs, not style-only vault rows.
alter table public.brand_assets
  drop constraint if exists brand_assets_platform_role_check;

alter table public.brand_assets
  add constraint brand_assets_platform_role_check
  check (
    library_scope <> 'PLATFORM'
    or asset_role = 'UPLOAD_EDITABLE'
  );

create or replace function public.register_platform_library_asset(
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
  v_existing uuid;
  v_bucket text := nullif(btrim(coalesce(p_storage_bucket, '')), '');
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_file_name text := btrim(coalesce(p_original_filename, ''));
  v_sha256 text := lower(btrim(coalesce(p_sha256, '')));
  v_mime_type text := lower(btrim(coalesce(p_mime_type, '')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_uploader_user_id is null
    or not exists (
      select 1 from public.site_admins admin
      where admin.user_id = p_uploader_user_id
    ) then
    raise exception 'Platform library upload requires a site admin';
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
    or char_length(v_file_name) not between 1 and 160
    or v_bucket is null
    or char_length(v_bucket) > 63
    or v_path is null
    or char_length(v_path) > 1024
    or v_path not like 'platform/%'
    or v_path like '%..%'
  then
    raise exception 'Platform library asset metadata is invalid';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Platform library asset metadata is invalid or unsafe';
  end if;

  select asset.id
    into v_existing
  from public.brand_assets asset
  where asset.library_scope = 'PLATFORM'
    and asset.sha256 = v_sha256
    and asset.status is distinct from 'REVOKED'
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.brand_assets (
    id, user_id, platform_account_id, brand_profile_id, source_type,
    library_scope, asset_role, storage_bucket, storage_path, original_filename,
    sha256, mime_type, byte_size, width, height,
    moderation_status, status, metadata, reviewed_at, reviewed_by,
    created_at, updated_at
  ) values (
    v_asset_id, p_uploader_user_id, null, null, 'UPLOADED',
    'PLATFORM', 'UPLOAD_EDITABLE', v_bucket, v_path, v_file_name, v_sha256,
    v_mime_type, p_byte_size, p_width, p_height,
    'APPROVED', 'READY', v_metadata, now(), p_uploader_user_id, now(), now()
  );

  return v_asset_id;
end;
$$;

revoke all on function public.register_platform_library_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.register_platform_library_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) to service_role;

comment on function public.register_platform_library_asset(
  uuid, text, text, text, text, text, bigint, integer, integer, jsonb
) is
  'Admin-only PLATFORM motif. Customers never see this row. Launch uses a CUSTOMER clone.';

create or replace function public.update_platform_library_asset_metadata(
  p_admin_user_id uuid,
  p_asset_id uuid,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_admin_user_id is null
    or p_asset_id is null
    or not exists (
      select 1 from public.site_admins admin
      where admin.user_id = p_admin_user_id
    ) then
    raise exception 'Platform library update requires a site admin';
  end if;

  if jsonb_typeof(v_metadata) <> 'object'
    or pg_catalog.octet_length(v_metadata::text) > 32768
    or public.meta_jsonb_has_sensitive_key(v_metadata) then
    raise exception 'Platform library metadata is invalid or unsafe';
  end if;

  update public.brand_assets asset
  set metadata = v_metadata,
      updated_at = now()
  where asset.id = p_asset_id
    and asset.library_scope = 'PLATFORM'
    and asset.status is distinct from 'REVOKED';

  if not found then
    raise exception 'Platform library asset was not found';
  end if;

  return p_asset_id;
end;
$$;

revoke all on function public.update_platform_library_asset_metadata(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_platform_library_asset_metadata(uuid, uuid, jsonb)
  to service_role;

create or replace function public.creative_generation_style_references_allowed(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_reference_asset_ids jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
  v_ok integer;
begin
  if jsonb_typeof(p_reference_asset_ids) is distinct from 'array' then
    return false;
  end if;

  if jsonb_array_length(p_reference_asset_ids) = 0 then
    return true;
  end if;

  if jsonb_array_length(p_reference_asset_ids) > 4 then
    return false;
  end if;

  begin
    select array_agg(distinct (value #>> '{}')::uuid)
      into v_ids
    from jsonb_array_elements(p_reference_asset_ids) as t(value);
  exception
    when others then
      return false;
  end;

  if v_ids is null
    or cardinality(v_ids) is distinct from jsonb_array_length(p_reference_asset_ids) then
    return false;
  end if;

  v_count := cardinality(v_ids);

  select count(*)::integer into v_ok
  from public.brand_assets ba
  where ba.id = any (v_ids)
    and ba.status = 'READY'
    and ba.moderation_status = 'APPROVED'
    and (
      (
        ba.library_scope = 'CUSTOMER'
        and ba.user_id = p_user_id
        and ba.platform_account_id = p_platform_account_id
        and (
          ba.training_status in ('marked_good', 'performance_winner')
          or ba.asset_role = 'STYLE_REFERENCE'
        )
      )
      or (
        ba.library_scope = 'INSPIRATION'
        and ba.asset_role = 'STYLE_REFERENCE'
      )
      or (
        ba.library_scope = 'PLATFORM'
        and ba.asset_role = 'UPLOAD_EDITABLE'
      )
    );

  return v_ok = v_count;
end;
$$;

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

  -- Nested IF: PL/pgSQL evaluates AND operands even when tg_table_name differs,
  -- so new.library_scope must not be referenced on mutation_plans etc.
  if tg_table_name = 'brand_assets' then
    if coalesce(new.library_scope, 'CUSTOMER') in ('INSPIRATION', 'PLATFORM') then
      if new.user_id is null then
        raise exception 'Platform or inspiration asset requires an uploader user_id';
      end if;
      if new.platform_account_id is not null
        or new.brand_profile_id is not null
        or new.source_type <> 'UPLOADED'
        or new.meta_image_hash is not null then
        raise exception 'Platform or inspiration asset identity is invalid';
      end if;
      if new.reviewed_by is not null and new.reviewed_by <> new.user_id then
        raise exception 'Brand asset reviewer must be the owning customer';
      end if;
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



create or replace function public.guard_creative_asset_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nested IF so brand_profiles / creative_asset_jobs never touch library_scope.
  if tg_table_name = 'brand_assets' then
    if coalesce(new.library_scope, 'CUSTOMER') in ('INSPIRATION', 'PLATFORM') then
      if new.platform_account_id is not null
        or new.brand_profile_id is not null
        or new.generation_job_id is not null then
        raise exception 'Platform or inspiration asset must not bind Meta tenant scope';
      end if;
      return new;
    end if;
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

commit;
