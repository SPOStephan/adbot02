import { NextResponse } from "next/server";

import { loadContentSyncSnapshot } from "@/lib/meta/content-sync-snapshot";
import {
  drainHardCapStatusExecutionsForAccount,
  forceReactivatePausedOrganicBoostCampaigns,
} from "@/lib/meta/hard-cap-status-execute";
import { syncMetaConnector } from "@/lib/meta/sync";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const { supabase, user, connector } = await authenticatedConnector();

  if (!user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (!connector) {
    return json({ ok: true, connected: false });
  }

  const snapshot = await loadContentSyncSnapshot({
    supabase,
    userId: user.id,
    platformAccountId: connector.id,
    connector,
  });

  return json({
    ok: true,
    connected: true,
    status: snapshot.status,
    errorCode: snapshot.errorCode,
    lastSyncStartedAt: snapshot.lastSyncStartedAt,
    lastSyncedAt: snapshot.lastSyncedAt,
    nextSyncAt: snapshot.nextSyncAt,
    displayNextSyncAt: snapshot.displayNextSyncAt,
    dataAccessExpiresAt: connector.data_access_expires_at,
    baselineCompleted: snapshot.baselineCompleted,
    seenCount: snapshot.seenCount,
    newCount: snapshot.newCount,
    storedCandidateCount: snapshot.storedCandidateCount,
    candidates: snapshot.candidates,
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

  // After READ_SYNC lease release: force-queue ACTIVATE for wrongly paused
  // Beitrag-Push campaigns (even over hard-cap), then drain to Meta.
  let hardCapForceResume: {
    outcome: string;
    reason: string | null;
    created: number;
    existing: number;
    blocked: number;
    revived: number;
    exposuresCleared: number;
    scheduleEnded: number;
    candidates: number;
    linked: number;
    activeLocal: number;
    adsetPausedOnly: number;
    targetsRepaired: number;
    remainingUnder24h: number;
    missingCurrent: number;
    adSetsActivated: number;
    adsActivated: number;
    campaignsMissingAds: number;
    error: string | null;
  } | null = null;
  let hardCapDrain: {
    duePlans: number;
    runs: number;
    succeeded: number;
    failed: number;
    lastOutcome: string | null;
    lastError: string | null;
  } | null = null;

  try {
    const admin = createAdminClient();
    const { data: accountRow } = await admin
      .from("platform_accounts")
      .select("marketing_sync_id")
      .eq("id", connector.id)
      .eq("user_id", user.id)
      .maybeSingle();
    const marketingSyncId =
      typeof accountRow?.marketing_sync_id === "string"
        ? accountRow.marketing_sync_id
        : null;

    if (marketingSyncId) {
      const forceResume = await forceReactivatePausedOrganicBoostCampaigns({
        platformAccountId: connector.id,
        userId: user.id,
        marketingSyncId,
      });
      hardCapForceResume = {
        outcome: forceResume.outcome,
        reason: forceResume.reason,
        created: forceResume.created,
        existing: forceResume.existing,
        blocked: forceResume.blocked,
        revived: forceResume.revived,
        exposuresCleared: forceResume.exposuresCleared,
        scheduleEnded: forceResume.scheduleEnded,
        candidates: forceResume.candidates,
        linked: forceResume.linked,
        activeLocal: forceResume.activeLocal,
        adsetPausedOnly: forceResume.adsetPausedOnly,
        targetsRepaired: forceResume.targetsRepaired,
        remainingUnder24h: forceResume.remainingUnder24h,
        missingCurrent: forceResume.missingCurrent,
        adSetsActivated: forceResume.adSetsActivated,
        adsActivated: forceResume.adsActivated,
        campaignsMissingAds: forceResume.campaignsMissingAds,
        error: forceResume.error,
      };
    }
  } catch {
    hardCapForceResume = {
      outcome: "ERROR",
      reason: "force_resume_exception",
      created: 0,
      existing: 0,
      blocked: 0,
      revived: 0,
      exposuresCleared: 0,
      scheduleEnded: 0,
      candidates: 0,
      linked: 0,
      activeLocal: 0,
      adsetPausedOnly: 0,
      targetsRepaired: 0,
      remainingUnder24h: 0,
      missingCurrent: 0,
      adSetsActivated: 0,
      adsActivated: 0,
      campaignsMissingAds: 0,
      error: "force_resume_exception",
    };
  }

  try {
    const drain = await drainHardCapStatusExecutionsForAccount({
      platformAccountId: connector.id,
      userId: user.id,
      maxRuns: 20,
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
    errorCode: result.errorCode,
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
    hardCapForceResume,
    hardCapStatus: hardCapDrain,
  });
}
