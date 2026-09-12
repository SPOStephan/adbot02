import "server-only";

import {
  getMetaAdSetAdsSnapshot,
  getMetaWriteObjectSnapshot,
} from "@/lib/meta/write-client";

const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,39}$/;
const TEST_CONTRACT = "meta_existing_adset_creative_test_v1";
const PAUSE_CONTRACT = "meta_creative_evidence_pause_v1";

export class MetaCreativeFreshPreflightError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Meta creative optimizer fresh preflight failed: ${code}`);
    this.name = "MetaCreativeFreshPreflightError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

type FreshPreflightInput = {
  plannedPayload: JsonRecord;
  expectedBefore: JsonRecord;
  operation: string;
  objectType: string;
  plannedRequest: JsonRecord;
  bindings: ReadonlyArray<{
    stepId: string;
    objectType: string;
    remoteObjectId: string;
  }>;
  credentials: {
    accessToken: string;
    appSecret: string;
    adAccountId: string;
    currentMarketingSyncId: string;
  };
};

export type MetaCreativeFreshState = Omit<FreshPreflightInput, "credentials"> & {
  currentAdAccountId: string;
  currentMarketingSyncId: string;
  currentTime: string;
  campaign: Readonly<JsonRecord>;
  adSet: Readonly<JsonRecord>;
  ads: ReadonlyArray<Readonly<JsonRecord>>;
};

function requiredNumericId(value: unknown, code: string): string {
  if (typeof value !== "string" || !NUMERIC_ID_PATTERN.test(value)) {
    throw new MetaCreativeFreshPreflightError(code);
  }
  return value;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function statusOf(value: Readonly<JsonRecord>): string | null {
  const status = value.effective_status ?? value.status;
  return typeof status === "string" ? status.toUpperCase() : null;
}

function nullableBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MetaCreativeFreshPreflightError("invalid_budget_snapshot");
  }
  return parsed === 0 ? null : parsed;
}

function sameBudget(remote: unknown, expected: unknown): boolean {
  return nullableBudget(remote) === nullableBudget(expected);
}

function countsTowardActiveCap(ad: Readonly<JsonRecord>): boolean {
  const status = statusOf(ad);
  if (!status) {
    throw new MetaCreativeFreshPreflightError("unknown_ad_status");
  }
  return !new Set(["PAUSED", "DELETED", "ARCHIVED"]).has(status);
}

function activeAd(ad: Readonly<JsonRecord>): boolean {
  return statusOf(ad) === "ACTIVE";
}

function creativeIdOf(ad: Readonly<JsonRecord>): string | null {
  const creative = record(ad.creative);
  const id = creative?.id;
  return typeof id === "string" && NUMERIC_ID_PATTERN.test(id) ? id : null;
}

function bindingId(
  bindings: FreshPreflightInput["bindings"],
  objectType: string,
): string | null {
  const values = bindings
    .filter((binding) => binding.objectType === objectType)
    .map((binding) => binding.remoteObjectId)
    .filter((value) => NUMERIC_ID_PATTERN.test(value));
  return values.length === 1 ? values[0] : null;
}

export function needsMetaCreativeFreshPreflight(input: {
  plannedPayload: JsonRecord;
  operation: string;
  objectType: string;
  stepOperation: string;
  plannedRequest?: JsonRecord;
}): boolean {
  const contract = input.plannedPayload.contract;
  if (contract === PAUSE_CONTRACT) {
    return input.operation === "UPDATE_STATUS"
      && input.objectType === "AD"
      && input.stepOperation === "UPDATE";
  }
  if (contract === TEST_CONTRACT) {
    return (
      input.operation === "UPLOAD_IMAGE"
      && input.objectType === "IMAGE"
      && input.stepOperation === "CREATE"
    ) || (
      input.operation === "CREATE_CREATIVE"
      && input.objectType === "CREATIVE"
      && input.stepOperation === "CREATE"
    ) || (
      input.operation === "CREATE_AD"
      && input.objectType === "AD"
      && input.stepOperation === "CREATE"
    ) || (
      input.operation === "UPDATE_STATUS"
      && input.objectType === "AD"
      && input.stepOperation === "UPDATE"
    ) || (
      input.operation === "READ"
      && input.objectType === "AD"
      && input.stepOperation === "READ"
      && input.plannedRequest?.expected_status === "ACTIVE"
    );
  }
  return false;
}

export function validateMetaCreativeFreshState(
  input: MetaCreativeFreshState,
): void {
  const contract = input.plannedPayload.contract;
  if (contract !== TEST_CONTRACT && contract !== PAUSE_CONTRACT) return;

  const expectedAdAccountId = requiredNumericId(
    input.plannedPayload.meta_ad_account_id,
    "invalid_meta_ad_account_id",
  );
  if (input.currentAdAccountId.replace(/^act_/, "") !== expectedAdAccountId) {
    throw new MetaCreativeFreshPreflightError("selected_ad_account_changed");
  }
  if (input.plannedPayload.source_marketing_sync_id !== input.currentMarketingSyncId) {
    throw new MetaCreativeFreshPreflightError("source_marketing_sync_changed");
  }
  if (contract === PAUSE_CONTRACT) {
    const validUntil = input.plannedPayload.evidence_valid_until;
    const expiresAt = typeof validUntil === "string" ? Date.parse(validUntil) : Number.NaN;
    const currentTime = Date.parse(input.currentTime);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(currentTime) || currentTime > expiresAt) {
      throw new MetaCreativeFreshPreflightError("creative_evidence_expired");
    }
  }

  const campaignId = requiredNumericId(
    input.plannedPayload.platform_campaign_id,
    "invalid_campaign_id",
  );
  const adSetId = requiredNumericId(
    input.plannedPayload.platform_ad_set_id,
    "invalid_ad_set_id",
  );
  const baselineAdId = requiredNumericId(
    input.plannedPayload.baseline_platform_ad_id,
    "invalid_baseline_ad_id",
  );
  if (
    input.campaign.account_id !== expectedAdAccountId
    || input.adSet.account_id !== expectedAdAccountId
    || input.ads.some((ad) => ad.account_id !== expectedAdAccountId)
  ) {
    throw new MetaCreativeFreshPreflightError("remote_ad_account_mismatch");
  }

  if (statusOf(input.campaign) !== "ACTIVE") {
    throw new MetaCreativeFreshPreflightError("campaign_not_active");
  }
  if (statusOf(input.adSet) !== "ACTIVE") {
    throw new MetaCreativeFreshPreflightError("ad_set_not_active");
  }
  if (input.adSet.campaign_id !== campaignId) {
    throw new MetaCreativeFreshPreflightError("parent_campaign_changed");
  }
  if (
    !sameBudget(
      input.campaign.daily_budget,
      input.expectedBefore.campaign_daily_budget_minor,
    )
    || !sameBudget(
      input.campaign.lifetime_budget,
      input.expectedBefore.campaign_lifetime_budget_minor,
    )
    || !sameBudget(
      input.adSet.daily_budget,
      input.expectedBefore.ad_set_daily_budget_minor,
    )
    || !sameBudget(
      input.adSet.lifetime_budget,
      input.expectedBefore.ad_set_lifetime_budget_minor,
    )
  ) {
    throw new MetaCreativeFreshPreflightError("parent_budget_changed");
  }

  const ads = input.ads;
  const baseline = ads.find((ad) => ad.id === baselineAdId);
  if (!baseline || !activeAd(baseline)) {
    throw new MetaCreativeFreshPreflightError("baseline_ad_not_active");
  }

  const activeCount = ads.filter(countsTowardActiveCap).length;
  if (contract === PAUSE_CONTRACT) {
    const winnerId = requiredNumericId(
      input.plannedPayload.winner_platform_ad_id,
      "invalid_winner_ad_id",
    );
    const loserId = requiredNumericId(
      input.plannedPayload.loser_platform_ad_id,
      "invalid_loser_ad_id",
    );
    const winner = ads.find((ad) => ad.id === winnerId);
    const loser = ads.find((ad) => ad.id === loserId);
    if (!winner || !loser || !activeAd(winner) || !activeAd(loser)) {
      throw new MetaCreativeFreshPreflightError("comparison_ads_not_active");
    }
    if (activeCount !== 2) {
      throw new MetaCreativeFreshPreflightError("comparison_cardinality_changed");
    }
    return;
  }

  const rawMax = input.plannedPayload.max_active_ads;
  const maxActiveAds = typeof rawMax === "number" ? rawMax : Number(rawMax);
  if (!Number.isSafeInteger(maxActiveAds) || maxActiveAds < 2 || maxActiveAds > 10) {
    throw new MetaCreativeFreshPreflightError("invalid_active_ad_cap");
  }

  const newAdId = bindingId(input.bindings, "AD");
  const activating = input.operation === "UPDATE_STATUS";
  const readingActive = input.operation === "READ"
    && input.plannedRequest.expected_status === "ACTIVE";
  const activeBeforeActivation = newAdId
    ? ads.filter((ad) => ad.id !== newAdId && countsTowardActiveCap(ad)).length
    : activeCount;
  if (activeBeforeActivation !== 1) {
    throw new MetaCreativeFreshPreflightError("single_active_baseline_required");
  }
  if (activeBeforeActivation >= maxActiveAds) {
    throw new MetaCreativeFreshPreflightError("active_ad_cap_reached");
  }

  if (activating) {
    if (!newAdId) {
      throw new MetaCreativeFreshPreflightError("new_ad_binding_missing");
    }
    const newAd = ads.find((ad) => ad.id === newAdId);
    const creativeId = bindingId(input.bindings, "CREATIVE");
    if (
      !newAd
      || statusOf(newAd) !== "PAUSED"
      || newAd.adset_id !== adSetId
      || !creativeId
      || creativeIdOf(newAd) !== creativeId
    ) {
      throw new MetaCreativeFreshPreflightError("new_ad_shadow_mismatch");
    }
  }
  if (readingActive) {
    if (!newAdId) {
      throw new MetaCreativeFreshPreflightError("new_ad_binding_missing");
    }
    const newAd = ads.find((ad) => ad.id === newAdId);
    const creativeId = bindingId(input.bindings, "CREATIVE");
    if (
      activeCount !== 2
      || !newAd
      || !activeAd(newAd)
      || newAd.adset_id !== adSetId
      || !creativeId
      || creativeIdOf(newAd) !== creativeId
    ) {
      throw new MetaCreativeFreshPreflightError("active_test_pair_mismatch");
    }
  }
}

export async function assertMetaCreativeOptimizerFreshState(
  input: FreshPreflightInput,
): Promise<void> {
  const contract = input.plannedPayload.contract;
  if (contract !== TEST_CONTRACT && contract !== PAUSE_CONTRACT) return;

  const expectedAdAccountId = requiredNumericId(
    input.plannedPayload.meta_ad_account_id,
    "invalid_meta_ad_account_id",
  );
  if (input.credentials.adAccountId.replace(/^act_/, "") !== expectedAdAccountId) {
    throw new MetaCreativeFreshPreflightError("selected_ad_account_changed");
  }
  if (input.plannedPayload.source_marketing_sync_id !== input.credentials.currentMarketingSyncId) {
    throw new MetaCreativeFreshPreflightError("source_marketing_sync_changed");
  }
  if (contract === PAUSE_CONTRACT) {
    const validUntil = input.plannedPayload.evidence_valid_until;
    if (
      typeof validUntil !== "string"
      || !Number.isFinite(Date.parse(validUntil))
      || Date.now() > Date.parse(validUntil)
    ) {
      throw new MetaCreativeFreshPreflightError("creative_evidence_expired");
    }
  }

  const campaignId = requiredNumericId(
    input.plannedPayload.platform_campaign_id,
    "invalid_campaign_id",
  );
  const adSetId = requiredNumericId(
    input.plannedPayload.platform_ad_set_id,
    "invalid_ad_set_id",
  );
  const [campaign, adSet, adList] = await Promise.all([
    getMetaWriteObjectSnapshot({
      ...input.credentials,
      kind: "campaign",
      objectId: campaignId,
    }),
    getMetaWriteObjectSnapshot({
      ...input.credentials,
      kind: "ad_set",
      objectId: adSetId,
    }),
    getMetaAdSetAdsSnapshot({
      ...input.credentials,
      adSetId,
    }),
  ]);

  validateMetaCreativeFreshState({
    ...input,
    currentAdAccountId: input.credentials.adAccountId,
    currentMarketingSyncId: input.credentials.currentMarketingSyncId,
    currentTime: new Date().toISOString(),
    campaign: campaign.value,
    adSet: adSet.value,
    ads: adList.ads,
  });
}
