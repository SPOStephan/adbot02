import "server-only";

import { META_GRAPH_VERSION, MetaGraphError } from "@/lib/meta/client";
import { createAppSecretProof, decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { CustomerControlServiceError } from "@/lib/meta/customer-control-service";
import { buildSplitTestAdStudyPayload } from "@/lib/meta/ad-study-payload";
import { createAdminClient } from "@/lib/supabase/admin";

const META_NUMERIC_ID = /^[1-9][0-9]{0,39}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function createFunnelSplitAdStudy(input: {
  userId: string;
  platformAccountId: string;
  planId: string;
}): Promise<{ studyId: string; studyType: "SPLIT_TEST" }> {
  const admin = createAdminClient();
  const { data: plan, error: planError } = await admin
    .from("mutation_plans")
    .select("id,user_id,platform_account_id,status,planned_payload")
    .eq("id", input.planId)
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .maybeSingle();
  if (planError || !plan) {
    throw new CustomerControlServiceError(
      "plan_not_found",
      404,
      "Der Launch-Plan wurde nicht gefunden.",
    );
  }
  const payload = asRecord(plan.planned_payload);
  if (Number(payload.structural_ad_set_count) !== 2) {
    throw new CustomerControlInputError(
      "funnel_split_requires_two_adsets",
      "Ein Meta-Experiment braucht einen Launch mit 2 Ad Sets.",
    );
  }

  const { data: steps } = await admin
    .from("mutation_plan_steps")
    .select("id,step_key")
    .eq("plan_id", input.planId)
    .in("step_key", ["create-ad-set-paused", "create-ad-set-paused-2"]);
  const stepA = (steps ?? []).find((row) => row.step_key === "create-ad-set-paused");
  const stepB = (steps ?? []).find((row) => row.step_key === "create-ad-set-paused-2");
  if (!stepA?.id || !stepB?.id) {
    throw new CustomerControlServiceError(
      "ad_sets_not_ready",
      409,
      "Die beiden Anzeigengruppen sind noch nicht im Plan angelegt.",
    );
  }

  const { data: bindings } = await admin
    .from("remote_object_bindings")
    .select("step_id,remote_object_id,object_type")
    .eq("plan_id", input.planId)
    .eq("user_id", input.userId)
    .eq("object_type", "AD_SET");
  const adSetA = (bindings ?? []).find((row) => row.step_id === stepA.id)
    ?.remote_object_id;
  const adSetB = (bindings ?? []).find((row) => row.step_id === stepB.id)
    ?.remote_object_id;
  if (
    typeof adSetA !== "string" ||
    typeof adSetB !== "string" ||
    !META_NUMERIC_ID.test(adSetA) ||
    !META_NUMERIC_ID.test(adSetB)
  ) {
    throw new CustomerControlServiceError(
      "ad_sets_not_on_meta",
      409,
      "Die Ad Sets sind bei Meta noch nicht angelegt. Bitte den Launch zuerst freigeben und ausführen lassen.",
    );
  }

  const env = getMetaSyncEnv();
  const { data: account } = await admin
    .from("platform_accounts")
    .select(
      "meta_user_id,account_id,access_token_encrypted,token_iv,token_auth_tag",
    )
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();
  if (
    !account?.access_token_encrypted ||
    !account.token_iv ||
    !account.token_auth_tag
  ) {
    throw new CustomerControlServiceError(
      "meta_token_missing",
      409,
      "Meta-Zugang fehlt für das Experiment.",
    );
  }
  const accessToken = decryptAccessToken(
    {
      ciphertext: account.access_token_encrypted,
      iv: account.token_iv,
      authTag: account.token_auth_tag,
    },
    env.tokenEncryptionKey,
  );
  const ownerId = String(account.meta_user_id ?? "").replace(/^act_/, "");
  if (!META_NUMERIC_ID.test(ownerId)) {
    throw new CustomerControlServiceError(
      "meta_user_missing",
      409,
      "Die Meta-User-ID für Ad Studies fehlt. Bitte Meta erneut verbinden.",
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const campaign = asRecord(payload.campaign);
  const study = buildSplitTestAdStudyPayload({
    name:
      optionalText(campaign.name) ??
      optionalText(payload.campaign_name) ??
      "Adbot Funnel Split",
    description: payload.variant_destination_url
      ? `Funnel A ${payload.destination_url} vs Funnel B ${payload.variant_destination_url}`
      : "Adbot 2-Ad-Set Splittest",
    startTimeUnix: nowSec,
    endTimeUnix: nowSec + 7 * 24 * 60 * 60,
    adSetA,
    adSetB,
  });

  const url = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${ownerId}/ad_studies`,
  );
  url.searchParams.set(
    "appsecret_proof",
    createAppSecretProof(accessToken, env.appSecret),
  );
  const body = new URLSearchParams();
  body.set("name", study.name);
  body.set("description", study.description);
  body.set("start_time", String(study.start_time));
  body.set("end_time", String(study.end_time));
  body.set("type", study.type);
  body.set("cells", JSON.stringify(study.cells));

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: Record<string, unknown>;
  };
  if (!response.ok || !json.id) {
    const graphError = new MetaGraphError(
      response.status || 400,
      json && typeof json === "object" ? json : {},
    );
    throw new CustomerControlServiceError(
      "meta_ad_study_failed",
      graphError.status >= 400 && graphError.status < 600
        ? graphError.status
        : 502,
      graphError.diagnosticDetail
        ? `Meta-Experiment abgelehnt: ${graphError.diagnosticDetail}`
        : "Meta hat das Experiment nicht angelegt. Der Launch bleibt bestehen.",
    );
  }

  try {
    await admin.rpc("append_meta_mutation_audit_event", {
      p_user_id: input.userId,
      p_platform_account_id: input.platformAccountId,
      p_policy_id: null,
      p_plan_id: input.planId,
      p_step_id: null,
      p_execution_id: null,
      p_actor_type: "CUSTOMER",
      p_actor_id: input.userId,
      p_event_type: "META_AD_STUDY_CREATED",
      p_before_state: {},
      p_request_payload: {
        type: "SPLIT_TEST",
        adsets: [adSetA, adSetB],
      },
      p_response_payload: { study_id: json.id },
      p_after_state: {},
      p_metadata: { source: "createFunnelSplitAdStudy" },
    });
  } catch {
    // Audit is best-effort — a hash-chain hiccup must not hide a created study.
  }

  return { studyId: json.id, studyType: "SPLIT_TEST" };
}
