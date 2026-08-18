import "server-only";

import { createHash } from "node:crypto";

import {
  META_GRAPH_VERSION,
  MetaGraphError,
  metaUsageFromHeaders,
  type MetaUsageSnapshot,
} from "./client";
import { createAppSecretProof } from "./crypto";

const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const META_WRITE_TIMEOUT_MS = 15_000;
const META_MAX_ENCODED_PAYLOAD_BYTES = 1_000_000;
const META_MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const META_MAX_VALUE_DEPTH = 12;
const META_MAX_ARRAY_ITEMS = 500;
const META_MAX_STRING_LENGTH = 100_000;
const META_NUMERIC_ID = /^[1-9][0-9]{0,39}$/;
const META_OBJECTIVE = /^[A-Z][A-Z0-9_]{1,79}$/;
const META_IMAGE_HASH = /^[A-Fa-f0-9]{16,128}$/;

const FORBIDDEN_PAYLOAD_KEY_FINGERPRINTS = new Set([
  "accesstoken",
  "appsecretproof",
  "appsecret",
  "clientsecret",
  "authorization",
  "cookie",
  "password",
]);

const CAMPAIGN_CREATE_FIELDS = new Set([
  "adlabels",
  "bid_strategy",
  "budget_schedule_specs",
  "buying_type",
  "campaign_optimization_type",
  "daily_budget",
  "is_adset_budget_sharing_enabled",
  "is_skadnetwork_attribution",
  "is_using_l3_schedule",
  "iterative_split_test_configs",
  "lifetime_budget",
  "name",
  "objective",
  "pacing_type",
  "promoted_object",
  "smart_promotion_type",
  "source_campaign_id",
  "special_ad_categories",
  "special_ad_category_country",
  "spend_cap",
  "status",
  "topline_id",
]);

const AD_SET_CREATE_FIELDS = new Set([
  "adlabels",
  "adset_schedule",
  "attribution_spec",
  "bid_adjustments",
  "bid_amount",
  "bid_constraints",
  "bid_strategy",
  "billing_event",
  "campaign_id",
  "campaign_spec",
  "daily_budget",
  "daily_min_spend_target",
  "daily_spend_cap",
  "destination_type",
  "end_time",
  "frequency_control_specs",
  "instagram_user_id",
  "is_dynamic_creative",
  "lifetime_budget",
  "lifetime_imps",
  "lifetime_min_spend_target",
  "lifetime_spend_cap",
  "name",
  "optimization_goal",
  "optimization_sub_event",
  "pacing_type",
  "promoted_object",
  "regional_regulated_categories",
  "start_time",
  "status",
  "targeting",
  "time_based_ad_rotation_id_blocks",
  "time_based_ad_rotation_intervals",
]);

const CREATIVE_CREATE_FIELDS = new Set([
  "adlabels",
  "applink_treatment",
  "asset_feed_spec",
  "authorization_category",
  "branded_content_sponsor_page_id",
  "call_to_action_type",
  "categorization_criteria",
  "collaborative_ads_lsb_image_bank_id",
  "contextual_multi_ads",
  "creative_sourcing_spec",
  "degrees_of_freedom_spec",
  "destination_set_id",
  "dynamic_ad_voice",
  "enable_direct_install",
  "enable_launch_instant_app",
  "facebook_branded_content",
  "format_transformation_spec",
  "generative_asset_spec",
  "image_crops",
  "image_hash",
  "image_url",
  "instagram_branded_content",
  "instagram_permalink_url",
  "instagram_user_id",
  "link_destination_display_url",
  "link_url",
  "marketing_message_structured_spec",
  "media_sourcing_spec",
  "messenger_sponsored_message",
  "name",
  "object_id",
  "object_store_url",
  "object_store_urls",
  "object_story_id",
  "object_story_spec",
  "object_type",
  "object_url",
  "platform_customizations",
  "portrait_customizations",
  "recommender_settings",
  "source_instagram_media_id",
  "template_url",
  "template_url_spec",
  "thumbnail_url",
  "url_tags",
  "video_id",
]);

