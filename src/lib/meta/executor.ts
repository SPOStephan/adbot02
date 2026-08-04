import "server-only";

import { createAdminClient } from "../supabase/admin";
import {
  inspectCreativeImage,
  safeCreativeFileName,
} from "../creative-assets/image";
import type { CreativeImageMimeType } from "../creative-assets/types";
import { MetaGraphError, type MetaUsageSnapshot } from "./client";
import { decryptAccessToken } from "./crypto";
import { getMetaSyncEnv } from "./env";
import {
  createMetaAd,
  createMetaAdCreative,
  createMetaAdSet,
  createMetaCampaign,
  getMetaWriteObjectSnapshot,
  MetaWriteProtocolError,
  MetaWriteTransportError,
  normalizeMetaWriteAdAccountId,
  updateMetaAdSetBudget,
  updateMetaAdSetStatus,
  updateMetaAdStatus,
  updateMetaCampaignBudget,
  updateMetaCampaignStatus,
  uploadMetaAdImage,
  type MetaBudgetType,
  type MetaDeliveryStatus,
  type MetaMutationMode,
  type MetaMutationResult,
  type MetaWriteObjectKind,
  type MetaWritePayload,
  type MetaWriteValue,
} from "./write-client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,39}$/;
const IMAGE_HASH_PATTERN = /^[A-Fa-f0-9]{16,128}$/;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,255}$/;

export const META_EXECUTOR_LEASE_SECONDS = 12 * 60;
export const META_EXECUTOR_MAX_STEPS_PER_RUN = 24;

const PLAN_ACTIONS = new Set([
  "UPDATE_BUDGET",
  "PAUSE",
  "ACTIVATE",
  "SAFETY_PAUSE",
  "LAUNCH_CHAIN",
  "LAUNCH_AD",
]);
const STEP_OPERATIONS = new Set([
  "VALIDATE",
  "CREATE",
  "UPDATE",
  "READ",
  "RECONCILE",
  "COMPENSATE",
]);
const STEP_OBJECT_TYPES = new Set([
  "ACCOUNT",
  "CAMPAIGN",
  "AD_SET",
  "CREATIVE",
  "IMAGE",
  "AD",
]);

export type MetaExecutorOutcome =
  | "idle"
  | "succeeded"
  | "retryable"
  | "failed"
  | "ambiguous"
  | "mismatch"
  | "deferred";

export type MetaExecutorRunResult = {
  processed: boolean;
  outcome: MetaExecutorOutcome;
  stepsProcessed: number;
};

type JsonRecord = Record<string, unknown>;

type MetaExecutorClaim = {
  executionId: string;
  planId: string;
  userId: string;
  platformAccountId: string;
  policyId: string;
  leaseToken: string;
  actionType: string;
  targetType: string | null;
  targetKey: string;
  plannedPayload: JsonRecord;
  expectedBefore: JsonRecord;
  intendedAfter: JsonRecord;
  firstStep: MetaExecutorStep;
};

type MetaExecutorStep = {
  stepId: string;
  stepIndex: number;
  operation: string;
  objectType: string;
  plannedRequest: JsonRecord;
  requestHash: string | null;
  dispatchState: string;
};

type MetaRemoteBinding = {
  stepId: string;
  objectType: string;
  remoteObjectId: string;
};

type MetaExecutorCredentials = {
  accessToken: string;
  appSecret: string;
  adAccountId: string;
};

type VerifiedBrandAsset = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: CreativeImageMimeType;
  sha256: string;
};

type RemoteCompletion = {
  requestFingerprint: string;
  responseFingerprint: string;
  remoteObjectId: string | null;
  validated: boolean;
  usage: MetaUsageSnapshot;
};

type FailureClassification = {
  errorClass:
    | "TRANSPORT"
    | "RATE_LIMIT"
    | "AUTH"
    | "META"
    | "PROTOCOL"
    | "PREFLIGHT"
    | "RECONCILIATION";
  errorCode: string;
  remoteOutcome: "NOT_APPLIED" | "UNKNOWN" | "PERMANENT";
  retryAfterSeconds: number;
};

