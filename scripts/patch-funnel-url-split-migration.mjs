import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourcePath = join(
  root,
  "supabase/migrations/20260923160000_launch_dco_multi_image.sql",
);
const destPath = join(
  root,
  "supabase/migrations/20260923180000_launch_funnel_url_split.sql",
);

function replaceAllOrThrow(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count < 1) {
    throw new Error(`patch missed ${label}`);
  }
  return source.split(search).join(replacement);
}

const declarePatch = `  v_destination_url text;
  v_destination_host text;
  v_variant_destination_url text;
  v_variant_destination_host text;
  v_variant_domain public.allowed_domains%rowtype;
  v_use_meta_experiment boolean := false;
  v_campaign_payload jsonb;`;

const parsePatch = `  -- Absent structural_ad_set_count with structural_ad_count=2 → treat as 1 (compat).

  v_variant_destination_url := nullif(btrim(coalesce(p_launch_inputs->>'variant_destination_url', '')), '');
  v_use_meta_experiment := false;
  if coalesce(p_launch_inputs, '{}'::jsonb) ? 'use_meta_experiment' then
    begin
      v_use_meta_experiment := coalesce((p_launch_inputs->>'use_meta_experiment')::boolean, false);
    exception when others then
      raise exception 'use_meta_experiment muss true oder false sein';
    end;
  end if;
  if v_variant_destination_url is not null then
    if v_variant_destination_url !~ '^https://' then
      raise exception 'variant_destination_url muss HTTPS sein';
    end if;
    if v_structural_ad_set_count <> 2 then
      raise exception 'Funnel-Splittest erfordert 2 Ad Sets';
    end if;
  end if;
  if v_use_meta_experiment and v_structural_ad_set_count <> 2 then
    raise exception 'Meta-Experiment erfordert 2 Ad Sets';
  end if;`;

const domainPatch = `  elsif v_policy.require_verified_domain then
    raise exception 'Verified HTTPS destination URL is required by policy';
  end if;

  if v_variant_destination_url is not null then
    if v_destination_url is not null
      and v_variant_destination_url = v_destination_url then
      raise exception 'Funnel B braucht eine andere URL als Funnel A';
    end if;
    v_variant_destination_host := lower(
      substring(v_variant_destination_url from '^https://([^/:?#]+)')
    );
    if v_variant_destination_host is null then
      raise exception 'Launch variant destination URL is invalid';
    end if;
    if v_variant_destination_host = v_domain.hostname
      or v_variant_destination_host = v_domain.registrable_domain
      or v_variant_destination_host like '%.' || v_domain.registrable_domain
    then
      v_variant_domain := v_domain;
    else
      if not (coalesce(p_launch_inputs, '{}'::jsonb) ? 'variant_allowed_domain_id') then
        raise exception 'Launch variant destination URL is not covered by the verified domain';
      end if;
      select domain_row.*
        into v_variant_domain
      from public.allowed_domains domain_row
      where domain_row.id = (p_launch_inputs->>'variant_allowed_domain_id')::uuid
        and domain_row.user_id = p_user_id
        and domain_row.platform_account_id = p_platform_account_id
        and domain_row.status = 'VERIFIED'
        and domain_row.verified_at is not null
        and domain_row.customer_confirmed_at is not null
        and domain_row.revoked_at is null;
      if not found then
        raise exception 'Verified variant domain is required';
      end if;
      if not (
        v_variant_destination_host = v_variant_domain.hostname
        or v_variant_destination_host = v_variant_domain.registrable_domain
        or v_variant_destination_host like '%.' || v_variant_domain.registrable_domain
      ) then
        raise exception 'Launch variant destination URL is not covered by the variant domain';
      end if;
    end if;
  end if;`;