const AD_CREATE_FIELDS = new Set([
  "ad_schedule_end_time",
  "ad_schedule_start_time",
  "adlabels",
  "adset_id",
  "audience_id",
  "authorization_category",
  "conversion_domain",
  "creative",
  "creative_asset_groups_spec",
  "creative_automation_spec",
  "dataset_split_specs",
  "date_format",
  "display_sequence",
  "engagement_audience",
  "include_demolink_hashes",
  "name",
  "priority",
  "source_ad_id",
  "status",
  "tracking_specs",
]);

export const META_CAMPAIGN_OBJECTIVES = [
  "APP_INSTALLS",
  "BRAND_AWARENESS",
  "CONVERSIONS",
  "EVENT_RESPONSES",
  "LEAD_GENERATION",
  "LINK_CLICKS",
  "LOCAL_AWARENESS",
  "MESSAGES",
  "OFFER_CLAIMS",
  "OUTCOME_APP_PROMOTION",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "PAGE_LIKES",
  "POST_ENGAGEMENT",
  "PRODUCT_CATALOG_SALES",
  "REACH",
  "STORE_VISITS",
  "VIDEO_VIEWS",
] as const;

const META_CAMPAIGN_OBJECTIVE_SET = new Set<string>(META_CAMPAIGN_OBJECTIVES);

export type MetaCampaignObjective = (typeof META_CAMPAIGN_OBJECTIVES)[number];
export type MetaDeliveryStatus = "ACTIVE" | "PAUSED";
export type MetaMutationMode = "validate_only" | "execute";
export type MetaBudgetType = "daily_budget" | "lifetime_budget";
export type MetaWriteObjectKind = "campaign" | "ad_set" | "creative" | "ad";
export type MetaWriteOperation =
  | "create_campaign"
  | "create_ad_set"
  | "create_creative"
  | "create_ad"
  | "upload_image"
  | "update_campaign_status"
  | "update_campaign_budget"
  | "update_ad_set_status"
  | "update_ad_set_budget"
  | "update_ad_status"
  | "read_campaign"
  | "read_ad_set"
  | "read_creative"
  | "read_ad";

export type MetaWriteValue =
  | string
  | number
  | boolean
  | readonly MetaWriteValue[]
  | { readonly [key: string]: MetaWriteValue };

export type MetaWritePayload = Readonly<Record<string, MetaWriteValue>>;

type MetaAuth = {
  accessToken: string;
  appSecret: string;
};

type MetaAccountMutationInput = MetaAuth & {
  adAccountId: string;
  mode: MetaMutationMode;
  payload: MetaWritePayload;
};

type MetaObjectMutationInput = MetaAuth & {
  objectId: string;
  mode: MetaMutationMode;
};

export type MetaMutationResult = {
  id: string | null;
  success: true;
  validated: boolean;
  requestFingerprint: string;
  responseFingerprint: string;
  usage: MetaUsageSnapshot;
};

export type MetaImageUploadResult = {
  hash: string;
  assetSha256: string;
  requestFingerprint: string;
  responseFingerprint: string;
  usage: MetaUsageSnapshot;
};

export type MetaWriteObjectSnapshot = {
  kind: MetaWriteObjectKind;
  id: string;
  value: Readonly<Record<string, unknown>>;
  responseFingerprint: string;
  usage: MetaUsageSnapshot;
};

export class MetaWriteTransportError extends Error {
  readonly operation: MetaWriteOperation;
  readonly outcome: "not_applied" | "unknown";

  constructor(
    operation: MetaWriteOperation,
    outcome: "not_applied" | "unknown",
  ) {
    super(
      outcome === "unknown"
        ? "Meta mutation transport failed; remote outcome is unknown"
        : "Meta request transport failed before a mutation could be confirmed",
    );
    this.name = "MetaWriteTransportError";
    this.operation = operation;
    this.outcome = outcome;
  }
}

export class MetaWriteProtocolError extends Error {
  readonly operation: MetaWriteOperation;