export type MetaMutationExecutorDependencies = {
  claim(workerId: string, leaseSeconds: number): Promise<MetaExecutorClaim | null>;
  heartbeat(
    executionId: string,
    leaseToken: string,
    leaseSeconds: number,
  ): Promise<void>;
  claimStep(
    executionId: string,
    leaseToken: string,
  ): Promise<MetaExecutorStep | null>;
  beginDispatch(
    executionId: string,
    stepId: string,
    leaseToken: string,
  ): Promise<void>;
  bindings(
    executionId: string,
    leaseToken: string,
  ): Promise<MetaRemoteBinding[]>;
  completeRemote(input: {
    executionId: string;
    stepId: string;
    leaseToken: string;
    completion: RemoteCompletion;
  }): Promise<void>;
  recordSnapshot(input: {
    executionId: string;
    stepId: string;
    leaseToken: string;
    objectId: string;
    value: Readonly<Record<string, unknown>>;
    responseFingerprint: string;
  }): Promise<void>;
  reconcile(
    executionId: string,
    stepId: string,
    leaseToken: string,
  ): Promise<"SUCCEEDED" | "MISMATCH">;
  fail(input: {
    executionId: string;
    stepId: string;
    leaseToken: string;
    failure: FailureClassification;
  }): Promise<string>;
  credentials(
    platformAccountId: string,
    userId: string,
  ): Promise<MetaExecutorCredentials>;
  brandAsset(input: {
    platformAccountId: string;
    userId: string;
    assetId: string;
    expectedSha256: string;
  }): Promise<VerifiedBrandAsset>;
};

export class MetaMutationExecutorError extends Error {
  readonly code:
    | "claim_invalid"
    | "step_invalid"
    | "credential_invalid"
    | "binding_missing"
    | "asset_invalid"
    | "database_failed"
    | "step_limit_reached";

  constructor(code: MetaMutationExecutorError["code"]) {
    super(`Meta mutation executor failed: ${code}`);
    this.name = "MetaMutationExecutorError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("Required string is missing");
  }
  return value.trim();
}

function requiredUuid(value: unknown): string {
  const result = requiredString(value);
  if (!UUID_PATTERN.test(result)) {
    throw new TypeError("Invalid UUID");
  }
  return result;
}

function requiredNumericId(value: unknown): string {
  const result = requiredString(value).replace(/^act_/, "");
  if (!NUMERIC_ID_PATTERN.test(result)) {
    throw new TypeError("Invalid Meta object ID");
  }
  return result;
}

function requiredInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError("Invalid integer");
  }
  return value as number;
}

function requiredRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new TypeError("Object payload is required");
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredString(value);
}

function parseStep(value: unknown, includeHash: boolean): MetaExecutorStep {
  const row = requiredRecord(value);
  const stepId = requiredUuid(row.step_id);
  const stepIndex = requiredInteger(row.step_index, 0);
  const operation = requiredString(row.operation);
  const objectType = requiredString(row.object_type);
  const dispatchState = requiredString(row.dispatch_state ?? "NOT_DISPATCHED");
  const requestHash = includeHash ? requiredString(row.request_hash) : null;

  if (
    !STEP_OPERATIONS.has(operation)
    || !STEP_OBJECT_TYPES.has(objectType)
    || (requestHash !== null && !SHA256_PATTERN.test(requestHash))
    || dispatchState !== "NOT_DISPATCHED"
  ) {
    throw new MetaMutationExecutorError("step_invalid");
  }

  return {
    stepId,
    stepIndex,
    operation,
    objectType,
    plannedRequest: requiredRecord(row.planned_request),
    requestHash,
    dispatchState,
  };
}

function parseClaim(value: unknown): MetaExecutorClaim | null {
  const rowValue = Array.isArray(value) ? value[0] : value;
  if (rowValue === null || rowValue === undefined) return null;

  try {
    const row = requiredRecord(rowValue);
    const actionType = requiredString(row.action_type);
    const targetType = optionalString(row.target_type);
    if (!PLAN_ACTIONS.has(actionType)) {
      throw new TypeError("Invalid plan action");
    }

    return {
      executionId: requiredUuid(row.execution_id),
      planId: requiredUuid(row.plan_id),
      userId: requiredUuid(row.user_id),
      platformAccountId: requiredUuid(row.platform_account_id),
      policyId: requiredUuid(row.policy_id),
      leaseToken: requiredUuid(row.lease_token),
      actionType,
      targetType,
      targetKey: requiredString(row.target_key),
      plannedPayload: requiredRecord(row.planned_payload),
      expectedBefore: requiredRecord(row.expected_before),
      intendedAfter: requiredRecord(row.intended_after),
      firstStep: parseStep({
        step_id: row.first_step_id,
        step_index: 0,
        operation: row.first_step_operation,
        object_type: row.first_step_object_type,
        planned_request: row.first_step_request,
        dispatch_state: "NOT_DISPATCHED",
      }, false),
    };
  } catch (error) {
    if (error instanceof MetaMutationExecutorError) throw error;
    throw new MetaMutationExecutorError("claim_invalid");
  }
}

