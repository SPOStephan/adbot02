import { NextResponse } from "next/server";

import { drainHardCapStatusExecutionsForAccount } from "@/lib/meta/hard-cap-status-execute";
import { syncMetaConnector } from "@/lib/meta/sync";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: Record<string, unknown>, status = 200, retryAt?: string | null) {
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };

  if (retryAt) {
    const retryTimestamp = new Date(retryAt).getTime();

    if (Number.isFinite(retryTimestamp)) {
      const seconds = Math.max(
        1,
        Math.ceil((retryTimestamp - Date.now()) / 1000),
      );
      headers["Retry-After"] = String(seconds);
    }
  }

  return NextResponse.json(body, { status, headers });
}

async function authenticatedConnector() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, connector: null };
  }

  const { data } = await supabase
    .from("platform_accounts")
    .select(
      "id,sync_status,sync_error_code,last_sync_started_at,last_synced_at,next_sync_at,data_access_expires_at,last_sync_seen_count,last_sync_new_count,baseline_completed_at",
    )
    .eq("user_id", user.id)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();

  return { supabase, user, connector: data };
}

export async function GET() {
  const { user, connector } = await authenticatedConnector();

  if (!user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (!connector) {
    return json({ ok: true, connected: false });
  }

  return json({
    ok: true,
    connected: true,
    status: connector.sync_status,
    errorCode: connector.sync_error_code,
    lastSyncStartedAt: connector.last_sync_started_at,
    lastSyncedAt: connector.last_synced_at,
    nextSyncAt: connector.next_sync_at,
    dataAccessExpiresAt: connector.data_access_expires_at,
    baselineCompleted: Boolean(connector.baseline_completed_at),
    seenCount: connector.last_sync_seen_count ?? 0,
    newCount: connector.last_sync_new_count ?? 0,
  });
}

export async function POST() {
  const { user, connector } = await authenticatedConnector();

  if (!user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (!connector) {
    return json({ ok: false, error: "not_connected" }, 404);
  }

  const result = await syncMetaConnector({
    platformAccountId: connector.id,
    userId: user.id,
    mode: "manual",
  });

  if (result.outcome === "blocked") {
    const status = result.blockedReason === "not_found" ? 404 : 429;
    return json(
      {
        ok: false,
        error: result.blockedReason,
        retryAt: result.retryAt,
      },
      status,
      result.retryAt,
    );
  }

  // After READ_SYNC lease release: push hard-cap ACTIVATE/SAFETY_PAUSE to Meta
  // immediately so day-resume does not wait only on the minutely cron.
  let hardCapDrain: {
    duePlans: number;
    runs: number;
    succeeded: number;
    failed: number;
    lastOutcome: string | null;
    lastError: string | null;
  } | null = null;
  try {
    const drain = await drainHardCapStatusExecutionsForAccount({
      platformAccountId: connector.id,
      userId: user.id,
      maxRuns: 8,
    });
    hardCapDrain = {
      duePlans: drain.duePlans,
      runs: drain.runs,
      succeeded: drain.succeeded,
      failed: drain.failed,
      lastOutcome: drain.lastOutcome,
      lastError: drain.lastError,
    };
  } catch {
    hardCapDrain = {
      duePlans: 0,
      runs: 0,
      succeeded: 0,
      failed: 0,
      lastOutcome: null,
      lastError: "hard_cap_status_drain_exception",
    };
  }

  return json({
    ok: result.status === "success" || result.status === "partial",
    status: result.status,
    seenCount: result.seenCount,
    newCount: result.newCount,
    syncedAssetCount: result.syncedAssetCount,
    failedAssetCount: result.failedAssetCount,
    nextSyncAt: result.nextSyncAt,
    retryAt: result.retryAt,
    organicBoost: {
      status: result.organicBoostStatus,
      plansCreated: result.organicBoostPlansCreated,
      plansExisting: result.organicBoostPlansExisting,
      candidatesFailed: result.organicBoostCandidatesFailed,
      candidatesSkipped: result.organicBoostCandidatesSkipped,
      candidatesConsidered: result.organicBoostCandidatesConsidered,
      lastError: result.organicBoostLastError,
    },
    hardCapStatus: hardCapDrain,
  });
}
