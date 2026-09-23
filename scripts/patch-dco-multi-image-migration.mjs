import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourcePath = join(
  root,
  "supabase/migrations/20260818200000_launch_structural_two_adsets.sql",
);
const dailyWrapperPath = join(
  root,
  "supabase/migrations/20260817140000_traffic_launch_prepare_result_contract.sql",
);
const destPath = join(
  root,
  "supabase/migrations/20260923160000_launch_dco_multi_image.sql",
);

const helperSql = `-- Optional multi-image Dynamic / Advantage+ Creative.
-- Default remains one brand asset. Extra images are opt-in via
-- launch_inputs.use_dynamic_creative_images + dynamic_creative_asset_ids.
-- Mutually exclusive with structural multi-ad. Does NOT redefine organic boost.

create or replace function public.meta_launch_collect_brand_asset_ids(
  p_primary uuid,
  p_launch_inputs jsonb
)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ids uuid[] := array[p_primary]::uuid[];
  v_extra uuid;
  v_seen uuid[] := array[p_primary]::uuid[];
  v_opt_in boolean := false;
begin
  if p_primary is null then
    raise exception 'At least one brand asset is required';
  end if;

  if coalesce(p_launch_inputs, '{}'::jsonb) ? 'use_dynamic_creative_images' then
    begin
      v_opt_in := coalesce((p_launch_inputs->>'use_dynamic_creative_images')::boolean, false);
    exception when others then
      raise exception 'use_dynamic_creative_images muss true oder false sein';
    end;
  end if;

  if jsonb_typeof(p_launch_inputs->'dynamic_creative_asset_ids') = 'array' then
    if not v_opt_in then
      raise exception 'Zusätzliche Dynamic-Creative-Bilder erfordern use_dynamic_creative_images=true';
    end if;
    if jsonb_array_length(p_launch_inputs->'dynamic_creative_asset_ids') > 9 then
      raise exception 'Dynamic Creative erlaubt höchstens 10 Bilder';
    end if;
    for v_extra in
      select extra.asset_text::uuid
      from jsonb_array_elements_text(p_launch_inputs->'dynamic_creative_asset_ids')
        with ordinality as extra(asset_text, ordinal)
      order by extra.ordinal
    loop
      if v_extra is null then
        raise exception 'dynamic_creative_asset_ids enthält eine ungültige Asset-ID';
      end if;
      if v_extra = any(v_seen) then
        continue;
      end if;
      v_seen := v_seen || v_extra;
      v_ids := v_ids || v_extra;
    end loop;
  end if;

  if pg_catalog.array_length(v_ids, 1) > 10 then
    raise exception 'Dynamic Creative erlaubt höchstens 10 Bilder';
  end if;

  return v_ids;
end;
$$;

revoke all on function public.meta_launch_collect_brand_asset_ids(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.meta_launch_collect_brand_asset_ids(uuid, jsonb)
  to service_role;

comment on function public.meta_launch_collect_brand_asset_ids(uuid, jsonb) is
  'Primary brand asset plus optional Dynamic Creative extras from launch_inputs.';
`;

function replaceAllOrThrow(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count < 1) {
    throw new Error(`Missing replacement target: ${label}`);
  }
  return source.split(search).join(replacement);
}

const extraAssetValidation = `
  if v_unique_asset_count > 1 then
    if exists (
      select 1
      from pg_catalog.unnest(p_brand_asset_ids) as launch_asset(asset_id)
      where not exists (
        select 1
        from public.brand_assets extra
        where extra.id = launch_asset.asset_id
          and extra.user_id = p_user_id
          and extra.platform_account_id = p_platform_account_id
          and extra.brand_profile_id = p_brand_profile_id
          and extra.status = 'READY'
          and extra.moderation_status = 'APPROVED'
          and extra.reviewed_at is not null
          and extra.mime_type in ('image/jpeg', 'image/png')
          and extra.sha256 ~ '^[0-9a-f]{64}$'
          and (
            (
              extra.meta_image_hash is not null
              and extra.meta_image_hash ~ '^[A-Fa-f0-9]{16,128}$'
            )
            or (
              extra.meta_image_hash is null
              and nullif(extra.storage_bucket, '') is not null
              and nullif(extra.storage_path, '') is not null
              and extra.byte_size is not null
              and extra.byte_size > 0
            )
          )
      )
    ) then
      raise exception 'READY approved image asset is invalid';
    end if;
  end if;
`;