function parseClaimedStep(value: unknown): MetaExecutorStep | null {
  const rowValue = Array.isArray(value) ? value[0] : value;
  if (rowValue === null || rowValue === undefined) return null;
  try {
    return parseStep(rowValue, true);
  } catch {
    throw new MetaMutationExecutorError("step_invalid");
  }
}

function parseBindings(value: unknown): MetaRemoteBinding[] {
  if (!Array.isArray(value)) {
    throw new MetaMutationExecutorError("database_failed");
  }

  return value.map((item) => {
    const row = requiredRecord(item);
    const objectType = requiredString(row.object_type);
    const remoteObjectId = requiredString(row.remote_object_id);
    if (
      !STEP_OBJECT_TYPES.has(objectType)
      || (objectType === "IMAGE"
        ? !IMAGE_HASH_PATTERN.test(remoteObjectId)
        : !NUMERIC_ID_PATTERN.test(remoteObjectId))
    ) {
      throw new MetaMutationExecutorError("database_failed");
    }
    return {
      stepId: requiredUuid(row.step_id),
      objectType,
      remoteObjectId,
    };
  });
}

function resolveBindingValue(
  value: unknown,
  bindings: ReadonlyMap<string, MetaRemoteBinding>,
  depth = 0,
): unknown {
  if (depth > 20) {
    throw new MetaMutationExecutorError("binding_missing");
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveBindingValue(item, bindings, depth + 1));
  }
  if (!isRecord(value)) return value;

  if (Object.prototype.hasOwnProperty.call(value, "$binding_step_id")) {
    if (Object.keys(value).length !== 1) {
      throw new MetaMutationExecutorError("binding_missing");
    }
    const stepId = requiredUuid(value.$binding_step_id);
    const binding = bindings.get(stepId);
    if (!binding) {
      throw new MetaMutationExecutorError("binding_missing");
    }
    return binding.remoteObjectId;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      resolveBindingValue(nested, bindings, depth + 1),
    ]),
  );
}

function asMetaWriteValue(value: unknown, depth = 0): MetaWriteValue {
  if (depth > 20) throw new TypeError("Meta payload is too deeply nested");
  if (
    typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asMetaWriteValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        asMetaWriteValue(nested, depth + 1),
      ]),
    );
  }
  throw new TypeError("Unsupported Meta payload value");
}

function resolvedPayload(
  request: JsonRecord,
  bindings: ReadonlyMap<string, MetaRemoteBinding>,
): MetaWritePayload {
  const value = resolveBindingValue(request.payload, bindings);
  const payload = requiredRecord(value);
  return Object.fromEntries(
    Object.entries(payload).map(([key, nested]) => [key, asMetaWriteValue(nested)]),
  );
}

function parseMode(value: unknown): MetaMutationMode {
  if (value !== "validate_only" && value !== "execute") {
    throw new TypeError("Invalid Meta mutation mode");
  }
  return value;
}

function parseStatus(value: unknown): MetaDeliveryStatus {
  if (value !== "ACTIVE" && value !== "PAUSED") {
    throw new TypeError("Invalid Meta delivery status");
  }
  return value;
}

function parseBudgetType(value: unknown): MetaBudgetType {
  if (value !== "daily_budget" && value !== "lifetime_budget") {
    throw new TypeError("Invalid Meta budget type");
  }
  return value;
}

function objectKind(objectType: string): MetaWriteObjectKind {
  if (objectType === "CAMPAIGN") return "campaign";
  if (objectType === "AD_SET") return "ad_set";
  if (objectType === "CREATIVE") return "creative";
  if (objectType === "AD") return "ad";
  throw new TypeError("Object type cannot be read from Meta");
}

