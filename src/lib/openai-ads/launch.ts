import "server-only";

import { createHash } from "node:crypto";

import {
  OpenAIAdsApiError,
  type OpenAIAdsAccount,
  type OpenAIAdsAd,
  type OpenAIAdsAdGroup,
  type OpenAIAdsCampaign,
  type OpenAIAdsClient,
} from "@/lib/openai-ads/client";
import {
  loadOpenAIAdsClient,
  OpenAIAdsServiceError,
} from "@/lib/openai-ads/connection";
import type { parseOpenAIAdsLaunchInput } from "@/lib/openai-ads/input";
import { getOpenAIAdsEnv } from "@/lib/openai-ads/env";
import {
  accountLocalDateToUnix,
  budgetSummary,
  buildPausedAdGroupPayload,
  buildPausedAdPayload,
  buildPausedCampaignPayload,
  issueOpenAIAdsActivationPreviewToken,
  openAIAdsLaunchContractHash,
  openAIAdsProviderPreviewHash,
  OPENAI_ADS_LAUNCH_CONTRACT,
  parseStoredOpenAIAdsLaunchContract,
  type OpenAIAdsLaunchReadback,
  type OpenAIAdsLaunchValidation,
  type StoredOpenAIAdsLaunchContract,
  validateOpenAIAdsLaunchReadback,
  verifyOpenAIAdsActivationPreviewToken,
} from "@/lib/openai-ads/launch-safety";
import { createAdminClient } from "@/lib/supabase/admin";

type LaunchInput = ReturnType<typeof parseOpenAIAdsLaunchInput>;

const ACTIVATION_DEADLINE_MS = 60_000;
const ACTIVATION_SAFETY_DEADLINE_MS = 45_000;
const CREATE_DEADLINE_MS = 120_000;
const PREVIEW_DEADLINE_MS = 90_000;

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
  operation_token: string | null;
  operation_started_at: string | null;
};

const LAUNCH_ROW_SELECT =
  "id,user_id,platform_account_id,status,idempotency_key,request_payload,remote_campaign_id,remote_ad_group_id,remote_ad_id,remote_file_id,review_status,operation_token,operation_started_at";

function hasCompleteRemoteChain(launch: LaunchRow): boolean {
  return Boolean(
    launch.remote_campaign_id &&
      launch.remote_ad_group_id &&
      launch.remote_ad_id,
  );
}

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

function launchPayload(
  input: LaunchInput,
  account: { id: string; currency_code: string; timezone: string },
  schedule: { startTime: number | null; endTime: number | null },
  key: string,
) {
  const suffix = key.slice(0, 10);
  return {
    contractVersion: OPENAI_ADS_LAUNCH_CONTRACT,
    remoteAccountId: account.id,
    currency: account.currency_code,
    accountTimezone: account.timezone,
    campaignName: `${input.campaignName} [adbot:${suffix}]`,
    campaignDescription: input.campaignDescription,
    biddingType: input.biddingType,
    billingEventType: input.billingEventType,
    dailyBudgetMicros: input.dailyBudgetMicros,
    maxBidMicros: input.maxBidMicros,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    locationIds: input.locationIds,
    adGroupName: `${input.adGroupName} [adbot:${suffix}]`,
    contextHints: input.contextHints,
    adName: `${input.adName} [adbot:${suffix}]`,
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
  account: { id: string; currency_code: string; timezone: string };
  schedule: { startTime: number | null; endTime: number | null };
}): Promise<LaunchRow> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("ad_platform_launches")
    .select(LAUNCH_ROW_SELECT)
    .eq("platform_account_id", input.command.platformAccountId)
    .eq("user_id", input.userId)
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
      request_payload: launchPayload(
        input.command,
        input.account,
        input.schedule,
        input.key,
      ),
    })
    .select(LAUNCH_ROW_SELECT)
    .single();

  if (!error && data) {
    return data as LaunchRow;
  }

  const { data: raced } = await admin
    .from("ad_platform_launches")
    .select(LAUNCH_ROW_SELECT)
    .eq("platform_account_id", input.command.platformAccountId)
    .eq("user_id", input.userId)
    .eq("idempotency_key", input.key)
    .maybeSingle();

  if (!raced) {
    throw new OpenAIAdsServiceError(
      "launch_storage_failed",
      500,
      "Der pausierte OpenAI-Ads-Entwurf konnte nicht sicher angelegt werden.",
    );
  }
  return raced as LaunchRow;
}

async function pauseAndVerifyLaunchChain(
  client: OpenAIAdsClient,
  launch: LaunchRow,
): Promise<boolean> {
  const pauseOperations: Promise<unknown>[] = [];
  if (launch.remote_campaign_id) {
    pauseOperations.push(client.pauseCampaign(launch.remote_campaign_id));
  }
  if (launch.remote_ad_group_id) {
    pauseOperations.push(client.pauseAdGroup(launch.remote_ad_group_id));
  }
  if (launch.remote_ad_id) {
    pauseOperations.push(client.pauseAd(launch.remote_ad_id));
  }
  await Promise.allSettled(pauseOperations);

  const verificationOperations: Promise<{
    expectedId: string;
    value: { id: string; status: string };
  }>[] = [];
  if (launch.remote_campaign_id) {
    const expectedId = launch.remote_campaign_id;
    verificationOperations.push(
      client.getCampaign(expectedId).then((value) => ({ expectedId, value })),
    );
  }
  if (launch.remote_ad_group_id) {
    const expectedId = launch.remote_ad_group_id;
    verificationOperations.push(
      client.getAdGroup(expectedId).then((value) => ({ expectedId, value })),
    );
  }
  if (launch.remote_ad_id) {
    const expectedId = launch.remote_ad_id;
    verificationOperations.push(
      client.getAd(expectedId).then((value) => ({ expectedId, value })),
    );
  }

  if (verificationOperations.length === 0) {
    return false;
  }

  const verification = await Promise.allSettled(verificationOperations);
  return verification.every(
    (result) =>
      result.status === "fulfilled" &&
      result.value.value.id === result.value.expectedId &&
      result.value.value.status === "paused",
  );
}

