import "server-only";

import { randomUUID } from "node:crypto";

import { decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import {
  MetaMarketingDataError,
  syncMetaMarketingSnapshot,
} from "@/lib/meta/marketing-sync";
import {
  claimMetaReadOperation,
  releaseMetaAccountOperation,
  runMetaBudgetPlannerAfterSnapshot,
} from "@/lib/meta/planner";
import { createAdminClient } from "@/lib/supabase/admin";

/** Matches SQL launch freshness window (marketing_last_success_at >= now() - 2h). */
const LAUNCH_MARKETING_FRESH_MS = 2 * 60 * 60 * 1_000;

export type LaunchMarketingCustomer = {
  userId: string;
  platformAccountId: string;
  marketingSyncId: string | null;
};

export type EnsureLaunchMarketingResult =
  | { ok: true; marketingSyncId: string; refreshed: boolean }
  | { ok: false; message: string };

type LaunchMarketingState = {
  ready: boolean;
  marketingSyncId: string | null;
  timezoneName: string | null;
  currency: string | null;
  reason: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readLaunchMarketingState(
  customer: LaunchMarketingCustomer,
): Promise<LaunchMarketingState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_accounts")
    .select(
      "marketing_sync_id,marketing_sync_status,marketing_last_success_at,marketing_timezone_name,marketing_currency",
    )
    .eq("id", customer.platformAccountId)
    .eq("user_id", customer.userId)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    return {
      ready: false,
      marketingSyncId: null,
      timezoneName: null,
      currency: null,
      reason: "account_unavailable",
    };
  }

  const lastSuccessAt =
    typeof data.marketing_last_success_at === "string"
      ? Date.parse(data.marketing_last_success_at)
      : Number.NaN;
  const now = Date.now();
  const marketingSyncId =
    typeof data.marketing_sync_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(data.marketing_sync_id)
      ? data.marketing_sync_id
      : null;
  const timezoneName =
    typeof data.marketing_timezone_name === "string" &&
    data.marketing_timezone_name.trim()
      ? data.marketing_timezone_name.trim()
      : null;
  const currency =
    typeof data.marketing_currency === "string" ? data.marketing_currency : null;

  if (data.marketing_sync_status !== "success" || !marketingSyncId) {
    return {
      ready: false,
      marketingSyncId,
      timezoneName,
      currency,
      reason: "marketing_sync_missing",
    };
  }
  if (
    !Number.isFinite(lastSuccessAt) ||
    lastSuccessAt < now - LAUNCH_MARKETING_FRESH_MS
  ) {
    return {
      ready: false,
      marketingSyncId,
      timezoneName,
      currency,
      reason: "marketing_sync_stale",
    };
  }
  // Reject absurd future timestamps (clock skew) — same idea as authenticateMetaCustomer.
  if (lastSuccessAt > now + 60 * 1_000) {
    return {
      ready: false,
      marketingSyncId,
      timezoneName,
      currency,
      reason: "marketing_sync_clock_skew",
    };
  }
  if (!timezoneName) {
    return {
      ready: false,
      marketingSyncId,
      timezoneName,
      currency,
      reason: "marketing_timezone_missing",
    };
  }
  if (currency !== "EUR") {
    return {
      ready: false,
      marketingSyncId,
      timezoneName,
      currency,
      reason: "currency_not_eur",
    };
  }

  return {
    ready: true,
    marketingSyncId,
    timezoneName,
    currency,
    reason: null,
  };
}