const imageRefAndDcoBind = `  v_dco_image_refs := jsonb_build_array(jsonb_build_object('hash', v_image_reference));
  v_pending_extra_uploads := '[]'::jsonb;
  if v_dco_multi_image then
    for v_asset_index in 2..v_unique_asset_count loop
      select extra.* into v_extra_asset
      from public.brand_assets extra
      where extra.id = p_brand_asset_ids[v_asset_index]
        and extra.user_id = p_user_id
        and extra.platform_account_id = p_platform_account_id
        and extra.brand_profile_id = p_brand_profile_id;
      if v_extra_asset.meta_image_hash is null then
        v_extra_upload_step := gen_random_uuid();
        v_extra_image_ref := jsonb_build_object('$binding_step_id', v_extra_upload_step);
        v_pending_extra_uploads := v_pending_extra_uploads || jsonb_build_array(
          jsonb_build_object(
            'step_id', v_extra_upload_step,
            'brand_asset_id', v_extra_asset.id,
            'asset_sha256', v_extra_asset.sha256,
            'step_key', 'upload-image-' || v_asset_index::text
          )
        );
      else
        v_extra_image_ref := pg_catalog.to_jsonb(v_extra_asset.meta_image_hash);
      end if;
      v_dco_image_refs := v_dco_image_refs || jsonb_build_array(
        jsonb_build_object('hash', v_extra_image_ref)
      );
    end loop;
  end if;

`;

const dcoBindReplacement = `  -- Dynamic Creative text variants and/or optional multi-image asset_feed_spec.
  elsif jsonb_typeof(v_creative_payload->'asset_feed_spec') = 'object'
    or v_dco_multi_image then
    if jsonb_typeof(v_creative_payload->'asset_feed_spec') <> 'object' then
      v_creative_payload := jsonb_set(
        v_creative_payload,
        '{asset_feed_spec}',
        jsonb_strip_nulls(jsonb_build_object(
          'ad_formats', '["SINGLE_IMAGE"]'::jsonb,
          'bodies', jsonb_build_array(jsonb_build_object(
            'text', coalesce(
              nullif(btrim(v_object_story_spec#>>'{link_data,message}'), ''),
              'Mehr erfahren.'
            )
          )),
          'titles', jsonb_build_array(jsonb_build_object(
            'text', coalesce(
              nullif(btrim(v_object_story_spec#>>'{link_data,name}'), ''),
              'Jetzt mehr erfahren'
            )
          )),
          'descriptions', case
            when nullif(btrim(coalesce(v_object_story_spec#>>'{link_data,description}', '')), '') is null
              then null
            else jsonb_build_array(jsonb_build_object(
              'text', btrim(v_object_story_spec#>>'{link_data,description}')
            ))
          end,
          'call_to_action_types', jsonb_build_array(coalesce(
            nullif(v_object_story_spec#>>'{link_data,call_to_action,type}', ''),
            'LEARN_MORE'
          ))
        )),
        true
      );
    end if;
`;

const extraUploadInsert = `
  if jsonb_typeof(v_pending_extra_uploads) = 'array'
    and jsonb_array_length(v_pending_extra_uploads) > 0 then
    for v_asset_index in 0..jsonb_array_length(v_pending_extra_uploads) - 1 loop
      v_extra_upload_step := (v_pending_extra_uploads->v_asset_index->>'step_id')::uuid;
      v_request := jsonb_build_object(
        'operation', 'UPLOAD_IMAGE',
        'object_type', 'IMAGE',
        'brand_asset_id', v_pending_extra_uploads->v_asset_index->>'brand_asset_id',
        'asset_sha256', v_pending_extra_uploads->v_asset_index->>'asset_sha256'
      );
      insert into public.mutation_plan_steps (
        id, plan_id, user_id, platform_account_id, step_index, step_key,
        operation, object_type, depends_on_step_id, planned_request,
        request_hash, expected_result, compensation_operation, status
      ) values (
        v_extra_upload_step, v_plan_id, p_user_id, p_platform_account_id,
        v_index, v_pending_extra_uploads->v_asset_index->>'step_key',
        'CREATE', 'IMAGE', v_previous_step,
        v_request, public.meta_sha256(v_request::text),
        jsonb_build_object(
          'asset_sha256', v_pending_extra_uploads->v_asset_index->>'asset_sha256'
        ),
        'NONE', 'PENDING'
      );
      v_previous_step := v_extra_upload_step;
      v_index := v_index + 1;
    end loop;
  end if;
`;

