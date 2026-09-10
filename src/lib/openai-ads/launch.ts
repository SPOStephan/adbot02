import "server-only";

import { createHash } from "node:crypto";

import { OpenAIAdsApiError } from "@/lib/openai-ads/client";
import {
  loadOpenAIAdsClient,
  OpenAIAdsServiceError,
} from "@/lib/openai-ads/connection";
import type { parseOpenAIAdsLaunchInput } from "@/lib/openai-ads/input";
import { createAdminClient } from "@/lib/supabase/admin";

type LaunchInput = ReturnType<typeof parseOpenAIAdsLaunchInput>;

type LaunchRow = {
  id: string;
  user_id: string;
  platform_account_id: string;
  status: string;
  idempotency_key: string;
  request_payload: Record<string, unknown>;
  remote_campaign_id: string | null;
  remote_ad_group_id: string | null;
  remote_ad_id: string | null;
  remote_file_id: string | null;
  review_status: string | null;
};

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function idempotencyKey(input: LaunchInput, userId: string): string {
  return createHash("sha256")
    .update(canonicalize({ userId, ...input }))
    .digest("hex");
}

function launchPayload(input: LaunchInput) {
  return {
    campaignName: input.campaignName,
    campaignDescription: input.campaignDescription,
    biddingType: input.biddingType,
    billingEventType: input.billingEventType,
    lifetimeBudgetMicros: input.lifetimeBudgetMicros,
    dailyBudgetMicros: input.dailyBudgetMicros,
    maxBidMicros: input.maxBidMicros,
    startTime: input.startTime,
    endTime: input.endTime,
    locationIds: input.locationIds,
    adGroupName: input.adGroupName,
    contextHints: input.contextHints,
    adName: input.adName,
    title: input.title,
    body: input.body,
    targetUrl: input.targetUrl,
    imageUrl: input.imageUrl,
  };
}

async function loadOrCreateLaunch(input: {
  userId: string;
  command: LaunchInput;
  key: string;
}): Promise<LaunchRow> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("ad_platform_launches")
    .select(
      "id,user_id,platform_account_id,status,idempotency_key,request_payload,remote_campaign_id,remote_ad_group_id,remote_ad_id,remote_file_id,review_status",
    )
    .eq("platform_account_id", input.command.platformAccountId)
    .eq("idempotency_key", input.key)
    .maybeSingle();

  if (existing) {
    return existing as LaunchRow;
  }

  const { data, error } = await admin
    .from("ad_platform_launches")
    .insert({
      user_id: input.userId,
      platform_account_id: input.command.platformAccountId,
      platform: "openai_ads",
      idempotency_key: input.key,
      status: "creating",
      request_payload: launchPayload(input.command),
    })
    .select(
      "id,user_id,platform_account_id,status,idempotency_key,request_payload,remote_campaign_id,remote_ad_group_id,remote_ad_id,remote_file_id,review_status",
    )
    .single();

  if (!error && data) {
    return data as LaunchRow;
  }

  const { data: raced } = await admin
    .from("ad_platform_launches")
    .select(
      "id,user_id,platform_account_id,status,idempotency_key,request_payload,remote_campaign_id,remote_ad_group_id,remote_ad_id,remote_file_id,review_status",
    )
    .eq("platform_account_id", input.command.platformAccountId)
    .eq("idempotency_key", input.key)
    .maybeSingle();

  if (!raced) {
    throw new OpenAIAdsServiceError(
      "launch_storage_failed",
      500,
      "Der ACTIVE-Launch konnte nicht sicher angelegt werden.",
    );
  }
  return raced as LaunchRow;
}

async function updateLaunch(id: string, values: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("ad_platform_launches")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    throw new OpenAIAdsServiceError(
      "launch_state_failed",
      500,
      "Der OpenAI-Ads-Launchstatus konnte nicht sicher gespeichert werden.",
    );
  }
}