async function runLaunchMarketingSync(
  customer: LaunchMarketingCustomer,
): Promise<void> {
  const admin = createAdminClient();
  const [
    { data: account, error: accountError },
    { data: adAccount, error: adError },
  ] = await Promise.all([
    admin
      .from("platform_accounts")
      .select(
        "access_token_encrypted,token_iv,token_auth_tag,expires_at,data_access_expires_at",
      )
      .eq("id", customer.platformAccountId)
      .eq("user_id", customer.userId)
      .eq("platform", "meta")
      .is("revoked_at", null)
      .maybeSingle(),
    admin
      .from("meta_assets")
      .select("meta_asset_id")
      .eq("platform_account_id", customer.platformAccountId)
      .eq("user_id", customer.userId)
      .eq("asset_type", "ad_account")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (accountError || !account) {
    throw new Error("meta_account_unavailable");
  }
  if (adError || !adAccount?.meta_asset_id) {
    throw new Error("ad_account_missing");
  }
  if (
    !account.access_token_encrypted ||
    !account.token_iv ||
    !account.token_auth_tag
  ) {
    throw new Error("token_missing");
  }

  const env = getMetaSyncEnv();
  const accessToken = decryptAccessToken(
    {
      ciphertext: account.access_token_encrypted,
      iv: account.token_iv,
      authTag: account.token_auth_tag,
    },
    env.tokenEncryptionKey,
  );

  const leaseToken = await claimMetaReadOperation({
    platformAccountId: customer.platformAccountId,
    userId: customer.userId,
    ownerId: `launch-marketing:${customer.platformAccountId}:${randomUUID()}`,
    retries: 8,
    retryDelayMs: 2_000,
    leaseSeconds: 180,
  });
  if (!leaseToken) {
    throw new Error("read_lease_busy");
  }

  try {
    const marketingResult = await syncMetaMarketingSnapshot({
      platformAccountId: customer.platformAccountId,
      userId: customer.userId,
      adAccountId: adAccount.meta_asset_id,
      accessToken,
      appSecret: env.appSecret,
    });

    try {
      const plannedAt = new Date().toISOString();
      await runMetaBudgetPlannerAfterSnapshot({
        platformAccountId: customer.platformAccountId,
        userId: customer.userId,
        marketingSyncId: marketingResult.syncId,
        readLeaseToken: leaseToken,
        campaignBudgetSharingSnapshot:
          marketingResult.campaignBudgetSharingSnapshot,
        plannedAt,
      });
    } catch {
      // Exposure snapshot can still be bootstrapped later in prepare.
    }
  } finally {
    await releaseMetaAccountOperation({
      platformAccountId: customer.platformAccountId,
      userId: customer.userId,
      leaseToken,
    });
  }
}

async function normalizeLaunchTimezoneIfNeeded(
  customer: LaunchMarketingCustomer,
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_accounts")
    .select("marketing_timezone_name")
    .eq("id", customer.platformAccountId)
    .eq("user_id", customer.userId)
    .maybeSingle();
  const timezone =
    typeof data?.marketing_timezone_name === "string"
      ? data.marketing_timezone_name.trim()
      : "";

  let known = false;
  if (timezone) {
    const { data: valid, error } = await admin.rpc("meta_timezone_is_known", {
      p_timezone_name: timezone,
    });
    // Unknown OR helper/RPC unavailable → coerce.
    known = !error && valid === true;
  }

  if (timezone && known) {
    return;
  }

  await admin
    .from("platform_accounts")
    .update({ marketing_timezone_name: "Europe/Berlin" })
    .eq("id", customer.platformAccountId)
    .eq("user_id", customer.userId);
}

/**
 * Ensures launch SQL gates can pass: EUR + timezone + sync id fresher than 2h.
 *
 * Launch does NOT need a full Meta Abruf (campaigns/ads/insights). That Abruf
 * is for dashboard/boost inventory. Prepare reuses a fresh sync when present
 * and only syncs when missing/stale — otherwise Traffic prepare takes ~1–2 min
 * for no launch benefit.
 */
export async function ensureLaunchMarketingReady(
  customer: LaunchMarketingCustomer,
): Promise<EnsureLaunchMarketingResult> {
  const initial = await readLaunchMarketingState(customer);
  if (initial.ready && initial.marketingSyncId) {
    await normalizeLaunchTimezoneIfNeeded(customer);
    const afterNormalize = await readLaunchMarketingState(customer);
    if (afterNormalize.ready && afterNormalize.marketingSyncId) {
      return {
        ok: true,
        marketingSyncId: afterNormalize.marketingSyncId,
        refreshed: false,
      };
    }
  }

  let lastDetail = initial.reason ?? "marketing_not_ready";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await runLaunchMarketingSync(customer);
      await normalizeLaunchTimezoneIfNeeded(customer);
      const next = await readLaunchMarketingState(customer);
      if (next.ready && next.marketingSyncId) {
        return {
          ok: true,
          marketingSyncId: next.marketingSyncId,
          refreshed: true,
        };
      }
      lastDetail = next.reason ?? "marketing_not_ready";
    } catch (error) {
      lastDetail =
        error instanceof MetaMarketingDataError
          ? error.code
          : error instanceof Error
            ? error.message
            : "unknown";
      console.error("launch_marketing_sync_attempt_failed", {
        attempt,
        detail: lastDetail,
      });
      if (
        (lastDetail === "read_lease_busy" ||
          error instanceof MetaMarketingDataError) &&
        attempt < 2
      ) {
        await sleep(2_500);
        continue;
      }
      break;
    }
  }

  const fallback = await readLaunchMarketingState(customer);
  if (fallback.ready && fallback.marketingSyncId) {
    return {
      ok: true,
      marketingSyncId: fallback.marketingSyncId,
      refreshed: false,
    };
  }

  if (lastDetail === "read_lease_busy") {
    return {
      ok: false,
      message:
        "Meta-Daten werden gerade aktualisiert. Bitte die Vorbereitung in wenigen Sekunden erneut starten.",
    };
  }
  if (
    lastDetail === "ad_account_missing" ||
    lastDetail === "token_missing" ||
    lastDetail === "meta_account_unavailable"
  ) {
    return {
      ok: false,
      message:
        "Meta ist nicht vollständig verbunden. Bitte Meta erneut verbinden und dann die Kampagne vorbereiten.",
    };
  }
  if (lastDetail === "currency_not_eur") {
    return {
      ok: false,
      message: "Das Meta-Werbekonto muss auf EUR laufen.",
    };
  }

  return {
    ok: false,
    message:
      "Die Meta-Kontodaten konnten nicht automatisch aktualisiert werden. Bitte die Vorbereitung erneut starten.",
  };
}