const approveAssetReplacement = `  if jsonb_typeof(v_plan.planned_payload->'brand_asset_ids') <> 'array'
    or jsonb_array_length(v_plan.planned_payload->'brand_asset_ids') < 1
    or jsonb_array_length(v_plan.planned_payload->'brand_asset_ids') > 10 then
    raise exception 'Approved launch asset drifted';
  end if;

  select asset.* into v_asset
  from public.brand_assets asset
  where asset.id = (v_plan.planned_payload->'brand_asset_ids'->>0)::uuid
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.brand_profile_id = v_profile.id
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null
    and asset.mime_type in ('image/jpeg', 'image/png')
    and asset.sha256 ~ '^[0-9a-f]{64}$'
  for share;

  if not found then
    raise exception 'Approved launch asset drifted';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(v_plan.planned_payload->'brand_asset_ids')
      as launch_asset(asset_id)
    where not exists (
      select 1
      from public.brand_assets extra
      where extra.id = launch_asset.asset_id::uuid
        and extra.user_id = p_user_id
        and extra.platform_account_id = p_platform_account_id
        and extra.brand_profile_id = v_profile.id
        and extra.status = 'READY'
        and extra.moderation_status = 'APPROVED'
        and extra.reviewed_at is not null
        and extra.mime_type in ('image/jpeg', 'image/png')
        and extra.sha256 ~ '^[0-9a-f]{64}$'
    )
  ) then
    raise exception 'Approved launch asset drifted';
  end if;

  select count(*)::integer,
         count(*) filter (where step.step_key like 'upload-image%')::integer
    into v_step_count, v_upload_step_count
  from public.mutation_plan_steps step
  where step.plan_id = v_plan.id;

  select count(*)::integer
    into v_expected_upload_count
  from jsonb_array_elements_text(v_plan.planned_payload->'brand_asset_ids')
    as launch_asset(asset_id)
  join public.brand_assets extra
    on extra.id = launch_asset.asset_id::uuid
  where extra.meta_image_hash is null;

  v_base_step_count := 20;
  if coalesce((v_plan.planned_payload->>'structural_ad_set_count')::integer, 1) = 2 then
    v_base_step_count := 33;
  elsif coalesce((v_plan.planned_payload->>'structural_ad_count')::integer, 1) = 2 then
    v_base_step_count := 28;
  end if;

  if v_step_count <> v_base_step_count + v_upload_step_count
    or v_upload_step_count <> v_expected_upload_count
    or exists (`;

const source = await readFile(sourcePath, "utf8");
const dailySource = await readFile(dailyWrapperPath, "utf8");

const dailyStart = dailySource.indexOf(
  "create or replace function public.materialize_meta_customer_launch_plan(",
);
const dailyEnd = dailySource.indexOf("\ncommit;", dailyStart);
if (dailyStart < 0 || dailyEnd < 0) {
  throw new Error("Could not extract daily customer launch wrapper");
}
let dailyWrapper = dailySource.slice(dailyStart, dailyEnd);
dailyWrapper = replaceAllOrThrow(
  dailyWrapper,
  "    array[p_brand_asset_id]::uuid[],",
  "    public.meta_launch_collect_brand_asset_ids(\n      p_brand_asset_id,\n      coalesce(p_launch_inputs, '{}'::jsonb)\n    ),",
  "daily customer array wrap",
);

let sql = source;
sql = sql.replace(
  /^-- Structural multi-ad Step 2b: also support 2 Ad Sets[\s\S]*?-- Copied forward from 20260818190000.\n\n/,
  `-- Optional multi-image Dynamic / Advantage+ Creative on the latest launch chain.
-- Copied forward from 20260818200000; default remains one unique brand asset.

`,
);

sql = replaceAllOrThrow(
  sql,
  `  v_structural_ads jsonb := '[]'::jsonb;
  v_creative_payload_2 jsonb;`,
  `  v_structural_ads jsonb := '[]'::jsonb;
  v_dco_multi_image boolean := false;
  v_dco_image_refs jsonb := '[]'::jsonb;
  v_pending_extra_uploads jsonb := '[]'::jsonb;
  v_extra_asset public.brand_assets%rowtype;
  v_extra_image_ref jsonb;
  v_extra_upload_step uuid;
  v_asset_index integer;
  v_creative_payload_2 jsonb;`,
  "declare dco vars",
);

