import "server-only";

import { createAdminClient } from "../supabase/admin";
import type { MetaCampaignBudgetSharingSnapshot } from "./marketing-sync";

const META_ACCOUNT_READ_LEASE_SECONDS = 15 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MetaBudgetPlannerStatus =
  | "READ_LEASE_REQUIRED"
  | "ACCOUNT_UNAVAILABLE"
  | "STALE_OR_INVALID_SNAPSHOT"
  | "INVALID_PLANNER_TIME"
  | "NO_ACTIVE_POLICY"
  | "NO_BUDGET_OWNERS"
  | "HARD_CAP_SAFETY"
  | "KILL_SWITCH_BLOCKED"
  | "PLANNED";

export type MetaBudgetPlannerResult = {
  status: MetaBudgetPlannerStatus;
  snapshotId: string | null;
  accountDay: string | null;
  observedBudgetOwnerCount: number;
  reservedExposureMinor: number;
  plansCreated: number;
  plansExisting: number;
  candidatesBlocked: number;
  hardCapBreach: boolean;
};

export class MetaBudgetPlannerError extends Error {
  readonly code:
    | "lease_claim_failed"
    | "sharing_snapshot_failed"
    | "planner_failed"
    | "planner_result_invalid"
    | "lease_release_failed";

  constructor(code: MetaBudgetPlannerError["code"]) {
    super(`Meta budget planner failed: ${code}`);
    this.name = "MetaBudgetPlannerError";
    this.code = code;
  }
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function parsePlannerResult(value: unknown): MetaBudgetPlannerResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    throw new MetaBudgetPlannerError("planner_result_invalid");
  }

  const record = row as Record<string, unknown>;
  const allowedStatuses = new Set<MetaBudgetPlannerStatus>([
    "READ_LEASE_REQUIRED",
    "ACCOUNT_UNAVAILABLE",
    "STALE_OR_INVALID_SNAPSHOT",
    "INVALID_PLANNER_TIME",
    "NO_ACTIVE_POLICY",
    "NO_BUDGET_OWNERS",
    "HARD_CAP_SAFETY",
    "KILL_SWITCH_BLOCKED",
    "PLANNED",
  ]);
  const status = record.planner_status;
  const snapshotId = nullableString(record.snapshot_id);
  const accountDay = nullableString(record.account_day);
  const observedBudgetOwnerCount = integer(record.observed_budget_owner_count);
  const reservedExposureMinor = integer(record.reserved_exposure_minor);
  const plansCreated = integer(record.plans_created);
  const plansExisting = integer(record.plans_existing);
  const candidatesBlocked = integer(record.candidates_blocked);

  if (
    typeof status !== "string" ||
    !allowedStatuses.has(status as MetaBudgetPlannerStatus) ||
    snapshotId === undefined ||
    (snapshotId !== null && !UUID_PATTERN.test(snapshotId)) ||
    accountDay === undefined ||
    (accountDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(accountDay)) ||
    observedBudgetOwnerCount === null ||
    reservedExposureMinor === null ||
    plansCreated === null ||
    plansExisting === null ||
    candidatesBlocked === null ||
    typeof record.hard_cap_breach !== "boolean"
  ) {
    throw new MetaBudgetPlannerError("planner_result_invalid");
  }

  return {
    status: status as MetaBudgetPlannerStatus,
    snapshotId,
    accountDay,
    observedBudgetOwnerCount,
    reservedExposureMinor,
    plansCreated,
    plansExisting,
    candidatesBlocked,
    hardCapBreach: record.hard_cap_breach,
  };
}

export async function claimMetaReadOperation(input: {
  platformAccountId: string;
  userId: string;
  ownerId: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_meta_account_operation", {
    p_platform_account_id: input.platformAccountId,
    p_user_id: input.userId,
    p_lease_kind: "READ_SYNC",
    p_owner_id: input.ownerId,
    p_lease_seconds: META_ACCOUNT_READ_LEASE_SECONDS,
  });

  if (error) {
    throw new MetaBudgetPlannerError("lease_claim_failed");
  }

  if (data === null) return null;
  if (typeof data !== "string" || !UUID_PATTERN.test(data)) {
    throw new MetaBudgetPlannerError("lease_claim_failed");
  }

  return data;
}

export async function runMetaBudgetPlannerAfterSnapshot(input: {
  platformAccountId: string;
  userId: string;
  marketingSyncId: string;
  readLeaseToken: string;
  campaignBudgetSharingSnapshot: MetaCampaignBudgetSharingSnapshot[];
  plannedAt: string;
}): Promise<MetaBudgetPlannerResult> {
  const admin = createAdminClient();
  const sharing = await admin.rpc(
    "record_meta_campaign_budget_sharing_snapshot",
    {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
      p_source_marketing_sync_id: input.marketingSyncId,
      p_read_lease_token: input.readLeaseToken,
      p_campaigns: input.campaignBudgetSharingSnapshot,
    },
  );

  if (sharing.error) {
    throw new MetaBudgetPlannerError("sharing_snapshot_failed");
  }

  const planner = await admin.rpc("run_meta_budget_planner", {
    p_platform_account_id: input.platformAccountId,
    p_user_id: input.userId,
    p_source_marketing_sync_id: input.marketingSyncId,
    p_read_lease_token: input.readLeaseToken,
    p_planned_at: input.plannedAt,
  });

  if (planner.error) {
    throw new MetaBudgetPlannerError("planner_failed");
  }

  return parsePlannerResult(planner.data);
}

export async function releaseMetaAccountOperation(input: {
  platformAccountId: string;
  userId: string;
  leaseToken: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_meta_account_operation", {
    p_platform_account_id: input.platformAccountId,
    p_user_id: input.userId,
    p_lease_token: input.leaseToken,
  });

  if (error || data !== true) {
    throw new MetaBudgetPlannerError("lease_release_failed");
  }
}
