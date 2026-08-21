import "server-only";

import { createHash } from "node:crypto";

import { MetaGraphError } from "@/lib/meta/client";
import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  updateMetaAdSetStatus,
  updateMetaAdStatus,
  type MetaWritePayload,
} from "@/lib/meta/write-client";
import { createAdminClient } from "@/lib/supabase/admin";

export type MissingAdRepairResult = {
  attempted: boolean;
  adSetsCreated: number;
  creativesCreated: number;
  adsCreated: number;
  activated: number;
  error: string | null;
  rateLimited: boolean;
};

function formatRepairError(error: unknown): string {
  if (error instanceof MetaGraphError) {
    if (error.diagnosticDetail) {
      return error.diagnosticDetail;
    }
    return `Meta Graph API request failed (HTTP ${error.status})`;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "organic_boost_missing_ad_repair_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPayload(value: unknown): MetaWritePayload | null {
  if (!isRecord(value)) return null;
  return value as MetaWritePayload;
}

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function isRateLimited(error: unknown): boolean {
  return error instanceof MetaGraphError && error.rateLimited;
}

function stripBindingRefs(payload: MetaWritePayload): MetaWritePayload {
  const next: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(next)) {
    if (
      isRecord(value) &&
      Object.keys(value).length === 1 &&
      "$binding_step_id" in value
    ) {
      delete next[key];
    }
  }
  return next as MetaWritePayload;
}

function pickFields(
  payload: MetaWritePayload,
  allowed: ReadonlySet<string>,
): MetaWritePayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => allowed.has(key)),
  ) as MetaWritePayload;
}

const AD_SET_REPAIR_FIELDS = new Set([
  "bid_strategy",
  "billing_event",
  "campaign_id",
  "daily_budget",
  "destination_type",
  "end_time",
  "lifetime_budget",
  "name",
  "optimization_goal",
  "promoted_object",
  "start_time",
  "status",
  "targeting",
]);

const CREATIVE_REPAIR_FIELDS = new Set([
  "instagram_user_id",
  "name",
  "object_id",
  "object_story_id",
  "source_instagram_media_id",
]);

const AD_REPAIR_FIELDS = new Set([
  "adset_id",
  "conversion_domain",
  "creative",
  "name",
  "status",
]);

function withRepairSchedule(
  adSet: MetaWritePayload,
  campaignStopTime: string | null,
): MetaWritePayload {
  // Never reuse a stale planned start_time — that makes Meta show
  // "Wird vorbereitet" / odd delivery windows under an already-live campaign.
  const start = new Date();
  start.setSeconds(0, 0);
  let endMs = campaignStopTime ? Date.parse(campaignStopTime) : Number.NaN;
  if (!Number.isFinite(endMs) || endMs <= start.getTime()) {
    const fromPayload =
      typeof adSet.end_time === "string" ? Date.parse(adSet.end_time) : Number.NaN;
    endMs =
      Number.isFinite(fromPayload) && fromPayload > start.getTime()
        ? fromPayload
        : start.getTime() + 24 * 60 * 60 * 1000;
  }
  return {
    ...adSet,
    start_time: start.toISOString(),
    end_time: new Date(endMs).toISOString(),
  };
}