sql = replaceAllOrThrow(
  sql,
  `  -- Absent structural_ad_set_count with structural_ad_count=2 → treat as 1 (compat).


  if p_brand_asset_ids is null or pg_catalog.array_length(p_brand_asset_ids, 1) is null then
    raise exception 'At least one brand asset is required';
  end if;

  select count(*), count(distinct launch_asset.asset_id)
    into v_asset_count, v_unique_asset_count
  from pg_catalog.unnest(p_brand_asset_ids) as launch_asset(asset_id);

  if v_asset_count <> 1 or v_unique_asset_count <> 1
    or p_brand_asset_ids[1] is null then
    raise exception 'Launch Chain v1 requires exactly one unique brand asset';
  end if;`,
  `  -- Absent structural_ad_set_count with structural_ad_count=2 → treat as 1 (compat).

  v_dco_multi_image := false;
  if coalesce(p_launch_inputs, '{}'::jsonb) ? 'use_dynamic_creative_images' then
    begin
      v_dco_multi_image := coalesce(
        (p_launch_inputs->>'use_dynamic_creative_images')::boolean,
        false
      );
    exception when others then
      raise exception 'use_dynamic_creative_images muss true oder false sein';
    end;
  end if;

  if p_brand_asset_ids is null or pg_catalog.array_length(p_brand_asset_ids, 1) is null then
    raise exception 'At least one brand asset is required';
  end if;

  select count(*), count(distinct launch_asset.asset_id)
    into v_asset_count, v_unique_asset_count
  from pg_catalog.unnest(p_brand_asset_ids) as launch_asset(asset_id);

  if v_asset_count is null
    or v_unique_asset_count is null
    or v_asset_count < 1
    or v_unique_asset_count <> v_asset_count
    or p_brand_asset_ids[1] is null then
    raise exception 'Launch requires unique brand assets';
  end if;

  if v_dco_multi_image and v_structural_ad_count = 2 then
    raise exception 'Dynamic Creative mit mehreren Bildern ist nicht mit Struktur-Test kombinierbar';
  end if;

  if not v_dco_multi_image then
    if v_asset_count <> 1 then
      raise exception 'Launch Chain v1 requires exactly one unique brand asset';
    end if;
  elsif v_asset_count > 10 then
    raise exception 'Dynamic Creative erlaubt höchstens 10 Bilder';
  end if;

  v_dco_multi_image := v_dco_multi_image and v_unique_asset_count > 1;`,
  "asset count gate",
);

sql = replaceAllOrThrow(
  sql,
  `    raise exception 'READY approved image asset is invalid';
  end if;

  v_campaign_payload := v_blueprint.payload_template->'campaign';`,
  `    raise exception 'READY approved image asset is invalid';
  end if;
${extraAssetValidation}
  v_campaign_payload := v_blueprint.payload_template->'campaign';`,
  "extra asset validation",
);

sql = replaceAllOrThrow(
  sql,
  `  if v_asset.meta_image_hash is null then
    v_has_upload := true;
    v_image_reference := jsonb_build_object('$binding_step_id', v_step_upload_image);
  else
    v_image_reference := pg_catalog.to_jsonb(v_asset.meta_image_hash);
  end if;

  -- Structural multi-ad: strip DCA and force classic link_data from structural_ads.`,
  `  if v_asset.meta_image_hash is null then
    v_has_upload := true;
    v_image_reference := jsonb_build_object('$binding_step_id', v_step_upload_image);
  else
    v_image_reference := pg_catalog.to_jsonb(v_asset.meta_image_hash);
  end if;
${imageRefAndDcoBind}
  -- Structural multi-ad: strip DCA and force classic link_data from structural_ads.`,
  "image refs",
);

sql = replaceAllOrThrow(
  sql,
  `  -- Dynamic Creative text variants (asset_feed_spec): one ad, many bodies/titles.
  elsif jsonb_typeof(v_creative_payload->'asset_feed_spec') = 'object' then`,
  dcoBindReplacement,
  "dco bind branch",
);

sql = replaceAllOrThrow(
  sql,
  `      '{asset_feed_spec,images}',
      jsonb_build_array(jsonb_build_object('hash', v_image_reference)),
      true
    );`,
  `      '{asset_feed_spec,images}',
      v_dco_image_refs,
      true
    );`,
  "dco images array",
);