function usageForDatabase(usage: MetaUsageSnapshot): JsonRecord {
  return {
    app_percent: usage.appPercent,
    page_percent: usage.pagePercent,
    business_percent: usage.businessPercent,
    ad_account_percent: usage.adAccountPercent,
    insights_percent: usage.insightsPercent,
    retry_after_seconds: usage.retryAfterSeconds,
  };
}

function completionFromMutation(result: MetaMutationResult): RemoteCompletion {
  return {
    requestFingerprint: result.requestFingerprint,
    responseFingerprint: result.responseFingerprint,
    remoteObjectId: result.id,
    validated: result.validated,
    usage: result.usage,
  };
}

async function dispatchRemoteMutation(input: {
  claim: MetaExecutorClaim;
  step: MetaExecutorStep;
  credentials: MetaExecutorCredentials;
  bindings: ReadonlyMap<string, MetaRemoteBinding>;
  dependencies: MetaMutationExecutorDependencies;
  beforeRemote(): Promise<void>;
}): Promise<RemoteCompletion> {
  const { claim, step, credentials, bindings, dependencies } = input;
  const request = step.plannedRequest;
  const operation = requiredString(request.operation);
  const auth = {
    accessToken: credentials.accessToken,
    appSecret: credentials.appSecret,
  };

  if (operation === "UPDATE_BUDGET") {
    const mode = parseMode(request.mode);
    const objectId = requiredNumericId(request.object_id);
    const budgetType = parseBudgetType(request.budget_type);
    const amountMinor = requiredInteger(request.amount_minor, 1);
    if (step.objectType !== "CAMPAIGN" && step.objectType !== "AD_SET") {
      throw new TypeError("Budget update object type is invalid");
    }
    await input.beforeRemote();
    const result = step.objectType === "CAMPAIGN"
      ? await updateMetaCampaignBudget({
        ...auth,
        objectId,
        budgetType,
        amountMinor,
        mode,
      })
      : await updateMetaAdSetBudget({
        ...auth,
        objectId,
        budgetType,
        amountMinor,
        mode,
      });
    return completionFromMutation(result);
  }

  if (operation === "UPDATE_STATUS") {
    const mode = parseMode(request.mode);
    const objectId = requiredNumericId(request.object_id);
    const status = parseStatus(request.status);
    if (
      step.objectType !== "CAMPAIGN"
      && step.objectType !== "AD_SET"
      && step.objectType !== "AD"
    ) {
      throw new TypeError("Status update object type is invalid");
    }
    await input.beforeRemote();
    const result = step.objectType === "CAMPAIGN"
      ? await updateMetaCampaignStatus({ ...auth, objectId, status, mode })
      : step.objectType === "AD_SET"
        ? await updateMetaAdSetStatus({ ...auth, objectId, status, mode })
        : await updateMetaAdStatus({ ...auth, objectId, status, mode });
    return completionFromMutation(result);
  }

  if (operation === "UPLOAD_IMAGE") {
    if (step.operation !== "CREATE" || step.objectType !== "IMAGE") {
      throw new TypeError("Image upload step contract is invalid");
    }
    const assetId = requiredUuid(request.brand_asset_id);
    const expectedSha256 = requiredString(request.asset_sha256);
    if (!SHA256_PATTERN.test(expectedSha256)) {
      throw new TypeError("Invalid expected asset SHA-256");
    }
    const asset = await dependencies.brandAsset({
      platformAccountId: claim.platformAccountId,
      userId: claim.userId,
      assetId,
      expectedSha256,
    });
    await input.beforeRemote();
    const result = await uploadMetaAdImage({
      ...auth,
      adAccountId: credentials.adAccountId,
      bytes: asset.bytes,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    });
    if (result.assetSha256 !== asset.sha256) {
      throw new MetaMutationExecutorError("asset_invalid");
    }
    return {
      requestFingerprint: result.requestFingerprint,
      responseFingerprint: result.responseFingerprint,
      remoteObjectId: result.hash,
      validated: false,
      usage: result.usage,
    };
  }

  const mode = operation === "CREATE_CREATIVE"
    ? (step.operation === "VALIDATE" ? "validate_only" : "execute")
    : parseMode(request.mode);
  const payload = resolvedPayload(request, bindings);
  const base = {
    ...auth,
    adAccountId: credentials.adAccountId,
    payload,
  };

  if (operation === "CREATE_CAMPAIGN" && step.objectType === "CAMPAIGN") {
    await input.beforeRemote();
    return completionFromMutation(await createMetaCampaign({ ...base, mode }));
  }
  if (operation === "CREATE_AD_SET" && step.objectType === "AD_SET") {
    await input.beforeRemote();
    return completionFromMutation(await createMetaAdSet({ ...base, mode }));
  }
  if (operation === "CREATE_CREATIVE" && step.objectType === "CREATIVE") {
    if (step.operation !== "CREATE" && step.operation !== "VALIDATE") {
      throw new TypeError("Creative steps must be CREATE or VALIDATE");
    }
    await input.beforeRemote();
    return completionFromMutation(await createMetaAdCreative({ ...base, mode }));
  }
  if (operation === "CREATE_AD" && step.objectType === "AD") {
    await input.beforeRemote();
    return completionFromMutation(await createMetaAd({ ...base, mode }));
  }

  throw new TypeError("Unsupported allowlisted Meta mutation operation");
}