async function pauseWithSafetyClient(input: {
  launch: LaunchRow;
  userId: string;
}): Promise<boolean> {
  return loadOpenAIAdsClient({
    platformAccountId: input.launch.platform_account_id,
    userId: input.userId,
    deadlineAtMs: Date.now() + ACTIVATION_SAFETY_DEADLINE_MS,
  })
    .then(({ client }) => pauseAndVerifyLaunchChain(client, input.launch))
    .catch(() => false);
}

function requireLaunchContract(launch: LaunchRow): StoredOpenAIAdsLaunchContract {
  const contract = parseStoredOpenAIAdsLaunchContract(launch.request_payload);
  if (!contract) {
    throw new OpenAIAdsServiceError(
      "launch_contract_invalid",
      409,
      "Dieser Launch besitzt keinen gültigen pausierten Daily-Budget-Vertrag und kann nicht aktiviert werden.",
    );
  }
  return contract;
}

function assertLaunchValidation(result: OpenAIAdsLaunchValidation): void {
  if (!result.ok) {
    throw new OpenAIAdsServiceError(result.code, 409, result.message);
  }
}

async function readLaunchChain(
  client: OpenAIAdsClient,
  launch: LaunchRow,
): Promise<OpenAIAdsLaunchReadback> {
  if (
    !launch.remote_campaign_id ||
    !launch.remote_ad_group_id ||
    !launch.remote_ad_id ||
    !launch.remote_file_id
  ) {
    throw new OpenAIAdsServiceError(
      "remote_chain_incomplete",
      409,
      "Der pausierte OpenAI-Ads-Entwurf ist noch nicht vollständig.",
    );
  }
  const [account, campaign, adGroup, ad, campaignAdGroups, adGroupAds] =
    await Promise.all([
    client.getAdAccount(),
    client.getCampaign(launch.remote_campaign_id),
    client.getAdGroup(launch.remote_ad_group_id),
    client.getAd(launch.remote_ad_id),
    client.listAdGroups(launch.remote_campaign_id),
    client.listAds(launch.remote_ad_group_id),
  ]);
  return {
    account,
    campaign,
    adGroup,
    ad,
    parentageVerified:
      campaignAdGroups.some((item) => item.id === launch.remote_ad_group_id) &&
      adGroupAds.some((item) => item.id === launch.remote_ad_id),
  };
}

function validateLaunchChain(input: {
  launch: LaunchRow;
  contract: StoredOpenAIAdsLaunchContract;
  readback: OpenAIAdsLaunchReadback;
  expectedStatus: "paused" | "active";
  requireApprovedAd: boolean;
}): OpenAIAdsLaunchValidation {
  return validateOpenAIAdsLaunchReadback({
    contract: input.contract,
    expectedCampaignId: input.launch.remote_campaign_id!,
    expectedAdGroupId: input.launch.remote_ad_group_id!,
    expectedAdId: input.launch.remote_ad_id!,
    expectedFileId: input.launch.remote_file_id!,
    readback: input.readback,
    expectedStatus: input.expectedStatus,
    requireApprovedAd: input.requireApprovedAd,
  });
}

async function claimLaunchOperation(input: {
  launchId: string;
  userId: string;
  fromStatuses: string[];
  toStatus: "creating" | "activating";
}): Promise<LaunchRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_openai_ads_launch_operation", {
    p_launch_id: input.launchId,
    p_user_id: input.userId,
    p_from_statuses: input.fromStatuses,
    p_to_status: input.toStatus,
    p_stale_after_seconds: 300,
  });
  if (error) {
    throw new OpenAIAdsServiceError(
      "launch_claim_failed",
      500,
      "Der OpenAI-Ads-Vorgang konnte nicht atomar beansprucht werden.",
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as LaunchRow) : null;
}

async function updateClaimedLaunch(
  launch: LaunchRow,
  values: Record<string, unknown>,
  finish = false,
): Promise<LaunchRow> {
  if (!launch.operation_token) {
    throw new OpenAIAdsServiceError(
      "launch_claim_lost",
      409,
      "Der OpenAI-Ads-Vorgang besitzt keinen gültigen Operationstoken.",
    );
  }
  const admin = createAdminClient();
  if (finish) {
    const { data: finished, error: finishError } = await admin.rpc(
      "finish_openai_ads_launch_operation",
      {
        p_launch_id: launch.id,
        p_operation_token: launch.operation_token,
        p_values: values,
      },
    );
    if (finishError || finished !== true) {
      throw new OpenAIAdsServiceError(
        "launch_claim_lost",
        409,
        "Der OpenAI-Ads-Vorgang wurde parallel verändert und sicher abgebrochen.",
      );
    }
    const { data, error } = await admin
      .from("ad_platform_launches")
      .select(LAUNCH_ROW_SELECT)
      .eq("id", launch.id)
      .maybeSingle();
    if (error || !data) {
      throw new OpenAIAdsServiceError(
        "launch_state_failed",
        500,
        "Der abgeschlossene OpenAI-Ads-Launchstatus konnte nicht gelesen werden.",
      );
    }
    return data as LaunchRow;
  }
  const { data, error } = await admin
    .from("ad_platform_launches")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", launch.id)
    .eq("operation_token", launch.operation_token)
    .select(LAUNCH_ROW_SELECT)
    .maybeSingle();
  if (error || !data) {
    throw new OpenAIAdsServiceError(
      "launch_claim_lost",
      409,
      "Der OpenAI-Ads-Vorgang wurde parallel verändert und sicher abgebrochen.",
    );
  }
  return data as LaunchRow;
}

