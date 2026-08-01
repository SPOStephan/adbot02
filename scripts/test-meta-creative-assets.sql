\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'creative-owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'creative-other@example.test');

insert into public.platform_accounts (
  id, user_id, platform, platform_account_id, account_name, access_token,
  meta_scopes, ad_account_ids, marketing_meta_ad_account_id, marketing_currency,
  marketing_timezone_name, marketing_sync_status, marketing_sync_id,
  marketing_last_success_at
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'meta', 'creative-owner-meta', 'Creative Owner Meta', null,
    array['ads_read','ads_management']::text[],
    '["act_111"]'::jsonb, '111', 'EUR', 'Europe/Berlin', 'success',
    '30000000-0000-4000-8000-000000000001', now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'meta', 'creative-other-meta', 'Creative Other Meta', null,
    array['ads_read','ads_management']::text[],
    '["act_222"]'::jsonb, '222', 'EUR', 'Europe/Berlin', 'success',
    '30000000-0000-4000-8000-000000000002', now()
  );

insert into public.automation_policies (
  id, user_id, platform_account_id, version, status, currency,
  account_daily_hard_cap_minor, default_campaign_daily_hard_cap_minor,
  budget_change_limit_bps, cooldown_seconds,
  standard_flex_spend_multiplier_bps,
  shared_budget_flex_spend_multiplier_bps,
  allow_budget_changes, allow_status_changes, allow_new_launches,
  require_verified_domain, policy_payload, policy_hash, is_current,
  customer_confirmed_at, customer_confirmed_by, activated_at
) values
  (
    '80000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    1, 'ACTIVE', 'EUR', 10000, 5000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL","brand_assets":"AUTONOMOUS"}'::jsonb,
    repeat('a', 64), true, now(),
    '10000000-0000-4000-8000-000000000001', now()
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    1, 'ACTIVE', 'EUR', 8000, 4000, 2000, 43200, 17500, 21000,
    true, true, true, true,
    '{"campaign_objectives":"ALL","regions":"ALL","brand_assets":"CUSTOMER_REVIEW"}'::jsonb,
    repeat('b', 64), true, now(),
    '10000000-0000-4000-8000-000000000002', now()
  );

create temporary table creative_test_ids (
  key text primary key,
  id uuid not null
) on commit drop;

insert into creative_test_ids (key, id)
select 'owner_profile_v1', public.put_brand_profile_version(
  p_user_id => '10000000-0000-4000-8000-000000000001',
  p_platform_account_id => '20000000-0000-4000-8000-000000000001',
  p_display_name => 'Owner Brand v1',
  p_brand_name => 'Owner Brand',
  p_facebook_page_id => '111111111',
  p_instagram_actor_id => '222222222',
  p_guidelines => '{"colors":["#112233"],"tone":"clear"}'::jsonb,
  p_forbidden_content => '["unverified claims"]'::jsonb,
  p_generation_defaults => '{"aspect_ratio":"1:1"}'::jsonb,
  p_activate => true,
  p_generated_asset_approval_mode => 'AUTONOMOUS_POLICY'
);

insert into creative_test_ids (key, id)
select 'owner_profile_v2', public.put_brand_profile_version(
  p_user_id => '10000000-0000-4000-8000-000000000001',
  p_platform_account_id => '20000000-0000-4000-8000-000000000001',
  p_display_name => 'Owner Brand v2',
  p_brand_name => 'Owner Brand',
  p_facebook_page_id => '111111111',
  p_instagram_actor_id => '222222222',
  p_guidelines => '{"colors":["#112233","#ffffff"],"tone":"clear"}'::jsonb,
  p_forbidden_content => '["unverified claims"]'::jsonb,
  p_generation_defaults => '{"aspect_ratio":"1:1","format":"png"}'::jsonb,
  p_activate => true,
  p_generated_asset_approval_mode => 'AUTONOMOUS_POLICY'
);

insert into creative_test_ids (key, id)
select 'owner_profile_draft', public.put_brand_profile_version(
  p_user_id => '10000000-0000-4000-8000-000000000001',
  p_platform_account_id => '20000000-0000-4000-8000-000000000001',
  p_display_name => 'Owner Brand Draft',
  p_brand_name => 'Owner Brand',
  p_guidelines => '{}'::jsonb,
  p_forbidden_content => '[]'::jsonb,
  p_generation_defaults => '{}'::jsonb,
  p_activate => false,
  p_generated_asset_approval_mode => 'CUSTOMER_REVIEW'
);