  constructor(operation: MetaWriteOperation, message: string) {
    super(message);
    this.name = "MetaWriteProtocolError";
    this.operation = operation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCredential(value: string, label: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new TypeError(`${label} is required`);
  }

  return trimmed;
}

export function normalizeMetaObjectId(value: string): string {
  const normalized = value.trim().replace(/^act_/, "");

  if (!META_NUMERIC_ID.test(normalized)) {
    throw new TypeError("Invalid Meta object ID");
  }

  return normalized;
}

export function normalizeMetaWriteAdAccountId(value: string): string {
  return normalizeMetaObjectId(value);
}

function assertStatus(value: unknown, label = "status"): asserts value is MetaDeliveryStatus {
  if (value !== "ACTIVE" && value !== "PAUSED") {
    throw new TypeError(`${label} must be ACTIVE or PAUSED`);
  }
}

function assertMinorUnits(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer in minor currency units`);
  }
}

function coerceMinorUnits(value: unknown, label: string): number {
  if (typeof value === "number") {
    assertMinorUnits(value, label);
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    assertMinorUnits(parsed, label);
    return parsed;
  }
  throw new TypeError(`${label} must be a positive integer in minor currency units`);
}

function assertExclusiveBudget(payload: MetaWritePayload): void {
  if (payload.daily_budget !== undefined && payload.lifetime_budget !== undefined) {
    throw new TypeError("daily_budget and lifetime_budget are mutually exclusive");
  }

  if (payload.daily_budget !== undefined) {
    assertMinorUnits(coerceMinorUnits(payload.daily_budget, "daily_budget"), "daily_budget");
  }

  if (payload.lifetime_budget !== undefined) {
    assertMinorUnits(
      coerceMinorUnits(payload.lifetime_budget, "lifetime_budget"),
      "lifetime_budget",
    );
  }
}

function assertRequiredString(payload: MetaWritePayload, key: string): string {
  const value = payload[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${key} is required`);
  }

  return value.trim();
}

function assertAllowedPayload(
  payload: MetaWritePayload,
  allowedFields: ReadonlySet<string>,
): void {
  if (!isRecord(payload)) {
    throw new TypeError("Meta write payload must be an object");
  }

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`Meta write field is not allowlisted: ${key}`);
    }
  }

  validateWriteValue(payload, 0);
}