function classifyFailure(
  error: unknown,
  step: MetaExecutorStep,
  dispatchPersisted: boolean,
): FailureClassification {
  if (error instanceof MetaWriteTransportError) {
    return {
      errorClass: "TRANSPORT",
      errorCode: `meta_${error.operation}_transport`,
      remoteOutcome: error.outcome === "unknown" ? "UNKNOWN" : "NOT_APPLIED",
      retryAfterSeconds: 120,
    };
  }

  if (error instanceof MetaGraphError) {
    return {
      errorClass: error.rateLimited ? "RATE_LIMIT" : error.reconnectRequired ? "AUTH" : "META",
      errorCode: error.reconnectRequired
        ? "meta_auth_reconnect_required"
        : error.rateLimited
          ? `meta_rate_limit_${error.code ?? error.status}`
          : `meta_graph_${error.code ?? error.status}`,
      remoteOutcome: "NOT_APPLIED",
      retryAfterSeconds: error.usage.retryAfterSeconds ?? (error.rateLimited ? 900 : 120),
    };
  }

  if (error instanceof MetaWriteProtocolError) {
    const isExecutedMutation = dispatchPersisted
      && step.operation !== "VALIDATE"
      && step.operation !== "READ"
      && step.operation !== "RECONCILE";
    return {
      errorClass: "PROTOCOL",
      errorCode: `meta_${error.operation}_protocol`,
      remoteOutcome: isExecutedMutation ? "UNKNOWN" : "NOT_APPLIED",
      retryAfterSeconds: 120,
    };
  }

  if (error instanceof MetaMutationExecutorError) {
    const databaseFailure = error.code === "database_failed";
    return {
      errorClass: databaseFailure ? "TRANSPORT" : "PREFLIGHT",
      errorCode: error.code,
      remoteOutcome: databaseFailure ? "NOT_APPLIED" : dispatchPersisted ? "PERMANENT" : "NOT_APPLIED",
      retryAfterSeconds: 120,
    };
  }

  return {
    errorClass: "PREFLIGHT",
    errorCode: error instanceof TypeError ? "invalid_planned_request" : "executor_local_failure",
    remoteOutcome: dispatchPersisted ? "PERMANENT" : "NOT_APPLIED",
    retryAfterSeconds: 120,
  };
}

function terminalOutcome(status: string): MetaExecutorOutcome {
  if (status === "RETRYABLE") return "retryable";
  if (status === "RECONCILING") return "ambiguous";
  if (status === "SUCCEEDED") return "succeeded";
  return "failed";
}