export async function createActiveOpenAIAdsLaunch(input: {
  userId: string;
  command: LaunchInput;
}) {
  const key = idempotencyKey(input.command, input.userId);
  let launch = await loadOrCreateLaunch({ ...input, key });
  if (["in_review", "active"].includes(launch.status)) {
    return {
      launchId: launch.id,
      status: launch.status,
      reviewStatus: launch.review_status,
      campaignId: launch.remote_campaign_id,
      adGroupId: launch.remote_ad_group_id,
      adId: launch.remote_ad_id,
      alreadyExisted: true,
    };
  }

  const loaded = await loadOpenAIAdsClient({
    platformAccountId: input.command.platformAccountId,
    userId: input.userId,
  });
  const account = await loaded.client.getAdAccount();
  if (account.id !== loaded.connection.platform_account_id) {
    await updateLaunch(launch.id, {
      status: "blocked",
      error_code: "remote_account_mismatch",
    });
    throw new OpenAIAdsServiceError(
      "remote_account_mismatch",
      409,
      "Der API-Key gehört nicht zum erwarteten OpenAI-Ads-Konto.",
    );
  }
  if (account.status !== "active") {
    await updateLaunch(launch.id, {
      status: "blocked",
      error_code: "account_not_active",
    });
    throw new OpenAIAdsServiceError(
      "account_not_active",
      409,
      "Das OpenAI-Ads-Konto ist noch nicht aktiv.",
    );
  }
  if (account.review.status !== "approved") {
    await updateLaunch(launch.id, {
      status: "blocked",
      error_code: "account_review_required",
    });
    throw new OpenAIAdsServiceError(
      "account_review_required",
      409,
      "Die Markenprüfung des OpenAI-Ads-Kontos muss vor einem Launch genehmigt sein.",
    );
  }

  const suffix = key.slice(0, 10);
  try {
    if (!launch.remote_file_id) {
      const fileId = await loaded.client.uploadImageUrl(
        input.command.imageUrl,
        `${key}-image`,
      );
      launch = { ...launch, remote_file_id: fileId };
      await updateLaunch(launch.id, { remote_file_id: fileId });
    }

    if (!launch.remote_campaign_id) {
      const campaign = await loaded.client.createCampaign(
        {
          name: `${input.command.campaignName} [adbot:${suffix}]`,
          description: input.command.campaignDescription,
          status: "active",
          budget: {
            lifetime_spend_limit_micros: input.command.lifetimeBudgetMicros,
            daily_spend_limit_micros: input.command.dailyBudgetMicros,
          },
          bidding_type: input.command.biddingType,
          ...(input.command.startTime ? { start_time: input.command.startTime } : {}),
          ...(input.command.endTime ? { end_time: input.command.endTime } : {}),
          targeting: {
            locations: {
              include: input.command.locationIds.map((id) => ({ id })),
            },
          },
        },
        `${key}-campaign`,
      );
      launch = { ...launch, remote_campaign_id: campaign.id };
      await updateLaunch(launch.id, { remote_campaign_id: campaign.id });
    }

    if (!launch.remote_ad_group_id) {
      const adGroup = await loaded.client.createAdGroup(
        {
          campaign_id: launch.remote_campaign_id,
          name: `${input.command.adGroupName} [adbot:${suffix}]`,
          description: input.command.campaignDescription,
          context_hints: input.command.contextHints,
          status: "active",
          bidding_config: {
            billing_event_type: input.command.billingEventType,
            max_bid_micros: input.command.maxBidMicros,
          },
        },
        `${key}-ad-group`,
      );
      launch = { ...launch, remote_ad_group_id: adGroup.id };
      await updateLaunch(launch.id, { remote_ad_group_id: adGroup.id });
    }

    if (!launch.remote_ad_id) {
      const ad = await loaded.client.createAd(
        {
          ad_group_id: launch.remote_ad_group_id,
          name: `${input.command.adName} [adbot:${suffix}]`,
          status: "active",
          creative: {
            type: "chat_card",
            title: input.command.title,
            body: input.command.body,
            target_url: input.command.targetUrl,
            file_id: launch.remote_file_id,
          },
        },
        `${key}-ad`,
      );
      launch = {
        ...launch,
        remote_ad_id: ad.id,
        review_status: ad.review_status,
      };
      await updateLaunch(launch.id, {
        remote_ad_id: ad.id,
        review_status: ad.review_status,
      });
    }

    const [remoteCampaign, remoteAdGroup, remoteAd] = await Promise.all([
      loaded.client.getCampaign(launch.remote_campaign_id!),
      loaded.client.getAdGroup(launch.remote_ad_group_id!),
      loaded.client.getAd(launch.remote_ad_id!),
    ]);
    if (
      remoteCampaign.status !== "active" ||
      remoteAdGroup.status !== "active" ||
      remoteAd.status !== "active"
    ) {
      throw new OpenAIAdsServiceError(
        "active_launch_reconciliation_failed",
        502,
        "OpenAI Ads hat den ACTIVE-Status der vollständigen Kampagnenkette nicht bestätigt.",
      );
    }
    if (
      remoteAd.review_status === "approved" &&
      ((remoteCampaign.serving_issues?.length ?? 0) > 0 ||
        (remoteAdGroup.serving_issues?.length ?? 0) > 0 ||
        (remoteAd.serving_issues?.length ?? 0) > 0)
    ) {
      throw new OpenAIAdsServiceError(
        "provider_serving_issue",
        409,
        "OpenAI Ads meldet ein Auslieferungsproblem. Die Kette wird sicherheitshalber pausiert.",
      );
    }
    const status =
      remoteAd.review_status === "approved"
        ? "active"
        : remoteAd.review_status === "rejected"
          ? "blocked"
          : "in_review";
    if (status === "blocked") {
      await loaded.client.pauseCampaign(launch.remote_campaign_id!);
      await loaded.client.pauseAdGroup(launch.remote_ad_group_id!);
      await loaded.client.pauseAd(launch.remote_ad_id!);
    }
    await updateLaunch(launch.id, {
      status,
      review_status: remoteAd.review_status,
      activated_at: status === "blocked" ? null : new Date().toISOString(),
      error_code:
        remoteAd.review_status === "rejected" ? "ad_review_rejected" : null,
    });

    return {
      launchId: launch.id,
      status,
      reviewStatus: remoteAd.review_status,
      campaignId: launch.remote_campaign_id,
      adGroupId: launch.remote_ad_group_id,
      adId: launch.remote_ad_id,
      alreadyExisted: false,
    };
  } catch (error) {
    const code =
      error instanceof OpenAIAdsApiError
        ? error.code ?? "provider_launch_failed"
        : error instanceof OpenAIAdsServiceError
          ? error.code
          : "launch_failed";
    let safetyPauseConfirmed = true;
    try {
      if (launch.remote_campaign_id) {
        await loaded.client.pauseCampaign(launch.remote_campaign_id);
      }
      if (launch.remote_ad_group_id) {
        await loaded.client.pauseAdGroup(launch.remote_ad_group_id);
      }
      if (launch.remote_ad_id) {
        await loaded.client.pauseAd(launch.remote_ad_id);
      }
    } catch {
      safetyPauseConfirmed = false;
    }
    await updateLaunch(launch.id, {
      status: safetyPauseConfirmed ? "failed" : "activation_uncertain",
      error_code: safetyPauseConfirmed
        ? `${code}_safely_paused`
        : "activation_uncertain_manual_check_required",
    }).catch(() => undefined);
    if (!safetyPauseConfirmed) {
      throw new OpenAIAdsServiceError(
        "activation_uncertain_manual_check_required",
        502,
        "Der ACTIVE-Launch konnte nicht eindeutig zurückgenommen werden. Bitte sofort im OpenAI Ads Manager prüfen und pausieren.",
      );
    }
    throw error;
  }
}