insert into creative_test_ids (key, id)
select 'other_profile', public.put_brand_profile_version(
  p_user_id => '10000000-0000-4000-8000-000000000002',
  p_platform_account_id => '20000000-0000-4000-8000-000000000002',
  p_display_name => 'Other Brand',
  p_brand_name => 'Other Brand',
  p_guidelines => '{"tone":"formal"}'::jsonb,
  p_forbidden_content => '[]'::jsonb,
  p_generation_defaults => '{"format":"png"}'::jsonb,
  p_activate => true,
  p_generated_asset_approval_mode => 'CUSTOMER_REVIEW'
);

do $$
begin
  if (select status from public.brand_profiles where id = (
      select id from creative_test_ids where key = 'owner_profile_v1'
    )) <> 'RETIRED'
    or (select status from public.brand_profiles where id = (
      select id from creative_test_ids where key = 'owner_profile_v2'
    )) <> 'ACTIVE'
    or (select version from public.brand_profiles where id = (
      select id from creative_test_ids where key = 'owner_profile_v2'
    )) <> 2
    or (select generated_asset_approval_mode from public.brand_profiles where id = (
      select id from creative_test_ids where key = 'other_profile'
    )) <> 'CUSTOMER_REVIEW' then
    raise exception 'Brand profile versioning or approval mode is incorrect';
  end if;
end;
$$;

insert into public.creatives (
  id, user_id, platform_account_id, platform_creative_id, source,
  name, type, content, generated_by_ai, last_seen_sync_id, is_current
) values
  (
    '41000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '111000000001', 'meta', 'Current imported creative', 'image',
    '{"image_url":"https://scontent.xx.fbcdn.net/current.jpg"}'::jsonb,
    false, '30000000-0000-4000-8000-000000000001', true
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '111000000002', 'meta', 'Stale imported creative', 'image',
    '{"image_url":"https://scontent.xx.fbcdn.net/stale.jpg"}'::jsonb,
    false, '30000000-0000-4000-8000-000000000099', true
  );

insert into creative_test_ids (key, id)
select 'imported_meta_asset', public.import_meta_brand_asset_from_creative(
  p_user_id => '10000000-0000-4000-8000-000000000001',
  p_platform_account_id => '20000000-0000-4000-8000-000000000001',
  p_brand_profile_id => (
    select id from creative_test_ids where key = 'owner_profile_v2'
  ),
  p_source_meta_asset_id => '111000000001',
  p_source_marketing_sync_id => '30000000-0000-4000-8000-000000000001',
  p_storage_bucket => 'creative-assets',
  p_storage_path => '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/aa/'
    || public.meta_sha256('phase15-current-meta-import') || '.png',
  p_original_filename => 'meta-creative-111000000001.png',
  p_sha256 => public.meta_sha256('phase15-current-meta-import'),
  p_mime_type => 'image/png',
  p_byte_size => 2048,
  p_width => 1200,
  p_height => 1200,
  p_metadata => '{"contract_version":1,"source_kind":"IMAGE_URL"}'::jsonb
);

insert into creative_test_ids (key, id)
select 'imported_meta_asset_replay', public.import_meta_brand_asset_from_creative(
  p_user_id => '10000000-0000-4000-8000-000000000001',
  p_platform_account_id => '20000000-0000-4000-8000-000000000001',
  p_brand_profile_id => (
    select id from creative_test_ids where key = 'owner_profile_v2'
  ),
  p_source_meta_asset_id => '111000000001',
  p_source_marketing_sync_id => '30000000-0000-4000-8000-000000000001',
  p_storage_bucket => 'creative-assets',
  p_storage_path => '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/aa/'
    || public.meta_sha256('phase15-current-meta-import') || '.png',
  p_original_filename => 'meta-creative-111000000001.png',
  p_sha256 => public.meta_sha256('phase15-current-meta-import'),
  p_mime_type => 'image/png',
  p_byte_size => 2048,
  p_width => 1200,
  p_height => 1200,
  p_metadata => '{"contract_version":1,"source_kind":"IMAGE_URL"}'::jsonb
);

do $$
declare
  v_failed boolean := false;