function validateWriteValue(value: unknown, depth: number): void {
  if (depth > META_MAX_VALUE_DEPTH) {
    throw new TypeError("Meta write payload exceeds maximum nesting depth");
  }

  if (typeof value === "string") {
    if (value.length > META_MAX_STRING_LENGTH) {
      throw new TypeError("Meta write payload contains an oversized string");
    }
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Meta write payload contains a non-finite number");
    }
    return;
  }

  if (typeof value === "boolean") {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > META_MAX_ARRAY_ITEMS) {
      throw new TypeError("Meta write payload contains an oversized array");
    }

    for (const item of value) {
      validateWriteValue(item, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    throw new TypeError("Meta write payload contains an unsupported value");
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const keyFingerprint = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (FORBIDDEN_PAYLOAD_KEY_FINGERPRINTS.has(keyFingerprint)) {
      throw new TypeError(`Secret-bearing field is forbidden in Meta payload: ${key}`);
    }
    validateWriteValue(nestedValue, depth + 1);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprintJson(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

function encodePayload(payload: MetaWritePayload): URLSearchParams {
  const encoded = new URLSearchParams();

  for (const key of Object.keys(payload).sort()) {
    const value = payload[key];
    // Meta form posts expect 0/1 for booleans (e.g. is_adset_budget_sharing_enabled).
    const encodedValue = typeof value === "boolean"
      ? (value ? "1" : "0")
      : typeof value === "string" || typeof value === "number"
        ? String(value)
        : JSON.stringify(value);
    encoded.set(key, encodedValue);
  }

  if (new TextEncoder().encode(encoded.toString()).byteLength > META_MAX_ENCODED_PAYLOAD_BYTES) {
    throw new TypeError("Meta write payload exceeds maximum encoded size");
  }

  return encoded;
}

function accountEdgeUrl(adAccountId: string, edge: string): URL {
  const accountId = normalizeMetaWriteAdAccountId(adAccountId);
  return new URL(`/${META_GRAPH_VERSION}/act_${accountId}/${edge}`, META_GRAPH_ORIGIN);
}

function objectUrl(objectId: string): URL {
  return new URL(`/${META_GRAPH_VERSION}/${normalizeMetaObjectId(objectId)}`, META_GRAPH_ORIGIN);
}

function addAuth(url: URL, auth: MetaAuth): Record<string, string> {
  const accessToken = assertCredential(auth.accessToken, "Meta access token");
  const appSecret = assertCredential(auth.appSecret, "Meta app secret");
  url.searchParams.set("appsecret_proof", createAppSecretProof(accessToken, appSecret));

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function metaRequest(input: {
  url: URL;
  auth: MetaAuth;
  operation: MetaWriteOperation;
  method: "GET" | "POST";
  body?: URLSearchParams | FormData;
  ambiguousOnTransport: boolean;
}): Promise<{ body: unknown; usage: MetaUsageSnapshot }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...addAuth(input.url, input.auth),
  };

  if (input.body instanceof URLSearchParams) {
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }

  let response: Response;

  try {
    response = await fetch(input.url, {
      method: input.method,
      cache: "no-store",
      signal: AbortSignal.timeout(META_WRITE_TIMEOUT_MS),
      headers,
      body: input.body,
    });
  } catch {
    throw new MetaWriteTransportError(
      input.operation,
      input.ambiguousOnTransport ? "unknown" : "not_applied",
    );
  }

  const body = await readJson(response);
  const usage = metaUsageFromHeaders(response.headers);

  if (!response.ok) {
    throw new MetaGraphError(
      response.status,
      isRecord(body) ? body : {},
      usage,
    );
  }

  return { body, usage };
}

function executionPayload(
  payload: MetaWritePayload,
  mode: MetaMutationMode,
  synchronousAdReview: boolean,
): MetaWritePayload {
  if (Object.prototype.hasOwnProperty.call(payload, "execution_options")) {
    throw new TypeError("execution_options is controlled by the Meta write client");
  }

  if (mode === "execute") {
    return payload;
  }

  return {
    ...payload,
    execution_options: synchronousAdReview
      ? ["validate_only", "synchronous_ad_review"]
      : ["validate_only"],
  };
}

function parseMutationResult(input: {
  body: unknown;
  usage: MetaUsageSnapshot;
  operation: MetaWriteOperation;
  mode: MetaMutationMode;
  requireId: boolean;
  requestFingerprint: string;
}): MetaMutationResult {
  if (!isRecord(input.body)) {
    throw new MetaWriteProtocolError(input.operation, "Meta returned a non-object mutation response");
  }

  const id = typeof input.body.id === "string" && META_NUMERIC_ID.test(input.body.id)
    ? input.body.id
    : null;
  const success = input.body.success === true || id !== null;

  if (!success || (input.requireId && input.mode === "execute" && id === null)) {
    throw new MetaWriteProtocolError(input.operation, "Meta returned an incomplete mutation response");
  }

  return {
    id,
    success: true,
    validated: input.mode === "validate_only",
    requestFingerprint: input.requestFingerprint,
    responseFingerprint: fingerprintJson(input.body),
    usage: input.usage,
  };
}

async function mutateAccountEdge(input: {
  auth: MetaAuth;
  adAccountId: string;
  edge: string;
  operation: MetaWriteOperation;
  payload: MetaWritePayload;
  mode: MetaMutationMode;
  synchronousAdReview?: boolean;
  requireId: boolean;
}): Promise<MetaMutationResult> {
  const effectivePayload = executionPayload(
    input.payload,
    input.mode,
    input.synchronousAdReview === true,
  );
  validateWriteValue(effectivePayload, 0);
  const requestFingerprint = fingerprintJson({
    operation: input.operation,
    adAccountId: normalizeMetaWriteAdAccountId(input.adAccountId),
    payload: effectivePayload,
  });
  const result = await metaRequest({
    url: accountEdgeUrl(input.adAccountId, input.edge),
    auth: input.auth,
    operation: input.operation,
    method: "POST",
    body: encodePayload(effectivePayload),
    ambiguousOnTransport: input.mode === "execute",
  });

  return parseMutationResult({
    ...result,
    operation: input.operation,
    mode: input.mode,
    requireId: input.requireId,
    requestFingerprint,
  });
}

async function mutateObject(input: {
  auth: MetaAuth;
  objectId: string;
  operation: MetaWriteOperation;
  payload: MetaWritePayload;
  mode: MetaMutationMode;
  synchronousAdReview?: boolean;
}): Promise<MetaMutationResult> {
  const effectivePayload = executionPayload(
    input.payload,
    input.mode,
    input.synchronousAdReview === true,
  );
  validateWriteValue(effectivePayload, 0);
  const normalizedId = normalizeMetaObjectId(input.objectId);
  const requestFingerprint = fingerprintJson({
    operation: input.operation,
    objectId: normalizedId,
    payload: effectivePayload,
  });
  const result = await metaRequest({
    url: objectUrl(normalizedId),
    auth: input.auth,
    operation: input.operation,
    method: "POST",
    body: encodePayload(effectivePayload),
    ambiguousOnTransport: input.mode === "execute",
  });

  return parseMutationResult({
    ...result,
    operation: input.operation,
    mode: input.mode,
    requireId: false,
    requestFingerprint,
  });
}

export function createMetaCampaign(input: MetaAccountMutationInput): Promise<MetaMutationResult> {
  assertAllowedPayload(input.payload, CAMPAIGN_CREATE_FIELDS);
  assertRequiredString(input.payload, "name");
  const objective = assertRequiredString(input.payload, "objective");

  if (!META_OBJECTIVE.test(objective) || !META_CAMPAIGN_OBJECTIVE_SET.has(objective)) {
    throw new TypeError("Unsupported Meta campaign objective");
  }

  assertStatus(input.payload.status, "campaign status");

  if (!Array.isArray(input.payload.special_ad_categories)) {
    throw new TypeError("special_ad_categories is required for campaign creation");
  }

  const dailyBudget = input.payload.daily_budget === undefined
    ? undefined
    : coerceMinorUnits(input.payload.daily_budget, "daily_budget");
  const lifetimeBudget = input.payload.lifetime_budget === undefined
    ? undefined
    : coerceMinorUnits(input.payload.lifetime_budget, "lifetime_budget");
  const hasCampaignBudget = dailyBudget !== undefined || lifetimeBudget !== undefined;
  const sharingEnabled = typeof input.payload.is_adset_budget_sharing_enabled === "boolean"
    ? input.payload.is_adset_budget_sharing_enabled
    : !hasCampaignBudget;
  // Meta #100/4834005: ad-set budget sharing requires campaign bid_strategy.
  const bidStrategy =
    typeof input.payload.bid_strategy === "string" && input.payload.bid_strategy.trim()
      ? input.payload.bid_strategy.trim()
      : sharingEnabled
        ? "LOWEST_COST_WITHOUT_CAP"
        : undefined;

  const payload: MetaWritePayload = {
    ...input.payload,
    ...(dailyBudget === undefined ? {} : { daily_budget: dailyBudget }),
    ...(lifetimeBudget === undefined ? {} : { lifetime_budget: lifetimeBudget }),
    // Meta Marketing API v24+: required when ad-set budgets are used.
    is_adset_budget_sharing_enabled: sharingEnabled,
    ...(bidStrategy ? { bid_strategy: bidStrategy } : {}),
  };

  assertExclusiveBudget(payload);

  return mutateAccountEdge({
    auth: input,
    adAccountId: input.adAccountId,
    edge: "campaigns",
    operation: "create_campaign",
    payload,
    mode: input.mode,
    requireId: true,
  });
}

export function createMetaAdSet(input: MetaAccountMutationInput): Promise<MetaMutationResult> {
  assertAllowedPayload(input.payload, AD_SET_CREATE_FIELDS);
  assertRequiredString(input.payload, "name");
  normalizeMetaObjectId(assertRequiredString(input.payload, "campaign_id"));
  assertRequiredString(input.payload, "billing_event");
  assertRequiredString(input.payload, "optimization_goal");
  assertStatus(input.payload.status, "ad set status");

  if (!isRecord(input.payload.targeting)) {
    throw new TypeError("targeting is required for ad set creation");
  }

  const dailyBudget = input.payload.daily_budget === undefined
    ? undefined
    : coerceMinorUnits(input.payload.daily_budget, "daily_budget");
  const lifetimeBudget = input.payload.lifetime_budget === undefined
    ? undefined
    : coerceMinorUnits(input.payload.lifetime_budget, "lifetime_budget");

  const payload: MetaWritePayload = {
    ...input.payload,
    ...(dailyBudget === undefined ? {} : { daily_budget: dailyBudget }),
    ...(lifetimeBudget === undefined ? {} : { lifetime_budget: lifetimeBudget }),
    ...(
      String(input.payload.optimization_goal ?? "") === "POST_ENGAGEMENT"
        && input.payload.destination_type === undefined
        ? { destination_type: "ON_POST" }
        : {}
    ),
    ...(
      String(input.payload.optimization_goal ?? "") === "LINK_CLICKS"
        && input.payload.destination_type === undefined
        ? { destination_type: "WEBSITE" }
        : {}
    ),
  };

  assertExclusiveBudget(payload);

  return mutateAccountEdge({
    auth: input,
    adAccountId: input.adAccountId,
    edge: "adsets",
    operation: "create_ad_set",
    payload,
    mode: input.mode,
    requireId: true,
  });
}

function isInstagramOrganicMediaCreative(payload: MetaWritePayload): boolean {
  return typeof payload.source_instagram_media_id === "string"
    && META_NUMERIC_ID.test(payload.source_instagram_media_id)
    && typeof payload.object_id === "string"
    && META_NUMERIC_ID.test(payload.object_id)
    && typeof payload.instagram_user_id === "string"
    && META_NUMERIC_ID.test(payload.instagram_user_id);
}

/**
 * Meta Marketing API rejects deprecated object_story_spec.instagram_actor_id
 * (#100 "must be a valid Instagram account id"). Strip actor_id only —
 * launch materialize must set instagram_user_id when Instagram is selected.
 */
export function sanitizeCreativeInstagramFields(
  payload: MetaWritePayload,
): MetaWritePayload {
  let next: MetaWritePayload = { ...payload };
  if (isRecord(next.object_story_spec)) {
    const spec: Record<string, MetaWriteValue> = {
      ...(next.object_story_spec as Record<string, MetaWriteValue>),
    };
    delete spec.instagram_actor_id;
    next = { ...next, object_story_spec: spec };
  }
  if ("instagram_actor_id" in next) {
    const { instagram_actor_id: _removed, ...rest } = next;
    return rest;
  }
  return next;
}

export function createMetaAdCreative(input: MetaAccountMutationInput): Promise<MetaMutationResult> {
  const sanitized = sanitizeCreativeInstagramFields(input.payload);
  assertAllowedPayload(sanitized, CREATIVE_CREATE_FIELDS);
  assertRequiredString(sanitized, "name");

  if (
    sanitized.object_story_spec === undefined
    && sanitized.object_story_id === undefined
    && sanitized.asset_feed_spec === undefined
    && !isInstagramOrganicMediaCreative(sanitized)
  ) {
    throw new TypeError(
      "Creative requires object_story_spec, object_story_id, asset_feed_spec, or Instagram organic media fields",
    );
  }

  // Organic boost creatives must not send top-level CTA/link next to
  // object_story_id / Instagram media fields — Meta Graph rejects that (#100).
  const organicStoryBoost = typeof sanitized.object_story_id === "string"
    || isInstagramOrganicMediaCreative(sanitized);
  const payload = organicStoryBoost
    ? Object.fromEntries(
      Object.entries(sanitized).filter(
        ([key]) => key !== "call_to_action_type" && key !== "link_url",
      ),
    )
    : sanitized;

  if (isInstagramOrganicMediaCreative(payload)) {
    normalizeMetaObjectId(String(payload.object_id));
    normalizeMetaObjectId(String(payload.instagram_user_id));
    normalizeMetaObjectId(String(payload.source_instagram_media_id));
  }

  return mutateAccountEdge({
    auth: input,
    adAccountId: input.adAccountId,
    edge: "adcreatives",
    operation: "create_creative",
    payload,
    mode: input.mode,
    requireId: true,
  });
}

export function createMetaAd(input: MetaAccountMutationInput): Promise<MetaMutationResult> {
  assertAllowedPayload(input.payload, AD_CREATE_FIELDS);
  assertRequiredString(input.payload, "name");
  normalizeMetaObjectId(assertRequiredString(input.payload, "adset_id"));
  assertStatus(input.payload.status, "ad status");

  if (!isRecord(input.payload.creative)) {
    throw new TypeError("creative is required for ad creation");
  }

  const creativeKeys = Object.keys(input.payload.creative);
  const creativeId = input.payload.creative.creative_id;

  if (
    creativeKeys.length !== 1
    || creativeKeys[0] !== "creative_id"
    || typeof creativeId !== "string"
  ) {
    throw new TypeError("Ad creative must reference exactly one existing creative_id");
  }
  normalizeMetaObjectId(creativeId);

  if (input.payload.conversion_domain !== undefined) {
    const domain = assertRequiredString(input.payload, "conversion_domain").toLowerCase();

    if (domain.includes("://") || domain.includes("/") || domain.includes("?") || domain.includes("#")) {
      throw new TypeError("conversion_domain must contain only a registrable domain");
    }
  }

  return mutateAccountEdge({
    auth: input,
    adAccountId: input.adAccountId,
    edge: "ads",
    operation: "create_ad",
    payload: input.payload,
    mode: input.mode,
    synchronousAdReview: input.mode === "validate_only",
    requireId: true,
  });
}

export function updateMetaCampaignStatus(
  input: MetaObjectMutationInput & { status: MetaDeliveryStatus },
): Promise<MetaMutationResult> {
  assertStatus(input.status);
  return mutateObject({
    auth: input,
    objectId: input.objectId,
    operation: "update_campaign_status",
    payload: { status: input.status },
    mode: input.mode,
  });
}

export function updateMetaCampaignBudget(
  input: MetaObjectMutationInput & { budgetType: MetaBudgetType; amountMinor: number },
): Promise<MetaMutationResult> {
  assertMinorUnits(input.amountMinor, "amountMinor");
  return mutateObject({
    auth: input,
    objectId: input.objectId,
    operation: "update_campaign_budget",
    payload: { [input.budgetType]: input.amountMinor },
    mode: input.mode,
  });
}

export function updateMetaAdSetStatus(
  input: MetaObjectMutationInput & { status: MetaDeliveryStatus },
): Promise<MetaMutationResult> {
  assertStatus(input.status);
  return mutateObject({
    auth: input,
    objectId: input.objectId,
    operation: "update_ad_set_status",
    payload: { status: input.status },
    mode: input.mode,
  });
}

export function updateMetaAdSetBudget(
  input: MetaObjectMutationInput & { budgetType: MetaBudgetType; amountMinor: number },
): Promise<MetaMutationResult> {
  assertMinorUnits(input.amountMinor, "amountMinor");
  return mutateObject({
    auth: input,
    objectId: input.objectId,
    operation: "update_ad_set_budget",
    payload: { [input.budgetType]: input.amountMinor },
    mode: input.mode,
  });
}

export function updateMetaAdStatus(
  input: MetaObjectMutationInput & { status: MetaDeliveryStatus },
): Promise<MetaMutationResult> {
  assertStatus(input.status);
  return mutateObject({
    auth: input,
    objectId: input.objectId,
    operation: "update_ad_status",
    payload: { status: input.status },
    mode: input.mode,
    synchronousAdReview: input.mode === "validate_only",
  });
}

function detectedImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (
    bytes.byteLength >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.byteLength >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  return null;
}

export async function uploadMetaAdImage(input: MetaAuth & {
  adAccountId: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: "image/jpeg" | "image/png";
}): Promise<MetaImageUploadResult> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    throw new TypeError("Image bytes are required");
  }

  if (input.bytes.byteLength > META_MAX_IMAGE_BYTES) {
    throw new TypeError("Meta image exceeds the 30 MiB safety limit");
  }

  if (detectedImageMime(input.bytes) !== input.mimeType) {
    throw new TypeError("Meta image MIME type does not match its binary signature");
  }

  const fileName = input.fileName.trim();

  if (!fileName || fileName.length > 120 || !/^[A-Za-z0-9._-]+$/.test(fileName)) {
    throw new TypeError("Invalid Meta image file name");
  }

  const copiedBytes = Uint8Array.from(input.bytes);
  const assetSha256 = sha256(copiedBytes);
  const body = new FormData();
  body.set("filename", new Blob([copiedBytes.buffer], { type: input.mimeType }), fileName);
  const accountId = normalizeMetaWriteAdAccountId(input.adAccountId);
  const requestFingerprint = fingerprintJson({
    operation: "upload_image",
    adAccountId: accountId,
    assetSha256,
    mimeType: input.mimeType,
    fileName,
  });
  const result = await metaRequest({
    url: accountEdgeUrl(accountId, "adimages"),
    auth: input,
    operation: "upload_image",
    method: "POST",
    body,
    ambiguousOnTransport: true,
  });

  if (!isRecord(result.body) || !isRecord(result.body.images)) {
    throw new MetaWriteProtocolError("upload_image", "Meta returned an invalid image response");
  }

  const image = Object.values(result.body.images).find(
    (value): value is Record<string, unknown> => isRecord(value) && typeof value.hash === "string",
  );
  const hash = typeof image?.hash === "string" && META_IMAGE_HASH.test(image.hash)
    ? image.hash
    : null;

  if (!hash) {
    throw new MetaWriteProtocolError("upload_image", "Meta image response did not contain a valid hash");
  }

  return {
    hash,
    assetSha256,
    requestFingerprint,
    responseFingerprint: fingerprintJson(result.body),
    usage: result.usage,
  };
}