export async function runMetaMutationExecutorOnce(input: {
  workerId: string;
  dependencies: MetaMutationExecutorDependencies;
  maxSteps?: number;
}): Promise<MetaExecutorRunResult> {
  if (!WORKER_ID_PATTERN.test(input.workerId)) {
    throw new TypeError("Invalid Meta executor worker ID");
  }
  const maxSteps = Math.max(
    1,
    Math.min(META_EXECUTOR_MAX_STEPS_PER_RUN, input.maxSteps ?? META_EXECUTOR_MAX_STEPS_PER_RUN),
  );
  const claim = await input.dependencies.claim(
    input.workerId,
    META_EXECUTOR_LEASE_SECONDS,
  );
  if (!claim) {
    return { processed: false, outcome: "idle", stepsProcessed: 0 };
  }

  let credentials: MetaExecutorCredentials;
  try {
    credentials = await input.dependencies.credentials(
      claim.platformAccountId,
      claim.userId,
    );
  } catch (error) {
    const failure = classifyFailure(error, claim.firstStep, false);
    const status = await input.dependencies.fail({
      executionId: claim.executionId,
      stepId: claim.firstStep.stepId,
      leaseToken: claim.leaseToken,
      failure,
    });
    return { processed: true, outcome: terminalOutcome(status), stepsProcessed: 0 };
  }

  let step: MetaExecutorStep | null = claim.firstStep;
  let stepsProcessed = 0;

  while (step && stepsProcessed < maxSteps) {
    await input.dependencies.heartbeat(
      claim.executionId,
      claim.leaseToken,
      META_EXECUTOR_LEASE_SECONDS,
    );

    if (step.operation === "READ") {
      try {
        const bindings = new Map(
          (await input.dependencies.bindings(claim.executionId, claim.leaseToken))
            .map((binding) => [binding.stepId, binding]),
        );
        const resolved = resolveBindingValue(step.plannedRequest.object_id, bindings);
        const objectId = requiredNumericId(resolved);
        const snapshot = await getMetaWriteObjectSnapshot({
          ...credentials,
          kind: objectKind(step.objectType),
          objectId,
        });
        await input.dependencies.recordSnapshot({
          executionId: claim.executionId,
          stepId: step.stepId,
          leaseToken: claim.leaseToken,
          objectId: snapshot.id,
          value: snapshot.value,
          responseFingerprint: snapshot.responseFingerprint,
        });
        stepsProcessed += 1;
      } catch (error) {
        const failure = classifyFailure(error, step, false);
        const status = await input.dependencies.fail({
          executionId: claim.executionId,
          stepId: step.stepId,
          leaseToken: claim.leaseToken,
          failure,
        });
        return {
          processed: true,
          outcome: terminalOutcome(status),
          stepsProcessed,
        };
      }
    } else if (step.operation === "RECONCILE") {
      try {
        const outcome = await input.dependencies.reconcile(
          claim.executionId,
          step.stepId,
          claim.leaseToken,
        );
        return {
          processed: true,
          outcome: outcome === "SUCCEEDED" ? "succeeded" : "mismatch",
          stepsProcessed: stepsProcessed + 1,
        };
      } catch (error) {
        const invalidResult = error instanceof TypeError;
        const failure: FailureClassification = {
          errorClass: invalidResult ? "RECONCILIATION" : "TRANSPORT",
          errorCode: invalidResult
            ? "reconciliation_result_invalid"
            : "reconciliation_rpc_failed",
          remoteOutcome: invalidResult ? "PERMANENT" : "NOT_APPLIED",
          retryAfterSeconds: 120,
        };
        const status = await input.dependencies.fail({
          executionId: claim.executionId,
          stepId: step.stepId,
          leaseToken: claim.leaseToken,
          failure,
        });
        return {
          processed: true,
          outcome: terminalOutcome(status),
          stepsProcessed,
        };
      }
    } else {
      let dispatchPersisted = false;
      let remoteCompleted = false;
      try {
        const bindingRows = await input.dependencies.bindings(
          claim.executionId,
          claim.leaseToken,
        );
        const bindings = new Map(
          bindingRows.map((binding) => [binding.stepId, binding]),
        );
        const completion = await dispatchRemoteMutation({
          claim,
          step,
          credentials,
          bindings,
          dependencies: input.dependencies,
          async beforeRemote() {
            await input.dependencies.beginDispatch(
              claim.executionId,
              step!.stepId,
              claim.leaseToken,
            );
            dispatchPersisted = true;
          },
        });
        remoteCompleted = true;
        await input.dependencies.completeRemote({
          executionId: claim.executionId,
          stepId: step.stepId,
          leaseToken: claim.leaseToken,
          completion,
        });
        stepsProcessed += 1;
      } catch (error) {
        const failure = remoteCompleted
          ? {
            errorClass: "TRANSPORT" as const,
            errorCode: "remote_completion_persist_failed",
            remoteOutcome: step.operation === "VALIDATE" ? "NOT_APPLIED" as const : "UNKNOWN" as const,
            retryAfterSeconds: 120,
          }
          : classifyFailure(error, step, dispatchPersisted);
        const status = await input.dependencies.fail({
          executionId: claim.executionId,
          stepId: step.stepId,
          leaseToken: claim.leaseToken,
          failure,
        });
        return {
          processed: true,
          outcome: terminalOutcome(status),
          stepsProcessed,
        };
      }
    }

    step = await input.dependencies.claimStep(
      claim.executionId,
      claim.leaseToken,
    );
  }

  if (step) {
    throw new MetaMutationExecutorError("step_limit_reached");
  }

  return { processed: true, outcome: "deferred", stepsProcessed };
}