export async function createPausedOpenAIAdsLaunch(input: {
  userId: string;
  command: LaunchInput;
}) {
  const key = idempotencyKey(input.command, input.userId);
  const loaded = await loadOpenAIAdsClient({
    platformAccountId: input.command.platformAccountId,
    userId: input.userId,
    deadlineAtMs: Date.now() + CREATE_DEADLINE_MS,
  });
  const account = await loaded.client.getAdAccount();
  if (account.id !== loaded.connection.platform_account_id) {
    throw new OpenAIAdsServiceError(
      "remote_account_mismatch",
      409,
      "Der API-Key gehört nicht zum erwarteten OpenAI-Ads-Konto.",
    );
  }
  if (account.status !== "active") {
    throw new OpenAIAdsServiceError(
      "account_not_active",
      409,
      "Das OpenAI-Ads-Konto ist noch nicht aktiv.",
    );
  }
  if (account.review.status !== "approved") {
    throw new OpenAIAdsServiceError(
      "account_review_required",
      409,
      "Die Markenprüfung des OpenAI-Ads-Kontos muss vor einem Launch genehmigt sein.",
    );
  }
  if (
    account.account_integrity_review !== null &&
    account.account_integrity_review.review.status !== "approved"
  ) {
    throw new OpenAIAdsServiceError(
      "account_integrity_review_required",
      409,
      "Die separate OpenAI-Kontoprüfung muss vor einem Launch genehmigt sein.",
    );
  }
  const schedule = {
    startTime: accountLocalDateToUnix(
      input.command.startDate,
      account.timezone,
    ),
    endTime: accountLocalDateToUnix(input.command.endDate, account.timezone),
  };
  if (
    (input.command.startDate !== null && schedule.startTime === null) ||
    (input.command.endDate !== null && schedule.endTime === null) ||
    (schedule.startTime !== null &&
      schedule.endTime !== null &&
      schedule.endTime <= schedule.startTime)
  ) {
    throw new OpenAIAdsServiceError(
      "account_timezone_schedule_invalid",
      409,
      "Start- und Enddatum konnten nicht sicher in der Zeitzone des OpenAI-Ads-Kontos aufgelöst werden.",
    );
  }

  let launch = await loadOrCreateLaunch({ ...input, key, account, schedule });
  if (
    ["paused", "in_review", "ready_to_activate", "blocked", "active"].includes(
      launch.status,
    )
  ) {
    const replayStatus = launch.status;
    const replayClaim = await claimLaunchOperation({
      launchId: launch.id,
      userId: input.userId,
      fromStatuses: [replayStatus],
      toStatus: "activating",
    });
    if (!replayClaim) {
      throw new OpenAIAdsServiceError(
        "launch_already_running",
        409,
        "Dieser identische Launch wird bereits sicher überprüft.",
      );
    }
    launch = replayClaim;
    try {
      const contract = requireLaunchContract(launch);
      const readback = await readLaunchChain(loaded.client, launch);
      assertLaunchValidation(
        validateLaunchChain({
          launch,
          contract,
          readback,
          expectedStatus: replayStatus === "active" ? "active" : "paused",
          requireApprovedAd: replayStatus === "active",
        }),
      );
      const verifiedStatus =
        replayStatus === "active"
          ? "active"
          : readback.ad.review_status === "approved"
            ? "ready_to_activate"
            : readback.ad.review_status === "rejected"
              ? "blocked"
              : "in_review";
      launch = await updateClaimedLaunch(
        launch,
        {
          status: verifiedStatus,
          review_status: readback.ad.review_status,
          error_code:
            readback.ad.review_status === "rejected"
              ? "ad_review_rejected"
              : null,
        },
        true,
      );
    } catch (error) {
      const paused = await pauseWithSafetyClient({
        launch,
        userId: input.userId,
      });
      const safelyContained = paused && hasCompleteRemoteChain(launch);
      await updateClaimedLaunch(
        launch,
        {
          status: safelyContained ? "failed" : "activation_uncertain",
          error_code: safelyContained
            ? "create_replay_drift_safely_paused"
            : "activation_uncertain_manual_check_required",
        },
        true,
      ).catch(() => undefined);
      if (!safelyContained) {
        throw new OpenAIAdsServiceError(
          "activation_uncertain_manual_check_required",
          502,
          "Der vorhandene OpenAI-Launch weicht vom gespeicherten Vertrag ab und konnte nicht sicher pausiert werden. Bitte sofort im OpenAI Ads Manager prüfen.",
        );
      }
      throw error;
    }
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
  const claimedLaunch = await claimLaunchOperation({
    launchId: launch.id,
    userId: input.userId,
    fromStatuses: ["creating", "failed"],
    toStatus: "creating",
  });
  if (!claimedLaunch) {
    throw new OpenAIAdsServiceError(
      "launch_already_running",
      409,
      "Dieser identische pausierte Launch wird bereits sicher erstellt.",
    );
  }
  launch = claimedLaunch;

  const suffix = key.slice(0, 10);
  let remoteCreateOutcomeUncertain = false;
  try {
    if (!launch.remote_file_id) {
      const fileId = await loaded.client.uploadImageUrl(
        input.command.imageUrl,
        `${key}-image`,
      );
      launch = { ...launch, remote_file_id: fileId };
      launch = await updateClaimedLaunch(launch, { remote_file_id: fileId });
    }

    if (!launch.remote_campaign_id) {
      remoteCreateOutcomeUncertain = true;
      const campaign = await loaded.client.createCampaign(
        buildPausedCampaignPayload({
          name: `${input.command.campaignName} [adbot:${suffix}]`,
          description: input.command.campaignDescription,
          biddingType: input.command.biddingType,
          dailyBudgetMicros: input.command.dailyBudgetMicros,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          locationIds: input.command.locationIds,
        }),
        `${key}-campaign`,
      );
      remoteCreateOutcomeUncertain = false;
      launch = { ...launch, remote_campaign_id: campaign.id };
      if (campaign.status !== "paused") {
        throw new OpenAIAdsServiceError(
          "campaign_create_not_paused",
          502,
          "OpenAI hat die neue Campaign nicht eindeutig PAUSED zurückgegeben.",
        );
      }
      launch = await updateClaimedLaunch(launch, {
        remote_campaign_id: campaign.id,
      });
      const confirmedCampaign = await loaded.client.getCampaign(campaign.id);
      if (confirmedCampaign.id !== campaign.id || confirmedCampaign.status !== "paused") {
        throw new OpenAIAdsServiceError(
          "campaign_create_not_paused",
          502,
          "OpenAI hat die neue Campaign vor dem nächsten Create nicht als PAUSED bestätigt.",
        );
      }
    }

    if (!launch.remote_ad_group_id) {
      remoteCreateOutcomeUncertain = true;
      const adGroup = await loaded.client.createAdGroup(
        buildPausedAdGroupPayload({
          campaignId: launch.remote_campaign_id!,
          name: `${input.command.adGroupName} [adbot:${suffix}]`,
          description: input.command.campaignDescription,
          contextHints: input.command.contextHints,
          billingEventType: input.command.billingEventType,
          maxBidMicros: input.command.maxBidMicros,
        }),
        `${key}-ad-group`,
      );
      remoteCreateOutcomeUncertain = false;
      launch = { ...launch, remote_ad_group_id: adGroup.id };
      if (adGroup.status !== "paused") {
        throw new OpenAIAdsServiceError(
          "ad_group_create_not_paused",
          502,
          "OpenAI hat die neue Ad Group nicht eindeutig PAUSED zurückgegeben.",
        );
      }
      launch = await updateClaimedLaunch(launch, {
        remote_ad_group_id: adGroup.id,
      });
      const confirmedAdGroup = await loaded.client.getAdGroup(adGroup.id);
      if (confirmedAdGroup.id !== adGroup.id || confirmedAdGroup.status !== "paused") {
        throw new OpenAIAdsServiceError(
          "ad_group_create_not_paused",
          502,
          "OpenAI hat die neue Ad Group vor dem nächsten Create nicht als PAUSED bestätigt.",
        );
      }
    }

    if (!launch.remote_ad_id) {
      remoteCreateOutcomeUncertain = true;
      const ad = await loaded.client.createAd(
        buildPausedAdPayload({
          adGroupId: launch.remote_ad_group_id!,
          name: `${input.command.adName} [adbot:${suffix}]`,
          title: input.command.title,
          body: input.command.body,
          targetUrl: input.command.targetUrl,
          fileId: launch.remote_file_id!,
        }),
        `${key}-ad`,
      );
      remoteCreateOutcomeUncertain = false;
      launch = {
        ...launch,
        remote_ad_id: ad.id,
        review_status: ad.review_status,
      };
      if (ad.status !== "paused") {
        throw new OpenAIAdsServiceError(
          "ad_create_not_paused",
          502,
          "OpenAI hat die neue Ad nicht eindeutig PAUSED zurückgegeben.",
        );
      }
      launch = await updateClaimedLaunch(launch, {
        remote_ad_id: ad.id,
        review_status: ad.review_status,
      });
      const confirmedAd = await loaded.client.getAd(ad.id);
      if (confirmedAd.id !== ad.id || confirmedAd.status !== "paused") {
        throw new OpenAIAdsServiceError(
          "ad_create_not_paused",
          502,
          "OpenAI hat die neue Ad vor dem finalen Read-back nicht als PAUSED bestätigt.",
        );
      }
    }

    const contract = requireLaunchContract(launch);
    const readback = await readLaunchChain(loaded.client, launch);
    assertLaunchValidation(
      validateLaunchChain({
        launch,
        contract,
        readback,
        expectedStatus: "paused",
        requireApprovedAd: false,
      }),
    );
    const status =
      readback.ad.review_status === "approved"
        ? "ready_to_activate"
        : readback.ad.review_status === "rejected"
          ? "blocked"
          : "in_review";
    launch = await updateClaimedLaunch(launch, {
      status,
      review_status: readback.ad.review_status,
      activated_at: null,
      error_code:
        readback.ad.review_status === "rejected" ? "ad_review_rejected" : null,
    }, true);

    return {
      launchId: launch.id,
      status,
      reviewStatus: readback.ad.review_status,
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
    const safetyPauseConfirmed = await pauseWithSafetyClient({
      launch,
      userId: input.userId,
    });
    const safelyContained =
      safetyPauseConfirmed && !remoteCreateOutcomeUncertain;
    await updateClaimedLaunch(launch, {
      status: safelyContained ? "failed" : "activation_uncertain",
      remote_file_id: launch.remote_file_id,
      remote_campaign_id: launch.remote_campaign_id,
      remote_ad_group_id: launch.remote_ad_group_id,
      remote_ad_id: launch.remote_ad_id,
      review_status: launch.review_status,
      error_code: safelyContained
        ? `${code}_safely_paused`
        : "activation_uncertain_manual_check_required",
    }, true).catch(() => undefined);
    if (!safelyContained) {
      throw new OpenAIAdsServiceError(
        "activation_uncertain_manual_check_required",
        502,
        "Der pausierte Launch konnte nicht eindeutig bestätigt werden. Bitte sofort im OpenAI Ads Manager prüfen und pausieren.",
      );
    }
    throw error;
  }
}

export async function previewOpenAIAdsActivation(input: {
  userId: string;
  launchId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_platform_launches")
    .select(LAUNCH_ROW_SELECT)
    .eq("id", input.launchId)
    .eq("user_id", input.userId)
    .eq("platform", "openai_ads")
    .in("status", ["paused", "in_review", "ready_to_activate", "blocked"])
    .maybeSingle();
  if (error) {
    throw new OpenAIAdsServiceError(
      "activation_preview_failed",
      500,
      "Die Aktivierungsvorschau konnte nicht sicher geladen werden.",
    );
  }
  if (!data) {
    throw new OpenAIAdsServiceError(
      "activation_not_available",
      409,
      "Dieser Launch kann in seinem aktuellen Zustand nicht aktiviert werden.",
    );
  }

  const launch = data as LaunchRow;
  const contract = requireLaunchContract(launch);
  const loaded = await loadOpenAIAdsClient({
    platformAccountId: launch.platform_account_id,
    userId: input.userId,
    deadlineAtMs: Date.now() + PREVIEW_DEADLINE_MS,
  });
  const readback = await readLaunchChain(loaded.client, launch);
  assertLaunchValidation(
    validateLaunchChain({
      launch,
      contract,
      readback,
      expectedStatus: "paused",
      requireApprovedAd: true,
    }),
  );
  const providerPreview = await loaded.client.previewAd(launch.remote_ad_id!);
  const providerPreviewHash = openAIAdsProviderPreviewHash(
    providerPreview.bodies,
  );
  if (!providerPreviewHash) {
    throw new OpenAIAdsServiceError(
      "provider_preview_invalid",
      502,
      "OpenAI Ads hat keine sicher prüfbare Anzeigenvorschau geliefert.",
    );
  }
  const budget = budgetSummary({
    currency: contract.currency,
    dailyBudgetMicros: contract.dailyBudgetMicros,
  });
  if (!budget) {
    throw new OpenAIAdsServiceError(
      "launch_budget_invalid",
      409,
      "Das bestätigte Kampagnenbudget kann nicht sicher dargestellt werden.",
    );
  }
  const previewToken = issueOpenAIAdsActivationPreviewToken({
    secret: getOpenAIAdsEnv().tokenEncryptionKey,
    userId: input.userId,
    launchId: launch.id,
    remoteAccountId: contract.remoteAccountId,
    campaignId: launch.remote_campaign_id!,
    adGroupId: launch.remote_ad_group_id!,
    adId: launch.remote_ad_id!,
    budget,
    contractHash: openAIAdsLaunchContractHash(contract),
    providerPreviewHash,
  });
  return {
    launchId: launch.id,
    remoteAccountId: contract.remoteAccountId,
    accountName: readback.account.name,
    campaignId: launch.remote_campaign_id!,
    adGroupId: launch.remote_ad_group_id!,
    adId: launch.remote_ad_id!,
    previewToken,
    accountTimezone: contract.accountTimezone,
    campaignName: contract.campaignName,
    campaignDescription: contract.campaignDescription,
    adGroupName: contract.adGroupName,
    contextHints: contract.contextHints,
    adName: contract.adName,
    biddingType: contract.biddingType,
    billingEventType: contract.billingEventType,
    maxBidMicros: contract.maxBidMicros,
    startTime: contract.startTime,
    endTime: contract.endTime,
    locationIds: contract.locationIds,
    title: contract.title,
    body: contract.body,
    targetUrl: contract.targetUrl,
    imageUrl: contract.imageUrl,
    providerPreviewBodies: providerPreview.bodies,
    ...budget,
  };
}

export async function activateOpenAIAdsLaunch(input: {
  userId: string;
  launchId: string;
  previewToken: string;
}) {
  const admin = createAdminClient();
  const { data: previewed, error: previewedError } = await admin
    .from("ad_platform_launches")
    .select(LAUNCH_ROW_SELECT)
    .eq("id", input.launchId)
    .eq("user_id", input.userId)
    .eq("platform", "openai_ads")
    .maybeSingle();
  if (previewedError || !previewed) {
    throw new OpenAIAdsServiceError(
      "activation_not_available",
      409,
      "Dieser Launch kann in seinem aktuellen Zustand nicht aktiviert werden.",
    );
  }
  const previewedLaunch = previewed as LaunchRow;
  if (previewedLaunch.status === "active") {
    const contract = parseStoredOpenAIAdsLaunchContract(
      previewedLaunch.request_payload,
    );
    let verifiedActive = false;
    if (contract) {
      try {
        const loaded = await loadOpenAIAdsClient({
          platformAccountId: previewedLaunch.platform_account_id,
          userId: input.userId,
          deadlineAtMs: Date.now() + ACTIVATION_DEADLINE_MS,
        });
        verifiedActive = validateLaunchChain({
          launch: previewedLaunch,
          contract,
          readback: await readLaunchChain(loaded.client, previewedLaunch),
          expectedStatus: "active",
          requireApprovedAd: true,
        }).ok;
      } catch {
        verifiedActive = false;
      }
    }
    if (verifiedActive) {
      return { status: "active", alreadyActive: true };
    }

    const claim = await claimLaunchOperation({
      launchId: previewedLaunch.id,
      userId: input.userId,
      fromStatuses: ["active"],
      toStatus: "activating",
    });
    if (!claim) {
      throw new OpenAIAdsServiceError(
        "activation_not_available",
        409,
        "Der ACTIVE-Launch wird bereits sicher überprüft.",
      );
    }
    const paused = await pauseWithSafetyClient({
      launch: claim,
      userId: input.userId,
    });
    const safelyContained = paused && hasCompleteRemoteChain(claim);
    await updateClaimedLaunch(
      claim,
      {
        status: safelyContained ? "failed" : "activation_uncertain",
        error_code: safelyContained
          ? "active_replay_drift_safely_paused"
          : "activation_uncertain_manual_check_required",
      },
      true,
    ).catch(() => undefined);
    throw new OpenAIAdsServiceError(
      safelyContained
        ? "active_replay_drift_safely_paused"
        : "activation_uncertain_manual_check_required",
      safelyContained ? 409 : 502,
      safelyContained
        ? "Der ACTIVE-Providerzustand wich vom bestätigten Vertrag ab und wurde sicher pausiert."
        : "Der abweichende ACTIVE-Providerzustand konnte nicht sicher pausiert werden. Bitte sofort im OpenAI Ads Manager prüfen.",
    );
  }
  const previewedContract = requireLaunchContract(previewedLaunch);
  const previewedBudget = budgetSummary({
    currency: previewedContract.currency,
    dailyBudgetMicros: previewedContract.dailyBudgetMicros,
  });
  if (
    !previewedBudget ||
    !previewedLaunch.remote_campaign_id ||
    !previewedLaunch.remote_ad_group_id ||
    !previewedLaunch.remote_ad_id ||
    !verifyOpenAIAdsActivationPreviewToken({
      token: input.previewToken,
      secret: getOpenAIAdsEnv().tokenEncryptionKey,
      userId: input.userId,
      launchId: previewedLaunch.id,
      remoteAccountId: previewedContract.remoteAccountId,
      campaignId: previewedLaunch.remote_campaign_id,
      adGroupId: previewedLaunch.remote_ad_group_id,
      adId: previewedLaunch.remote_ad_id,
      budget: previewedBudget,
      contractHash: openAIAdsLaunchContractHash(previewedContract),
    })
  ) {
    throw new OpenAIAdsServiceError(
      "activation_preview_invalid",
      409,
      "Die Aktivierungsvorschau ist abgelaufen oder passt nicht mehr zu diesem Launch. Bitte erneut prüfen.",
    );
  }
  const claimed = await claimLaunchOperation({
    launchId: input.launchId,
    userId: input.userId,
    fromStatuses: ["paused", "in_review", "ready_to_activate", "blocked"],
    toStatus: "activating",
  });
  if (!claimed) {
    const { data: existing } = await admin
      .from("ad_platform_launches")
      .select(LAUNCH_ROW_SELECT)
      .eq("id", input.launchId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (existing?.status === "active") {
      return activateOpenAIAdsLaunch(input);
    }
    throw new OpenAIAdsServiceError(
      "activation_not_available",
      409,
      "Dieser Launch kann in seinem aktuellen Zustand nicht aktiviert werden.",
    );
  }

  const launch = claimed;
  if (
    !launch.remote_campaign_id ||
    !launch.remote_ad_group_id ||
    !launch.remote_ad_id
  ) {
    await pauseWithSafetyClient({
      launch,
      userId: input.userId,
    });
    await updateClaimedLaunch(launch, {
      status: "activation_uncertain",
      error_code: "remote_chain_incomplete_manual_check_required",
    }, true);
    throw new OpenAIAdsServiceError(
      "remote_chain_incomplete_manual_check_required",
      502,
      "Die Remote-ID-Kette ist unvollständig. Bekannte Objekte wurden bestmöglich pausiert; bitte den OpenAI Ads Manager sofort prüfen.",
    );
  }

  let loaded: Awaited<ReturnType<typeof loadOpenAIAdsClient>> | null = null;
  let stateHandled = false;
  try {
    let contract: StoredOpenAIAdsLaunchContract;
    try {
      contract = requireLaunchContract(launch);
    } catch (error) {
      await updateClaimedLaunch(launch, {
        status: "blocked",
        error_code: "launch_contract_invalid",
      }, true);
      stateHandled = true;
      throw error;
    }
    loaded = await loadOpenAIAdsClient({
      platformAccountId: launch.platform_account_id,
      userId: input.userId,
      deadlineAtMs: Date.now() + ACTIVATION_DEADLINE_MS,
    });
    const before = await readLaunchChain(loaded.client, launch);
    const beforeValidation = validateLaunchChain({
      launch,
      contract,
      readback: before,
      expectedStatus: "paused",
      requireApprovedAd: true,
    });
    if (!beforeValidation.ok) {
      const safetyPauseConfirmed = await pauseWithSafetyClient({
        launch,
        userId: input.userId,
      });
      const status = !safetyPauseConfirmed
        ? "activation_uncertain"
        : beforeValidation.code === "ad_in_review"
          ? "in_review"
          : "blocked";
      await updateClaimedLaunch(launch, {
        status,
        review_status: before.ad.review_status,
        error_code: !safetyPauseConfirmed
          ? "activation_uncertain_manual_check_required"
          : beforeValidation.code === "ad_in_review"
            ? null
            : beforeValidation.code,
      }, true);
      stateHandled = true;
      if (!safetyPauseConfirmed) {
        throw new OpenAIAdsServiceError(
          "activation_uncertain_manual_check_required",
          502,
          "Ein abweichender ACTIVE-Status konnte nicht sicher pausiert werden. Bitte sofort im OpenAI Ads Manager prüfen.",
        );
      }
      assertLaunchValidation(beforeValidation);
    }

    const providerPreview = await loaded.client.previewAd(launch.remote_ad_id);
    const providerPreviewHash = openAIAdsProviderPreviewHash(
      providerPreview.bodies,
    );
    if (
      !providerPreviewHash ||
      !verifyOpenAIAdsActivationPreviewToken({
        token: input.previewToken,
        secret: getOpenAIAdsEnv().tokenEncryptionKey,
        userId: input.userId,
        launchId: launch.id,
        remoteAccountId: contract.remoteAccountId,
        campaignId: launch.remote_campaign_id,
        adGroupId: launch.remote_ad_group_id,
        adId: launch.remote_ad_id,
        budget: previewedBudget,
        contractHash: openAIAdsLaunchContractHash(contract),
        providerPreviewHash,
      })
    ) {
      await updateClaimedLaunch(
        launch,
        {
          status: "ready_to_activate",
          error_code: "provider_preview_changed",
        },
        true,
      );
      stateHandled = true;
      throw new OpenAIAdsServiceError(
        "provider_preview_changed",
        409,
        "OpenAIs gerenderte Anzeigenvorschau hat sich geändert. Bitte die Vorschau erneut prüfen.",
      );
    }

    await Promise.all([
      loaded.client.activateAd(launch.remote_ad_id),
      loaded.client.activateAdGroup(launch.remote_ad_group_id),
    ]);
    await loaded.client.activateCampaign(launch.remote_campaign_id);

    const confirmed = await readLaunchChain(loaded.client, launch);
    assertLaunchValidation(
      validateLaunchChain({
        launch,
        contract,
        readback: confirmed,
        expectedStatus: "active",
        requireApprovedAd: true,
      }),
    );

    await updateClaimedLaunch(launch, {
      status: "active",
      review_status: confirmed.ad.review_status,
      activated_at: new Date().toISOString(),
      error_code: null,
    }, true);
    return { status: "active", alreadyActive: false };
  } catch (error) {
    if (stateHandled) {
      throw error;
    }
    if (!loaded) {
      await updateClaimedLaunch(launch, {
        status: "ready_to_activate",
        error_code: "activation_precheck_failed",
      }, true).catch(() => undefined);
      throw error;
    }

    const safetyPauseConfirmed = await pauseWithSafetyClient({
      launch,
      userId: input.userId,
    });

    await updateClaimedLaunch(launch, {
      status: safetyPauseConfirmed ? "failed" : "activation_uncertain",
      error_code: safetyPauseConfirmed
        ? "activation_failed_safely_paused"
        : "activation_uncertain_manual_check_required",
    }, true);

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

export async function recoverStaleOpenAIAdsLaunchOperations(limit = 5) {
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("ad_platform_launches")
    .select(LAUNCH_ROW_SELECT)
    .eq("platform", "openai_ads")
    .in("status", ["creating", "activating", "activation_uncertain"])
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.min(20, limit)));
  if (error) {
    throw new OpenAIAdsServiceError(
      "launch_recovery_scan_failed",
      500,
      "Hängende OpenAI-Ads-Launches konnten nicht sicher geprüft werden.",
    );
  }

  let safelyPaused = 0;
  let uncertain = 0;
  for (const row of (data ?? []) as LaunchRow[]) {
    const claim = await claimLaunchOperation({
      launchId: row.id,
      userId: row.user_id,
      fromStatuses: [row.status],
      toStatus: row.status === "creating" ? "creating" : "activating",
    });
    if (!claim) continue;
    const paused = await pauseWithSafetyClient({
      launch: claim,
      userId: claim.user_id,
    });
    const safelyContained = paused && hasCompleteRemoteChain(claim);
    const stateFinalized = await updateClaimedLaunch(
      claim,
      {
        status: safelyContained ? "failed" : "activation_uncertain",
        error_code: safelyContained
          ? "stale_operation_safely_paused"
          : "activation_uncertain_manual_check_required",
      },
      true,
    ).then(() => true).catch(() => false);
    if (safelyContained && stateFinalized) safelyPaused += 1;
    else uncertain += 1;
  }
  return { scanned: data?.length ?? 0, safelyPaused, uncertain };
}

export async function reconcileOpenAIAdsLaunchControlPlane(input: {
  platformAccountId: string;
  account: OpenAIAdsAccount;
  campaigns: OpenAIAdsCampaign[];
  adGroups: Array<{ campaignId: string; item: OpenAIAdsAdGroup }>;
  ads: Array<{ adGroupId: string; item: OpenAIAdsAd }>;
}) {
  const admin = createAdminClient();
  const rows: LaunchRow[] = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await admin
      .from("ad_platform_launches")
      .select(LAUNCH_ROW_SELECT)
      .eq("platform_account_id", input.platformAccountId)
      .eq("platform", "openai_ads")
      .in("status", [
        "paused",
        "in_review",
        "ready_to_activate",
        "blocked",
        "failed",
        "active",
        "activation_uncertain",
      ])
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * 1_000, page * 1_000 + 999);
    if (error) {
      throw new OpenAIAdsServiceError(
        "launch_control_read_failed",
        500,
        "Die OpenAI-Launch-Sicherheitszustände konnten nicht gelesen werden.",
      );
    }
    const pageRows = (data ?? []) as LaunchRow[];
    rows.push(...pageRows);
    if (pageRows.length < 1_000) break;
    if (page === 19) {
      throw new OpenAIAdsServiceError(
        "launch_control_pagination_limit_exceeded",
        503,
        "Die OpenAI-Launch-Sicherheitsprüfung überschreitet das sichere Seitenlimit.",
      );
    }
  }

  const campaigns = new Map(input.campaigns.map((item) => [item.id, item]));
  const adGroups = new Map(input.adGroups.map(({ item }) => [item.id, item]));
  const ads = new Map(input.ads.map(({ item }) => [item.id, item]));
  const adGroupParents = new Map(
    input.adGroups.map(({ campaignId, item }) => [item.id, campaignId]),
  );
  const adParents = new Map(
    input.ads.map(({ adGroupId, item }) => [item.id, adGroupId]),
  );
  let safelyPaused = 0;
  let uncertain = 0;

  for (const row of rows) {
    const contract = parseStoredOpenAIAdsLaunchContract(row.request_payload);
    const campaign = row.remote_campaign_id
      ? campaigns.get(row.remote_campaign_id)
      : undefined;
    const adGroup = row.remote_ad_group_id
      ? adGroups.get(row.remote_ad_group_id)
      : undefined;
    const ad = row.remote_ad_id ? ads.get(row.remote_ad_id) : undefined;
    let verified = false;
    if (contract && campaign && adGroup && ad && row.remote_file_id) {
      verified = validateLaunchChain({
        launch: row,
        contract,
        readback: {
          account: input.account,
          campaign,
          adGroup,
          ad,
          parentageVerified:
            adGroupParents.get(adGroup.id) === campaign.id &&
            adParents.get(ad.id) === adGroup.id,
        },
        expectedStatus: row.status === "active" ? "active" : "paused",
        requireApprovedAd: row.status === "active",
      }).ok;
    }
    if (verified) continue;

    const claim = await claimLaunchOperation({
      launchId: row.id,
      userId: row.user_id,
      fromStatuses: [row.status],
      toStatus: "activating",
    });
    if (!claim) {
      uncertain += 1;
      continue;
    }
    const paused = await pauseWithSafetyClient({
      launch: claim,
      userId: claim.user_id,
    });
    const safelyContained = paused && hasCompleteRemoteChain(claim);
    const finished = await updateClaimedLaunch(
      claim,
      {
        status: safelyContained ? "failed" : "activation_uncertain",
        error_code: safelyContained
          ? "control_plane_drift_safely_paused"
          : "activation_uncertain_manual_check_required",
      },
      true,
    ).catch(() => false);
    if (safelyContained && finished) safelyPaused += 1;
    else uncertain += 1;
  }

  return { scanned: rows.length, safelyPaused, uncertain };
}

export async function containUncertainOpenAIAdsLaunchesForAccount(input: {
  platformAccountId: string;
  expectedCount: number;
}) {
  const admin = createAdminClient();
  const limit = Math.max(1, Math.min(1_000, input.expectedCount));
  const { data, error } = await admin
    .from("ad_platform_launches")
    .select(LAUNCH_ROW_SELECT)
    .eq("platform", "openai_ads")
    .eq("platform_account_id", input.platformAccountId)
    .eq("status", "activation_uncertain")
    .eq("error_code", "snapshot_launch_contract_not_verified")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new OpenAIAdsServiceError(
      "snapshot_launch_containment_scan_failed",
      500,
      "Eine unsichere OpenAI-Ads-Launchkette konnte nicht sofort eingedämmt werden.",
    );
  }

  let safelyPaused = 0;
  let uncertain = 0;
  const rows = (data ?? []) as LaunchRow[];
  let cursor = 0;
  async function containNext() {
    while (cursor < rows.length) {
      const row = rows[cursor];
      cursor += 1;
      const claim = await claimLaunchOperation({
        launchId: row.id,
        userId: row.user_id,
        fromStatuses: ["activation_uncertain"],
        toStatus: "activating",
      });
      if (!claim) {
        uncertain += 1;
        continue;
      }
      const paused = await pauseWithSafetyClient({
        launch: claim,
        userId: claim.user_id,
      });
      const safelyContained = paused && hasCompleteRemoteChain(claim);
      const finished = await updateClaimedLaunch(
        claim,
        {
          status: safelyContained ? "failed" : "activation_uncertain",
          error_code: safelyContained
            ? "snapshot_drift_safely_paused"
            : "activation_uncertain_manual_check_required",
        },
        true,
      ).catch(() => false);
      if (safelyContained && finished) safelyPaused += 1;
      else uncertain += 1;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, rows.length) }, () => containNext()),
  );

  return {
    scanned: data?.length ?? 0,
    safelyPaused,
    uncertain:
      uncertain + Math.max(0, input.expectedCount - rows.length),
  };
}