const SNAPSHOT_FIELDS: Record<MetaWriteObjectKind, readonly string[]> = {
  campaign: [
    "id",
    "account_id",
    "name",
    "objective",
    "status",
    "effective_status",
    "daily_budget",
    "lifetime_budget",
    "bid_strategy",
    "buying_type",
    "special_ad_categories",
    "is_adset_budget_sharing_enabled",
    "updated_time",
  ],
  ad_set: [
    "id",
    "account_id",
    "campaign_id",
    "name",
    "status",
    "effective_status",
    "daily_budget",
    "lifetime_budget",
    "billing_event",
    "optimization_goal",
    "targeting",
    "promoted_object",
    "destination_type",
    "start_time",
    "end_time",
    "updated_time",
  ],
  // Meta AdCreative nodes reject `updated_time` (#100 nonexisting field).
  creative: [
    "id",
    "account_id",
    "name",
    "actor_id",
    "object_story_id",
    "object_story_spec",
    "asset_feed_spec",
    "image_hash",
    "image_url",
    "authorization_category",
    "instagram_user_id",
    "url_tags",
  ],
  ad: [
    "id",
    "account_id",
    "campaign_id",
    "adset_id",
    "name",
    "status",
    "effective_status",
    "creative",
    "conversion_domain",
    "updated_time",
  ],
};

const READ_OPERATION: Record<MetaWriteObjectKind, MetaWriteOperation> = {
  campaign: "read_campaign",
  ad_set: "read_ad_set",
  creative: "read_creative",
  ad: "read_ad",
};

export async function getMetaWriteObjectSnapshot(input: MetaAuth & {
  kind: MetaWriteObjectKind;
  objectId: string;
}): Promise<MetaWriteObjectSnapshot> {
  const id = normalizeMetaObjectId(input.objectId);
  const url = objectUrl(id);
  url.searchParams.set("fields", SNAPSHOT_FIELDS[input.kind].join(","));
  const operation = READ_OPERATION[input.kind];
  const result = await metaRequest({
    url,
    auth: input,
    operation,
    method: "GET",
    ambiguousOnTransport: false,
  });

  if (!isRecord(result.body) || result.body.id !== id) {
    throw new MetaWriteProtocolError(operation, "Meta returned an invalid read-after-write object");
  }

  return {
    kind: input.kind,
    id,
    value: result.body,
    responseFingerprint: fingerprintJson(result.body),
    usage: result.usage,
  };
}