begin
  if (select id from creative_test_ids where key = 'imported_meta_asset')
      <> (select id from creative_test_ids where key = 'imported_meta_asset_replay')
    or (select count(*) from public.brand_assets
        where source_meta_asset_id = '111000000001') <> 1
    or (select count(*) from public.mutation_audit_events
        where event_type = 'BRAND_ASSET_IMPORTED_FROM_META') <> 1 then
    raise exception 'Current Meta Creative import was not idempotent or audited';
  end if;

  begin
    perform public.import_meta_brand_asset_from_creative(
      p_user_id => '10000000-0000-4000-8000-000000000001',
      p_platform_account_id => '20000000-0000-4000-8000-000000000001',
      p_brand_profile_id => (
        select id from creative_test_ids where key = 'owner_profile_v2'
      ),
      p_source_meta_asset_id => '111000000002',
      p_source_marketing_sync_id => '30000000-0000-4000-8000-000000000001',
      p_storage_bucket => 'creative-assets',
      p_storage_path => '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/bb/'
        || public.meta_sha256('phase15-stale-meta-import') || '.png',
      p_original_filename => 'meta-creative-111000000002.png',
      p_sha256 => public.meta_sha256('phase15-stale-meta-import'),
      p_mime_type => 'image/png',
      p_byte_size => 2048,
      p_width => 1200,
      p_height => 1200,
      p_metadata => '{"contract_version":1,"source_kind":"IMAGE_URL"}'::jsonb
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Stale Meta Creative import was accepted';
  end if;

  v_failed := false;
  begin
    perform public.import_meta_brand_asset_from_creative(
      p_user_id => '10000000-0000-4000-8000-000000000001',
      p_platform_account_id => '20000000-0000-4000-8000-000000000001',
      p_brand_profile_id => (
        select id from creative_test_ids where key = 'owner_profile_v2'
      ),
      p_source_meta_asset_id => '111000000001',
      p_source_marketing_sync_id => '30000000-0000-4000-8000-000000000099',
      p_storage_bucket => 'creative-assets',
      p_storage_path => '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/cc/'
        || public.meta_sha256('phase15-raced-meta-import') || '.png',
      p_original_filename => 'meta-creative-111000000001-raced.png',
      p_sha256 => public.meta_sha256('phase15-raced-meta-import'),
      p_mime_type => 'image/png',
      p_byte_size => 2048,
      p_width => 1200,
      p_height => 1200,
      p_metadata => '{"contract_version":1,"source_kind":"IMAGE_URL"}'::jsonb
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Creative import accepted a mismatched source sync identity';
  end if;
end;
$$;

-- Profile intent and tenant scope are immutable even for privileged callers.
do $$
declare
  v_failed boolean := false;
begin
  begin
    update public.brand_profiles
    set brand_name = 'Mutated'
    where id = (select id from creative_test_ids where key = 'owner_profile_v2');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Brand profile immutable intent was mutable';
  end if;
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.put_brand_profile_version(
      p_user_id => '10000000-0000-4000-8000-000000000001',
      p_platform_account_id => '20000000-0000-4000-8000-000000000002',
      p_display_name => 'Cross Tenant',
      p_brand_name => 'Cross Tenant',
      p_activate => true
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Cross-tenant brand profile was accepted';
  end if;
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.put_brand_profile_version(
      p_user_id => '10000000-0000-4000-8000-000000000001',
      p_platform_account_id => '20000000-0000-4000-8000-000000000001',
      p_display_name => 'Secret Profile',
      p_brand_name => 'Secret Profile',
      p_guidelines => '{"nested":{"API-Key":"forbidden"}}'::jsonb,
      p_activate => false
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Sensitive profile payload was accepted';
  end if;
end;
$$;

insert into creative_test_ids (key, id)
select 'owner_job', public.enqueue_creative_asset_job(
  p_user_id => '10000000-0000-4000-8000-000000000001',
  p_platform_account_id => '20000000-0000-4000-8000-000000000001',
  p_brand_profile_id => (
    select id from creative_test_ids where key = 'owner_profile_v2'
  ),
  p_provider_key => 'customer_http',
  p_provider_model => 'image-model-v1',
  p_provider_version => '2026-07',
  p_input_payload => '{"aspect_ratio":"1:1","prompt":"Clear product image"}'::jsonb,
  p_max_attempts => 3
);

insert into creative_test_ids (key, id)
select 'other_job', public.enqueue_creative_asset_job(
  p_user_id => '10000000-0000-4000-8000-000000000002',
  p_platform_account_id => '20000000-0000-4000-8000-000000000002',
  p_brand_profile_id => (
    select id from creative_test_ids where key = 'other_profile'
  ),
  p_provider_key => 'customer_http',
  p_provider_model => 'image-model-v1',
  p_provider_version => '2026-07',
  p_input_payload => '{"prompt":"Formal product image"}'::jsonb,
  p_max_attempts => 3
);

-- Canonical request identity is idempotent.
do $$
declare
  v_original uuid;
  v_duplicate uuid;
begin
  select id into v_original from creative_test_ids where key = 'owner_job';
  select public.enqueue_creative_asset_job(
    p_user_id => '10000000-0000-4000-8000-000000000001',
    p_platform_account_id => '20000000-0000-4000-8000-000000000001',
    p_brand_profile_id => (
      select id from creative_test_ids where key = 'owner_profile_v2'
    ),
    p_provider_key => 'customer_http',
    p_provider_model => 'image-model-v1',
    p_provider_version => '2026-07',
    p_input_payload => '{"prompt":"Clear product image","aspect_ratio":"1:1"}'::jsonb,
    p_max_attempts => 3
  ) into v_duplicate;
  if v_original <> v_duplicate
    or (select count(*) from public.creative_asset_jobs where id = v_original) <> 1 then
    raise exception 'Creative job idempotency failed';
  end if;
end;
$$;

-- Draft profiles, sensitive keys and cross-tenant references never enqueue.
do $$
declare
  v_failed boolean;
begin
  v_failed := false;
  begin
    perform public.enqueue_creative_asset_job(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      (select id from creative_test_ids where key = 'owner_profile_draft'),
      'customer_http', 'image-model-v1', null,
      '{"prompt":"draft"}'::jsonb, 3
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Draft profile job was accepted'; end if;

  v_failed := false;
  begin
    perform public.enqueue_creative_asset_job(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      (select id from creative_test_ids where key = 'owner_profile_v2'),
      'customer_http', 'image-model-v1', null,
      '{"nested":{"access-token":"forbidden"}}'::jsonb, 3
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Sensitive creative job was accepted'; end if;

  v_failed := false;
  begin
    perform public.enqueue_creative_asset_job(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      (select id from creative_test_ids where key = 'other_profile'),
      'customer_http', 'image-model-v1', null,
      '{"prompt":"cross tenant"}'::jsonb, 3
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Cross-tenant creative job was accepted'; end if;
end;
$$;

-- Browser roles can read only their tenant and never the generation input or mutating RPCs.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

do $$
declare
  v_failed boolean := false;
begin
  if (select count(*) from public.brand_profiles) <> 3
    or (select count(*) from public.creative_asset_jobs) <> 1
    or (select count(*) from public.list_current_meta_creatives_for_import(
          '20000000-0000-4000-8000-000000000001'
        )) <> 1
    or not exists (
      select 1
      from public.list_current_meta_creatives_for_import(
        '20000000-0000-4000-8000-000000000001'
      ) candidate
      where candidate.creative_id = '111000000001'
        and candidate.creative_name = 'Current imported creative'
        and candidate.has_importable_image
    ) then
    raise exception 'Owner cannot read the current importable creative contract';
  end if;

  begin
    perform input_payload from public.creative_asset_jobs limit 1;
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Authenticated role can read provider input payload';
  end if;
end;
$$;

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

do $$
begin
  if (select count(*) from public.brand_profiles) <> 1
    or (select count(*) from public.creative_asset_jobs) <> 1
    or (select count(*) from public.list_current_meta_creatives_for_import(
          '20000000-0000-4000-8000-000000000001'
        )) <> 0 then
    raise exception 'Cross-tenant creative rows are visible';
  end if;
end;
$$;

reset role;

-- Authenticated roles cannot invoke any mutating queue primitive.
do $$
begin
  if has_function_privilege(
      'authenticated',
      'public.put_brand_profile_version(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,boolean,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.enqueue_creative_asset_job(uuid,uuid,uuid,text,text,text,jsonb,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.claim_creative_asset_job(text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.mark_creative_asset_job_dispatched(uuid,uuid)',
      'EXECUTE'
    ) then
    raise exception 'Authenticated role has a creative mutation grant';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.list_current_meta_creatives_for_import(uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.list_current_meta_creatives_for_import(uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.list_current_meta_creatives_for_import(uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.import_meta_brand_asset_from_creative(uuid,uuid,uuid,text,uuid,text,text,text,text,text,bigint,integer,integer,text,jsonb)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.claim_creative_asset_job(text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.meta_jsonb_has_sensitive_key(jsonb)',
      'EXECUTE'
    ) then
    raise exception 'Creative read or service-role grants are incorrect';
  end if;
end;
$$;

-- Keep the manual-review tenant out of the first claim.
update public.creative_asset_jobs
set next_attempt_at = now() + interval '1 hour'
where id = (select id from creative_test_ids where key = 'other_job');

create temporary table creative_owner_claim on commit drop as
select * from public.claim_creative_asset_job('creative-worker-owner', 180);

do $$
declare
  v_failed boolean := false;
begin
  if (select count(*) from creative_owner_claim) <> 1
    or (select job_id from creative_owner_claim) <>
      (select id from creative_test_ids where key = 'owner_job')
    or (select dispatch_state from public.creative_asset_jobs where id =
      (select id from creative_test_ids where key = 'owner_job')) <> 'NOT_DISPATCHED' then
    raise exception 'Owner creative job was not claimed atomically';
  end if;

  begin
    perform public.complete_creative_asset_job(
      (select job_id from creative_owner_claim),
      (select lease_token from creative_owner_claim),
      'request-before-dispatch', 'asset-before-dispatch',
      'creative-assets',
      '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/cc/' || repeat('c', 64) || '.png',
      'before.png', repeat('c', 64), 'image/png', 1024, 256, 256,
      'APPROVED', '{}'::jsonb
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'Creative completion before dispatch was accepted';
  end if;
end;
$$;

select public.mark_creative_asset_job_dispatched(
  (select job_id from creative_owner_claim),
  (select lease_token from creative_owner_claim)
);

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.fail_creative_asset_job(
      (select job_id from creative_owner_claim),
      (select lease_token from creative_owner_claim),
      'PRE_DISPATCH', 'incorrect_phase', 'Incorrect phase', true, 60, null
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'Pre-dispatch failure was accepted after dispatch';
  end if;
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.complete_creative_asset_job(
      (select job_id from creative_owner_claim),
      (select lease_token from creative_owner_claim),
      'request-owner', 'asset-owner', 'creative-assets',
      '../unsafe.png', 'owner.png', repeat('c', 64), 'image/png',
      1024, 256, 256, 'APPROVED', '{}'::jsonb
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'Unsafe creative storage path was accepted';
  end if;
end;
$$;

insert into creative_test_ids (key, id)
select 'owner_asset', public.complete_creative_asset_job(
  (select job_id from creative_owner_claim),
  (select lease_token from creative_owner_claim),
  'request-owner', 'asset-owner', 'creative-assets',
  '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/cc/' || repeat('c', 64) || '.png',
  'owner.png', repeat('c', 64), 'image/png', 2048, 256, 256,
  'APPROVED', '{"provider_contract_version":"test-v1"}'::jsonb
);

do $$
begin
  if (select status from public.creative_asset_jobs where id =
      (select id from creative_test_ids where key = 'owner_job')) <> 'SUCCEEDED'
    or (select status from public.brand_assets where id =
      (select id from creative_test_ids where key = 'owner_asset')) <> 'READY'
    or (select reviewed_at from public.brand_assets where id =
      (select id from creative_test_ids where key = 'owner_asset')) is null
    or (select reviewed_by from public.brand_assets where id =
      (select id from creative_test_ids where key = 'owner_asset')) is not null then
    raise exception 'Autonomous approved creative did not become READY';
  end if;
end;
$$;

-- The manual-review profile never auto-approves even with provider moderation approval.
update public.creative_asset_jobs
set next_attempt_at = now()
where id = (select id from creative_test_ids where key = 'other_job');

create temporary table creative_other_claim on commit drop as
select * from public.claim_creative_asset_job('creative-worker-other', 180);

select public.mark_creative_asset_job_dispatched(
  (select job_id from creative_other_claim),
  (select lease_token from creative_other_claim)
);

insert into creative_test_ids (key, id)
select 'other_asset', public.complete_creative_asset_job(
  (select job_id from creative_other_claim),
  (select lease_token from creative_other_claim),
  'request-other', 'asset-other', 'creative-assets',
  '10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000002/dd/' || repeat('d', 64) || '.png',
  'other.png', repeat('d', 64), 'image/png', 2048, 256, 256,
  'APPROVED', '{}'::jsonb
);

do $$
begin
  if (select status from public.brand_assets where id =
      (select id from creative_test_ids where key = 'other_asset')) <> 'PENDING'
    or (select reviewed_at from public.brand_assets where id =
      (select id from creative_test_ids where key = 'other_asset')) is not null then
    raise exception 'Manual-review creative was auto-approved';
  end if;
end;
$$;

select public.approve_brand_asset(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  (select id from creative_test_ids where key = 'other_asset')
);

do $$
begin
  if (select status from public.brand_assets where id =
      (select id from creative_test_ids where key = 'other_asset')) <> 'READY'
    or (select reviewed_by from public.brand_assets where id =
      (select id from creative_test_ids where key = 'other_asset')) <>
      '10000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'Manual creative approval failed';
  end if;
end;
$$;

-- Safe pre-dispatch retries may run again; ambiguous transports may never auto-retry.
insert into creative_test_ids (key, id)
select 'retry_job', public.enqueue_creative_asset_job(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  (select id from creative_test_ids where key = 'owner_profile_v2'),
  'customer_http', 'image-model-v1', '2026-07',
  '{"prompt":"Retry case"}'::jsonb, 3
);

create temporary table creative_retry_claim_1 on commit drop as
select * from public.claim_creative_asset_job('creative-worker-retry-1', 180);

do $$
begin
  if public.fail_creative_asset_job(
      (select job_id from creative_retry_claim_1),
      (select lease_token from creative_retry_claim_1),
      'PRE_DISPATCH', 'provider_missing', 'Provider missing', true, 1, null
    ) <> 'RETRYABLE' then
    raise exception 'Safe pre-dispatch failure did not become RETRYABLE';
  end if;
end;
$$;

update public.creative_asset_jobs
set next_attempt_at = now()
where id = (select id from creative_test_ids where key = 'retry_job');

create temporary table creative_retry_claim_2 on commit drop as
select * from public.claim_creative_asset_job('creative-worker-retry-2', 180);

select public.mark_creative_asset_job_dispatched(
  (select job_id from creative_retry_claim_2),
  (select lease_token from creative_retry_claim_2)
);

do $$
begin
  if public.fail_creative_asset_job(
      (select job_id from creative_retry_claim_2),
      (select lease_token from creative_retry_claim_2),
      'AMBIGUOUS_TRANSPORT', 'provider_timeout',
      'Provider transport outcome is unknown', true, 1, 'request-unknown'
    ) <> 'AMBIGUOUS' then
    raise exception 'Ambiguous transport was not terminal';
  end if;
  if (select completed_at from public.creative_asset_jobs where id =
      (select id from creative_test_ids where key = 'retry_job')) is null then
    raise exception 'Ambiguous creative job is not terminal';
  end if;
end;
$$;

-- An expired pre-dispatch lease is safely reclaimed; an expired dispatched lease is terminally ambiguous.
insert into creative_test_ids (key, id)
select 'expired_safe_job', public.enqueue_creative_asset_job(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  (select id from creative_test_ids where key = 'owner_profile_v2'),
  'customer_http', 'image-model-v1', '2026-07',
  '{"prompt":"Expired before dispatch"}'::jsonb, 3
);

create temporary table creative_expired_safe_claim_1 on commit drop as
select * from public.claim_creative_asset_job('creative-worker-expired-safe-1', 30);

update public.creative_asset_jobs
set lease_expires_at = now() - interval '1 second'
where id = (select id from creative_test_ids where key = 'expired_safe_job');

create temporary table creative_expired_safe_claim_2 on commit drop as
select * from public.claim_creative_asset_job('creative-worker-expired-safe-2', 30);

do $$
begin
  if (select job_id from creative_expired_safe_claim_2) <>
      (select id from creative_test_ids where key = 'expired_safe_job')
    or (select attempt_count from creative_expired_safe_claim_2) <> 2 then
    raise exception 'Expired pre-dispatch lease was not safely reclaimed';
  end if;
end;
$$;

select public.fail_creative_asset_job(
  (select job_id from creative_expired_safe_claim_2),
  (select lease_token from creative_expired_safe_claim_2),
  'PRE_DISPATCH', 'test_cleanup', 'Test cleanup', false, 60, null
);

insert into creative_test_ids (key, id)
select 'expired_ambiguous_job', public.enqueue_creative_asset_job(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  (select id from creative_test_ids where key = 'owner_profile_v2'),
  'customer_http', 'image-model-v1', '2026-07',
  '{"prompt":"Expired after dispatch"}'::jsonb, 3
);

create temporary table creative_expired_ambiguous_claim on commit drop as
select * from public.claim_creative_asset_job('creative-worker-expired-ambiguous', 30);

select public.mark_creative_asset_job_dispatched(
  (select job_id from creative_expired_ambiguous_claim),
  (select lease_token from creative_expired_ambiguous_claim)
);

update public.creative_asset_jobs
set lease_expires_at = now() - interval '1 second'
where id = (select id from creative_test_ids where key = 'expired_ambiguous_job');

create temporary table creative_after_ambiguous_reap on commit drop as
select * from public.claim_creative_asset_job('creative-worker-reaper', 30);

do $$
begin
  if exists (select 1 from creative_after_ambiguous_reap)
    or (select status from public.creative_asset_jobs where id =
      (select id from creative_test_ids where key = 'expired_ambiguous_job')) <> 'AMBIGUOUS'
    or (select failure_mode from public.creative_asset_jobs where id =
      (select id from creative_test_ids where key = 'expired_ambiguous_job')) <> 'AMBIGUOUS_TRANSPORT' then
    raise exception 'Expired dispatched lease was not quarantined as AMBIGUOUS';
  end if;
end;
$$;

-- A pending job remains untouched while the account kill-switch blocks writes.
insert into creative_test_ids (key, id)
select 'frozen_job', public.enqueue_creative_asset_job(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  (select id from creative_test_ids where key = 'owner_profile_v2'),
  'customer_http', 'image-model-v1', '2026-07',
  '{"prompt":"Frozen account"}'::jsonb, 3
);

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  null, 'FREEZE_WRITES', 'Creative test freeze',
  'CUSTOMER', '10000000-0000-4000-8000-000000000001'
);

create temporary table creative_frozen_claim on commit drop as
select * from public.claim_creative_asset_job('creative-worker-frozen', 180);

do $$
declare
  v_failed boolean := false;
begin
  if exists (select 1 from creative_frozen_claim)
    or (select status from public.creative_asset_jobs where id =
      (select id from creative_test_ids where key = 'frozen_job')) <> 'PENDING' then
    raise exception 'Kill-switch did not block creative claim';
  end if;

  begin
    perform public.enqueue_creative_asset_job(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      (select id from creative_test_ids where key = 'owner_profile_v2'),
      'customer_http', 'image-model-v1', null,
      '{"prompt":"Must not enqueue while frozen"}'::jsonb, 3
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'Creative job enqueued while kill-switch was frozen';
  end if;
end;
$$;

select public.append_meta_kill_switch_state(
  'ACCOUNT',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  null, 'ALLOW', 'Creative test resume',
  'CUSTOMER', '10000000-0000-4000-8000-000000000001'
);

create temporary table creative_resumed_claim on commit drop as
select * from public.claim_creative_asset_job('creative-worker-resumed', 180);

do $$
begin
  if (select job_id from creative_resumed_claim) <>
      (select id from creative_test_ids where key = 'frozen_job') then
    raise exception 'Creative queue did not resume after ALLOW';
  end if;
end;
$$;

select public.fail_creative_asset_job(
  (select job_id from creative_resumed_claim),
  (select lease_token from creative_resumed_claim),
  'PRE_DISPATCH', 'test_cleanup', 'Test cleanup', false, 60, null
);

-- Every account audit stream remains a contiguous SHA-256 chain.
do $$
begin
  if exists (
    select 1
    from (
      select
        platform_account_id,
        event_sequence,
        previous_event_hash,
        lag(event_hash) over (
          partition by platform_account_id order by event_sequence
        ) as expected_previous_hash
      from public.mutation_audit_events
    ) chained
    where previous_event_hash is distinct from expected_previous_hash
  )
  or exists (
    select 1 from public.mutation_audit_events
    where event_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Creative audit hash chain is invalid';
  end if;

  if (select count(*) from public.mutation_audit_events
      where event_type like 'CREATIVE_ASSET_%') < 12 then
    raise exception 'Creative lifecycle audit events are incomplete';
  end if;
end;
$$;

select 'Meta Creative Asset migration checks passed' as result;

rollback;