async function rpcData(name: string, args: JsonRecord): Promise<unknown> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new MetaMutationExecutorError("database_failed");
  return data;
}

async function loadExecutorCredentials(
  platformAccountId: string,
  userId: string,
): Promise<MetaExecutorCredentials> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_accounts")
    .select(
      "id,user_id,account_id,access_token_encrypted,token_iv,token_auth_tag,expires_at,data_access_expires_at",
    )
    .eq("id", platformAccountId)
    .eq("user_id", userId)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    throw new MetaMutationExecutorError("database_failed");
  }
  if (!data) {
    throw new MetaMutationExecutorError("credential_invalid");
  }
  const row = data as Record<string, unknown>;
  const expiresAt = optionalString(row.expires_at);
  const dataAccessExpiresAt = optionalString(row.data_access_expires_at);
  const minimumExpiry = Date.now() + 5 * 60 * 1000;
  for (const value of [expiresAt, dataAccessExpiresAt]) {
    if (value !== null) {
      const parsed = Date.parse(value);
      if (!Number.isFinite(parsed) || parsed <= minimumExpiry) {
        throw new MetaMutationExecutorError("credential_invalid");
      }
    }
  }

  const env = getMetaSyncEnv();
  try {
    const accessToken = decryptAccessToken(
      {
        ciphertext: requiredString(row.access_token_encrypted),
        iv: requiredString(row.token_iv),
        authTag: requiredString(row.token_auth_tag),
      },
      env.tokenEncryptionKey,
    );
    return {
      accessToken,
      appSecret: env.appSecret,
      adAccountId: normalizeMetaWriteAdAccountId(requiredString(row.account_id)),
    };
  } catch {
    throw new MetaMutationExecutorError("credential_invalid");
  }
}

async function loadVerifiedBrandAsset(input: {
  platformAccountId: string;
  userId: string;
  assetId: string;
  expectedSha256: string;
}): Promise<VerifiedBrandAsset> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select(
      "id,sha256,mime_type,byte_size,width,height,storage_bucket,storage_path,original_filename,status,moderation_status,meta_image_hash",
    )
    .eq("id", input.assetId)
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("status", "READY")
    .eq("moderation_status", "APPROVED")
    .maybeSingle();

  if (error) {
    throw new MetaMutationExecutorError("database_failed");
  }
  if (!data) {
    throw new MetaMutationExecutorError("asset_invalid");
  }
  const row = data as Record<string, unknown>;
  const sha256 = requiredString(row.sha256);
  const mimeType = requiredString(row.mime_type) as CreativeImageMimeType;
  const bucket = requiredString(row.storage_bucket);
  const path = requiredString(row.storage_path);
  if (
    sha256 !== input.expectedSha256
    || !SHA256_PATTERN.test(sha256)
    || (mimeType !== "image/png" && mimeType !== "image/jpeg")
    || row.meta_image_hash !== null
  ) {
    throw new MetaMutationExecutorError("asset_invalid");
  }

  const downloaded = await admin.storage.from(bucket).download(path);
  if (downloaded.error || !downloaded.data) {
    throw new MetaMutationExecutorError("asset_invalid");
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const inspected = inspectCreativeImage({ bytes, declaredMimeType: mimeType });
  if (
    inspected.sha256 !== sha256
    || inspected.byteSize !== requiredInteger(row.byte_size, 1)
    || inspected.width !== requiredInteger(row.width, 1)
    || inspected.height !== requiredInteger(row.height, 1)
  ) {
    throw new MetaMutationExecutorError("asset_invalid");
  }

  return {
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    mimeType: inspected.mimeType,
    fileName: safeCreativeFileName({
      requestedName: optionalString(row.original_filename),
      jobId: input.assetId,
      mimeType: inspected.mimeType,
    }),
  };
}