sql = replaceAllOrThrow(
  sql,
  `    v_previous_step := v_step_upload_image;
    v_index := v_index + 1;
  end if;

  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'mode', 'validate_only', 'payload', v_creative_payload
  );`,
  `    v_previous_step := v_step_upload_image;
    v_index := v_index + 1;
  end if;
${extraUploadInsert}
  v_request := jsonb_build_object(
    'operation', 'CREATE_CREATIVE', 'object_type', 'CREATIVE',
    'mode', 'validate_only', 'payload', v_creative_payload
  );`,
  "extra upload steps",
);

sql = replaceAllOrThrow(
  sql,
  `      'target_status', v_existing_plan.intended_after->>'status'
    );`,
  `      'target_status', v_existing_plan.intended_after->>'status',
      'brand_asset_ids', v_existing_plan.planned_payload->'brand_asset_ids'
    );`,
  "existing return brand_asset_ids",
);

sql = replaceAllOrThrow(
  sql,
  `    'ad_name', v_ad_name,
    'target_status', 'ACTIVE'
  );
end;
$$;`,
  `    'ad_name', v_ad_name,
    'target_status', 'ACTIVE',
    'brand_asset_ids', pg_catalog.to_jsonb(p_brand_asset_ids)
  );
end;
$$;`,
  "created return brand_asset_ids",
);

sql = replaceAllOrThrow(
  sql,
  `    array[p_brand_asset_id]::uuid[],`,
  `    public.meta_launch_collect_brand_asset_ids(
      p_brand_asset_id,
      coalesce(p_launch_inputs, '{}'::jsonb)
    ),`,
  "lifetime customer array wrap",
);

sql = replaceAllOrThrow(
  sql,
  `  v_upload_step_count integer;
  v_account_day date;`,
  `  v_upload_step_count integer;
  v_expected_upload_count integer;
  v_base_step_count integer;
  v_account_day date;`,
  "approve declare",
);

sql = replaceAllOrThrow(
  sql,
  `  select asset.* into v_asset
  from public.brand_assets asset
  where asset.id = (v_plan.planned_payload->'brand_asset_ids'->>0)::uuid
    and jsonb_array_length(v_plan.planned_payload->'brand_asset_ids') = 1
    and asset.user_id = p_user_id
    and asset.platform_account_id = p_platform_account_id
    and asset.brand_profile_id = v_profile.id
    and asset.status = 'READY'
    and asset.moderation_status = 'APPROVED'
    and asset.reviewed_at is not null
    and asset.mime_type in ('image/jpeg', 'image/png')
    and asset.sha256 ~ '^[0-9a-f]{64}$'
  for share;

  if not found then
    raise exception 'Approved launch asset drifted';
  end if;

  select count(*)::integer,
         count(*) filter (where step_key = 'upload-image')::integer
    into v_step_count, v_upload_step_count
  from public.mutation_plan_steps step
  where step.plan_id = v_plan.id;

  if v_step_count not in (20, 21, 28, 29, 33, 34)
    or (v_upload_step_count = 1) <> (v_asset.meta_image_hash is null)
    or exists (`,
  approveAssetReplacement,
  "approve asset + step counts",
);

// Drop the leftover grant/comment tail after reconcile so we can append wrappers
// without duplicating customer daily wrapper (it lives in 20260817140000).
const grantMarker = "revoke all on function public.materialize_meta_launch_chain_plan_v3(";
const grantAt = sql.indexOf(grantMarker);
if (grantAt < 0) throw new Error("missing grant marker");
const afterV3 = sql.indexOf(
  "create or replace function public.materialize_meta_customer_lifetime_launch_plan_v3(",
);
if (afterV3 < 0) throw new Error("missing lifetime customer wrapper");

// Keep lifetime customer wrapper + approve + reconcile, then append daily wrapper.
const lifetimeStart = afterV3;
const approveStart = sql.indexOf(
  "create or replace function public.approve_meta_launch_canary_plan(",
);
if (approveStart < 0) throw new Error("missing approve");

// Rebuild: helper + patched chain daily + grants + lifetime chain + lifetime customer + approve + reconcile + daily customer
// The source already has this order. We only prepend helper and append daily wrapper.

sql = `${helperSql}\n${sql}\n${dailyWrapper}`;

await writeFile(destPath, sql);
console.log(`Wrote ${destPath} (${sql.length} bytes)`);