const creative2Patch = `    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,description}',
      pg_catalog.to_jsonb(coalesce(v_structural_ads->1->>'description', '')),
      true
    );
    if v_variant_destination_url is not null then
      v_creative_payload_2 := jsonb_set(
        v_creative_payload_2,
        '{object_story_spec,link_data,link}',
        pg_catalog.to_jsonb(v_variant_destination_url),
        true
      );
      if jsonb_typeof(v_creative_payload_2#>'{asset_feed_spec,link_urls}') = 'array' then
        v_creative_payload_2 := jsonb_set(
          v_creative_payload_2,
          '{asset_feed_spec,link_urls}',
          jsonb_build_array(jsonb_build_object('website_url', v_variant_destination_url)),
          true
        );
      end if;
    end if;`;

const ad2DomainPatch = `    if v_structural_ad_set_count = 2 then
      v_ad_payload_2 := jsonb_set(
        v_ad_payload_2,
        '{adset_id}',
        jsonb_build_object('$binding_step_id', v_step_create_ad_set_2),
        true
      );
      if v_variant_domain.registrable_domain is not null then
        v_ad_payload_2 := jsonb_set(
          v_ad_payload_2,
          '{conversion_domain}',
          pg_catalog.to_jsonb(v_variant_domain.registrable_domain),
          true
        );
      end if;
    end if;`;

const payloadPatch = `    'destination_url', v_destination_url,
    'destination_hostname', v_destination_host,`;

const payloadReplacement = `    'destination_url', v_destination_url,
    'destination_hostname', v_destination_host,
    'variant_destination_url', v_variant_destination_url,
    'variant_destination_hostname', v_variant_destination_host,
    'use_meta_experiment', v_use_meta_experiment,`;

await copyFile(sourcePath, destPath);
let sql = await readFile(destPath, "utf8");

sql = sql.replace(
  /^-- Optional multi-image Dynamic \/ Advantage\+ Creative\.\n-- Default remains one brand asset\. Extra images are opt-in via\n-- launch_inputs\.use_dynamic_creative_images \+ dynamic_creative_asset_ids\.\n-- Mutually exclusive with structural multi-ad\. Does NOT redefine organic boost\./,
  `-- Funnel URL split: optional variant_destination_url on Ad Set 2.
-- Default remains one destination URL. Requires structural_ad_set_count=2.
-- Optional use_meta_experiment is stored for a post-launch Ad Study try.
-- Does NOT redefine organic boost, kill-switch, or launch freeze.`,
);

sql = replaceAllOrThrow(
  sql,
  `  v_destination_url text;
  v_destination_host text;
  v_campaign_payload jsonb;`,
  declarePatch,
  "declare variant vars",
);

sql = replaceAllOrThrow(
  sql,
  `  -- Absent structural_ad_set_count with structural_ad_count=2 → treat as 1 (compat).`,
  parsePatch,
  "parse variant url",
);

sql = replaceAllOrThrow(
  sql,
  `  elsif v_policy.require_verified_domain then
    raise exception 'Verified HTTPS destination URL is required by policy';
  end if;`,
  domainPatch,
  "variant domain check",
);

sql = replaceAllOrThrow(
  sql,
  `    v_creative_payload_2 := jsonb_set(
      v_creative_payload_2,
      '{object_story_spec,link_data,description}',
      pg_catalog.to_jsonb(coalesce(v_structural_ads->1->>'description', '')),
      true
    );`,
  creative2Patch,
  "creative 2 variant url",
);

sql = replaceAllOrThrow(
  sql,
  `    if v_structural_ad_set_count = 2 then
      v_ad_payload_2 := jsonb_set(
        v_ad_payload_2,
        '{adset_id}',
        jsonb_build_object('$binding_step_id', v_step_create_ad_set_2),
        true
      );
    end if;`,
  ad2DomainPatch,
  "ad 2 conversion domain",
);

sql = replaceAllOrThrow(
  sql,
  payloadPatch,
  payloadReplacement,
  "planned payload variant fields",
);

if (sql.includes("materialize_meta_organic_boost_plan")) {
  throw new Error("organic boost leaked into funnel split migration");
}

await writeFile(destPath, sql);
console.log("wrote", destPath);