export function createMetaMutationExecutorDependencies(): MetaMutationExecutorDependencies {
  return {
    async claim(workerId, leaseSeconds) {
      return parseClaim(await rpcData("claim_next_meta_mutation_execution", {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      }));
    },
    async heartbeat(executionId, leaseToken, leaseSeconds) {
      const data = await rpcData("heartbeat_meta_mutation_execution", {
        p_execution_id: executionId,
        p_lease_token: leaseToken,
        p_lease_seconds: leaseSeconds,
      });
      if (data !== true) throw new MetaMutationExecutorError("database_failed");
    },
    async claimStep(executionId, leaseToken) {
      return parseClaimedStep(await rpcData("claim_next_meta_mutation_step", {
        p_execution_id: executionId,
        p_lease_token: leaseToken,
      }));
    },
    async beginDispatch(executionId, stepId, leaseToken) {
      const data = await rpcData("begin_meta_mutation_step_dispatch", {
        p_execution_id: executionId,
        p_step_id: stepId,
        p_lease_token: leaseToken,
      });
      const row = Array.isArray(data) && data.length === 1 ? data[0] : data;
      if (!isRecord(row)) throw new MetaMutationExecutorError("database_failed");
      const operation = requiredString(row.operation);
      const objectType = requiredString(row.object_type);
      const requestHash = requiredString(row.request_hash);
      requiredUuid(row.plan_id);
      requiredRecord(row.planned_request);
      if (
        !STEP_OPERATIONS.has(operation)
        || !STEP_OBJECT_TYPES.has(objectType)
        || !SHA256_PATTERN.test(requestHash)
      ) {
        throw new MetaMutationExecutorError("database_failed");
      }
    },
    async bindings(executionId, leaseToken) {
      return parseBindings(await rpcData("get_meta_mutation_remote_bindings", {
        p_execution_id: executionId,
        p_lease_token: leaseToken,
      }));
    },
    async completeRemote(input) {
      const data = await rpcData("complete_meta_mutation_remote_step", {
        p_execution_id: input.executionId,
        p_step_id: input.stepId,
        p_lease_token: input.leaseToken,
        p_request_fingerprint: input.completion.requestFingerprint,
        p_response_fingerprint: input.completion.responseFingerprint,
        p_remote_object_id: input.completion.remoteObjectId,
        p_remote_request_id: null,
        p_validated: input.completion.validated,
        p_usage_snapshot: usageForDatabase(input.completion.usage),
      });
      if (data !== true) throw new MetaMutationExecutorError("database_failed");
    },
    async recordSnapshot(input) {
      const data = await rpcData("record_meta_mutation_remote_snapshot", {
        p_execution_id: input.executionId,
        p_step_id: input.stepId,
        p_lease_token: input.leaseToken,
        p_snapshot_kind: "READ_AFTER_WRITE",
        p_remote_object_id: input.objectId,
        p_snapshot_payload: input.value,
        p_response_fingerprint: input.responseFingerprint,
        p_remote_request_id: null,
      });
      if (typeof data !== "string" || !UUID_PATTERN.test(data)) {
        throw new MetaMutationExecutorError("database_failed");
      }
    },
    async reconcile(executionId, stepId, leaseToken) {
      const data = await rpcData("reconcile_meta_mutation_plan", {
        p_execution_id: executionId,
        p_step_id: stepId,
        p_lease_token: leaseToken,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!isRecord(row) || (row.outcome !== "SUCCEEDED" && row.outcome !== "MISMATCH")) {
        throw new TypeError("Invalid reconciliation result");
      }
      return row.outcome;
    },
    async fail(input) {
      const result = await rpcData("fail_meta_mutation_execution", {
        p_execution_id: input.executionId,
        p_step_id: input.stepId,
        p_lease_token: input.leaseToken,
        p_error_class: input.failure.errorClass,
        p_error_code: input.failure.errorCode,
        p_remote_outcome: input.failure.remoteOutcome,
        p_retry_after_seconds: Math.max(
          30,
          Math.min(86_400, input.failure.retryAfterSeconds),
        ),
      });
      return requiredString(result);
    },
    credentials: loadExecutorCredentials,
    brandAsset: loadVerifiedBrandAsset,
  };
}

export async function processNextMetaMutation(
  workerId: string,
): Promise<MetaExecutorRunResult> {
  return runMetaMutationExecutorOnce({
    workerId,
    dependencies: createMetaMutationExecutorDependencies(),
  });
}