export async function activateOpenAIAdsLaunch(input: {
  userId: string;
  launchId: string;
}) {
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin
    .from("ad_platform_launches")
    .update({
      status: "activating",
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.launchId)
    .eq("user_id", input.userId)
    .eq("platform", "openai_ads")
    .in("status", ["paused", "in_review", "ready_to_activate", "blocked"])
    .select(
      "id,user_id,platform_account_id,status,idempotency_key,request_payload,remote_campaign_id,remote_ad_group_id,remote_ad_id,remote_file_id,review_status",
    )
    .maybeSingle();

  if (claimError) {
    throw new OpenAIAdsServiceError(
      "activation_claim_failed",
      500,
      "Die Aktivierung konnte nicht sicher beansprucht werden.",
    );
  }
  if (!claimed) {
    const { data: existing } = await admin
      .from("ad_platform_launches")
      .select("status")
      .eq("id", input.launchId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (existing?.status === "active") {
      return { status: "active", alreadyActive: true };
    }
    throw new OpenAIAdsServiceError(
      "activation_not_available",
      409,
      "Dieser Launch kann in seinem aktuellen Zustand nicht aktiviert werden.",
    );
  }

  const launch = claimed as LaunchRow;
  if (
    !launch.remote_campaign_id ||
    !launch.remote_ad_group_id ||
    !launch.remote_ad_id
  ) {
    await updateLaunch(launch.id, {
      status: "failed",
      error_code: "remote_chain_incomplete",
    });
    throw new OpenAIAdsServiceError(
      "remote_chain_incomplete",
      409,
      "Der pausierte OpenAI-Ads-Entwurf ist noch nicht vollständig.",
    );
  }

  let loaded: Awaited<ReturnType<typeof loadOpenAIAdsClient>> | null = null;
  let activationStarted = false;
  let stateHandled = false;
  try {
    loaded = await loadOpenAIAdsClient({
      platformAccountId: launch.platform_account_id,
      userId: input.userId,
    });
    const account = await loaded.client.getAdAccount();
    if (account.id !== loaded.connection.platform_account_id) {
      await updateLaunch(launch.id, {
        status: "blocked",
        error_code: "remote_account_mismatch",
      });
      stateHandled = true;
      throw new OpenAIAdsServiceError(
        "remote_account_mismatch",
        409,
        "Der API-Key gehört nicht zum erwarteten OpenAI-Ads-Konto.",
      );
    }
    if (account.status !== "active" || account.review.status !== "approved") {
      await updateLaunch(launch.id, {
        status: "blocked",
        error_code: "account_not_serving_ready",
      });
      stateHandled = true;
      throw new OpenAIAdsServiceError(
        "account_not_serving_ready",
        409,
        "Konto und Markenprüfung müssen unmittelbar vor der Aktivierung freigegeben sein.",
      );
    }

    const [campaignBefore, adGroupBefore, ad] = await Promise.all([
      loaded.client.getCampaign(launch.remote_campaign_id),
      loaded.client.getAdGroup(launch.remote_ad_group_id),
      loaded.client.getAd(launch.remote_ad_id),
    ]);
    if (ad.review_status !== "approved") {
      await updateLaunch(launch.id, {
        status: ad.review_status === "rejected" ? "blocked" : "in_review",
        review_status: ad.review_status,
        error_code:
          ad.review_status === "rejected" ? "ad_review_rejected" : null,
      });
      stateHandled = true;
      throw new OpenAIAdsServiceError(
        ad.review_status === "rejected" ? "ad_review_rejected" : "ad_in_review",
        409,
        ad.review_status === "rejected"
          ? "OpenAI hat die Anzeige abgelehnt. Bitte Creative und Richtlinien prüfen."
          : "Die Anzeige befindet sich noch in Prüfung und kann noch nicht aktiviert werden.",
      );
    }
    if (
      (campaignBefore.serving_issues?.length ?? 0) > 0 ||
      (adGroupBefore.serving_issues?.length ?? 0) > 0 ||
      (ad.serving_issues?.length ?? 0) > 0
    ) {
      await updateLaunch(launch.id, {
        status: "blocked",
        error_code: "provider_serving_issue",
      });
      stateHandled = true;
      throw new OpenAIAdsServiceError(
        "provider_serving_issue",
        409,
        "OpenAI Ads meldet ein Auslieferungsproblem. Bitte zuerst den Ads Manager prüfen.",
      );
    }

    activationStarted = true;
    await loaded.client.activateAd(launch.remote_ad_id);
    await loaded.client.activateAdGroup(launch.remote_ad_group_id);
    await loaded.client.activateCampaign(launch.remote_campaign_id);

    const [confirmedCampaign, confirmedAdGroup, confirmedAd] = await Promise.all([
      loaded.client.getCampaign(launch.remote_campaign_id),
      loaded.client.getAdGroup(launch.remote_ad_group_id),
      loaded.client.getAd(launch.remote_ad_id),
    ]);
    if (
      confirmedCampaign.status !== "active" ||
      confirmedAdGroup.status !== "active" ||
      confirmedAd.status !== "active" ||
      confirmedAd.review_status !== "approved"
    ) {
      throw new OpenAIAdsServiceError(
        "activation_reconciliation_failed",
        502,
        "OpenAI Ads hat die vollständige Aktivierung nicht bestätigt.",
      );
    }

    await updateLaunch(launch.id, {
      status: "active",
      review_status: confirmedAd.review_status,
      activated_at: new Date().toISOString(),
      error_code: null,
    });
    return { status: "active", alreadyActive: false };
  } catch (error) {
    if (stateHandled) {
      throw error;
    }
    if (!activationStarted || !loaded) {
      await updateLaunch(launch.id, {
        status: "ready_to_activate",
        error_code: "activation_precheck_failed",
      }).catch(() => undefined);
      throw error;
    }

    let safetyPauseConfirmed = true;
    try {
      await loaded.client.pauseCampaign(launch.remote_campaign_id);
      await loaded.client.pauseAdGroup(launch.remote_ad_group_id);
      await loaded.client.pauseAd(launch.remote_ad_id);
    } catch {
      safetyPauseConfirmed = false;
    }

    await updateLaunch(launch.id, {
      status: safetyPauseConfirmed ? "failed" : "activation_uncertain",
      error_code: safetyPauseConfirmed
        ? "activation_failed_safely_paused"
        : "activation_uncertain_manual_check_required",
    });

    if (!safetyPauseConfirmed) {
      throw new OpenAIAdsServiceError(
        "activation_uncertain_manual_check_required",
        502,
        "Der Aktivierungsstatus ist nicht eindeutig. Bitte sofort im OpenAI Ads Manager prüfen und die Kampagne dort pausieren.",
      );
    }
    throw error;
  }
}