async function resolvePlanForCampaign(input: {
  userId: string;
  platformAccountId: string;
  campaignId: string;
}): Promise<{
  planId: string;
  plannedPayload: Record<string, unknown>;
  stepIds: { adSet: string | null; creative: string | null; ad: string | null };
} | null> {
  const admin = createAdminClient();

  const { data: binding } = await admin
    .from("remote_object_bindings")
    .select("plan_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("object_type", "CAMPAIGN")
    .eq("remote_object_id", input.campaignId)
    .maybeSingle();

  let planId =
    typeof binding?.plan_id === "string" ? binding.plan_id : null;

  if (!planId) {
    const { data: campaignRow } = await admin
      .from("campaigns")
      .select("name")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("platform_campaign_id", input.campaignId)
      .maybeSingle();
    const name = typeof campaignRow?.name === "string" ? campaignRow.name : "";
    const match = /\[([0-9a-f]{12})-c\]/i.exec(name);
    if (match?.[1]) {
      const { data: link } = await admin
        .from("meta_organic_boost_links")
        .select("plan_id")
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .limit(200);
      for (const row of link ?? []) {
        if (typeof row.plan_id !== "string") continue;
        const { data: plan } = await admin
          .from("mutation_plans")
          .select("id,planned_payload")
          .eq("id", row.plan_id)
          .eq("user_id", input.userId)
          .maybeSingle();
        const payload = isRecord(plan?.planned_payload)
          ? plan.planned_payload
          : null;
        const campaignName = isRecord(payload?.campaign)
          ? String(payload.campaign.name ?? "")
          : "";
        if (campaignName.includes(match[1])) {
          planId = row.plan_id;
          break;
        }
      }
    }
  }

  if (!planId) {
    return null;
  }

  const { data: plan } = await admin
    .from("mutation_plans")
    .select("id,planned_payload")
    .eq("id", planId)
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .maybeSingle();

  if (!plan?.id || !isRecord(plan.planned_payload)) {
    return null;
  }

  const { data: steps } = await admin
    .from("mutation_plan_steps")
    .select("id,step_key")
    .eq("plan_id", planId)
    .in("step_key", [
      "create-ad-set-paused",
      "create-creative",
      "create-ad-paused",
    ]);

  const stepIds = {
    adSet: null as string | null,
    creative: null as string | null,
    ad: null as string | null,
  };
  for (const step of steps ?? []) {
    if (typeof step.id !== "string") continue;
    if (step.step_key === "create-ad-set-paused") stepIds.adSet = step.id;
    if (step.step_key === "create-creative") stepIds.creative = step.id;
    if (step.step_key === "create-ad-paused") stepIds.ad = step.id;
  }

  return {
    planId: plan.id,
    plannedPayload: plan.planned_payload,
    stepIds,
  };
}

async function upsertBinding(input: {
  userId: string;
  platformAccountId: string;
  planId: string;
  stepId: string | null;
  objectType: "AD_SET" | "CREATIVE" | "AD";
  remoteObjectId: string;
  requestFingerprint: string;
  responseFingerprint: string;
}): Promise<void> {
  if (!input.stepId) {
    return;
  }
  // Bindings table is executor/RPC-owned (no direct service_role write grant).
  // Best-effort update keeps local tree honest when permitted; Meta create is
  // the delivery fix and does not depend on this.
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("remote_object_bindings")
      .select("id")
      .eq("plan_id", input.planId)
      .eq("step_id", input.stepId)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("remote_object_bindings")
        .update({
          remote_object_id: input.remoteObjectId,
          request_fingerprint: input.requestFingerprint,
          remote_fingerprint: input.responseFingerprint,
          bound_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("user_id", input.userId);
    }
  } catch (error) {
    console.error("organic_boost_missing_ad_binding_skip", {
      planId: input.planId,
      objectType: input.objectType,
      error: error instanceof Error ? error.message : "binding_update_failed",
    });
  }
}

/**
 * Recreate missing ad set / creative / ad under a live Organic Boost campaign
 * that Meta shows as "Keine Werbeanzeige". Uses planned_payload from the
 * original LAUNCH_CHAIN plan — does not rematerialize (link would EXISTING).
 */
export async function repairMissingOrganicBoostAd(input: {
  userId: string;
  platformAccountId: string;
  campaignId: string;
  accessToken: string;
  appSecret: string;
  adAccountId: string;
  existingAdSetIds: string[];
  /** Local campaigns.stop_time — preferred end for a repair ad set. */
  campaignStopTime?: string | null;
}): Promise<MissingAdRepairResult> {
  const empty: MissingAdRepairResult = {
    attempted: false,
    adSetsCreated: 0,
    creativesCreated: 0,
    adsCreated: 0,
    activated: 0,
    error: null,
    rateLimited: false,
  };

  const resolved = await resolvePlanForCampaign({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
    campaignId: input.campaignId,
  });
  if (!resolved) {
    return {
      ...empty,
      attempted: true,
      error: "keine_werbeanzeige:plan_payload_fehlt",
    };
  }

  const adSetTemplate = asPayload(resolved.plannedPayload.ad_set);
  const creativeTemplate = asPayload(resolved.plannedPayload.creative);
  const adTemplate = asPayload(resolved.plannedPayload.ad);
  if (!adSetTemplate || !creativeTemplate || !adTemplate) {
    return {
      ...empty,
      attempted: true,
      error: "keine_werbeanzeige:payload_unvollstaendig",
    };
  }

  const auth = {
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  };

  let adSetsCreated = 0;
  let creativesCreated = 0;
  let adsCreated = 0;
  let activated = 0;

  try {
    // Prefer an existing ad set — never stack a second tree under the campaign.
    let adSetId =
      input.existingAdSetIds.length > 0 ? input.existingAdSetIds[0]! : null;

    if (!adSetId) {
      const adSetPayload = pickFields(
        stripBindingRefs(
          withRepairSchedule(
            {
              ...adSetTemplate,
              campaign_id: input.campaignId,
              status: "PAUSED",
            },
            input.campaignStopTime ?? null,
          ),
        ),
        AD_SET_REPAIR_FIELDS,
      );
      const createdAdSet = await createMetaAdSet({
        ...auth,
        adAccountId: input.adAccountId,
        payload: adSetPayload,
        mode: "execute",
      });
      if (!createdAdSet.id) {
        return {
          ...empty,
          attempted: true,
          error: "keine_werbeanzeige:adset_create_ohne_id",
        };
      }
      adSetId = createdAdSet.id;
      adSetsCreated = 1;
      await upsertBinding({
        userId: input.userId,
        platformAccountId: input.platformAccountId,
        planId: resolved.planId,
        stepId: resolved.stepIds.adSet,
        objectType: "AD_SET",
        remoteObjectId: adSetId,
        requestFingerprint: createdAdSet.requestFingerprint,
        responseFingerprint: createdAdSet.responseFingerprint,
      });
    }

    const creativePayload = pickFields(
      stripBindingRefs({ ...creativeTemplate }),
      CREATIVE_REPAIR_FIELDS,
    );

    const createdCreative = await createMetaAdCreative({
      ...auth,
      adAccountId: input.adAccountId,
      payload: creativePayload,
      mode: "execute",
    });
    if (!createdCreative.id) {
      return {
        attempted: true,
        adSetsCreated,
        creativesCreated: 0,
        adsCreated: 0,
        activated: 0,
        error: "keine_werbeanzeige:creative_create_ohne_id",
        rateLimited: false,
      };
    }
    creativesCreated = 1;
    await upsertBinding({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
      planId: resolved.planId,
      stepId: resolved.stepIds.creative,
      objectType: "CREATIVE",
      remoteObjectId: createdCreative.id,
      requestFingerprint: createdCreative.requestFingerprint,
      responseFingerprint: createdCreative.responseFingerprint,
    });

    const adPayload = pickFields(
      stripBindingRefs({
        ...adTemplate,
        adset_id: adSetId,
        creative: { creative_id: createdCreative.id },
        status: "PAUSED",
      }),
      AD_REPAIR_FIELDS,
    );
    const createdAd = await createMetaAd({
      ...auth,
      adAccountId: input.adAccountId,
      payload: adPayload,
      mode: "execute",
    });
    if (!createdAd.id) {
      return {
        attempted: true,
        adSetsCreated,
        creativesCreated,
        adsCreated: 0,
        activated: 0,
        error: "keine_werbeanzeige:ad_create_ohne_id",
        rateLimited: false,
      };
    }
    adsCreated = 1;
    await upsertBinding({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
      planId: resolved.planId,
      stepId: resolved.stepIds.ad,
      objectType: "AD",
      remoteObjectId: createdAd.id,
      requestFingerprint: createdAd.requestFingerprint,
      responseFingerprint: createdAd.responseFingerprint,
    });

    await updateMetaAdSetStatus({
      ...auth,
      objectId: adSetId,
      status: "ACTIVE",
      mode: "execute",
    });
    activated += 1;
    await updateMetaAdStatus({
      ...auth,
      objectId: createdAd.id,
      status: "ACTIVE",
      mode: "execute",
    });
    activated += 1;

    return {
      attempted: true,
      adSetsCreated,
      creativesCreated,
      adsCreated,
      activated,
      error: null,
      rateLimited: false,
    };
  } catch (error) {
    const rateLimited = isRateLimited(error);
    console.error("organic_boost_missing_ad_repair_failed", {
      campaignId: input.campaignId,
      rateLimited,
      error: formatRepairError(error),
      fingerprint: fingerprint([
        input.campaignId,
        String(adSetsCreated),
        String(creativesCreated),
        String(adsCreated),
      ]),
    });
    return {
      attempted: true,
      adSetsCreated,
      creativesCreated,
      adsCreated,
      activated,
      error: formatRepairError(error),
      rateLimited,
    };
  }
}
