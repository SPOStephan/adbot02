import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  debugMetaAccessToken,
  exchangeCodeForAccessToken,
  getGranularTargetIds,
  getMetaConnectionAssets,
  getMetaIdentity,
  META_ALLOWED_SCOPES,
  MetaGraphError,
  resolveMetaSelectedAdAccountIds,
  resolveMetaSelectedPageIds,
  resolvePersistedMetaAccessToken,
} from "@/lib/meta/client";
import { encryptAccessToken, verifyOAuthState } from "@/lib/meta/crypto";
import { getMetaCallbackEnv } from "@/lib/meta/env";
import { classifyMetaGrantedScopes } from "@/lib/meta/scope-policy.mjs";
import { createPortalUrl } from "@/lib/site-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_IN_SECONDS = 24 * 60 * 60;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 60 * DAY_IN_SECONDS;
const TOKEN_REFRESH_AFTER_SECONDS = 45 * DAY_IN_SECONDS;

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function dashboardRedirect(
  status: "connected" | "error",
  reason?: string,
  details?: {
    missingScopes?: string[];
    unexpectedScopes?: string[];
    stage?: string;
  },
) {
  const url = createPortalUrl("/dashboard");
  url.searchParams.set("meta", status);

  if (reason) {
    url.searchParams.set("meta_error", reason);
  }

  if (details?.missingScopes?.length) {
    url.searchParams.set("meta_missing_scopes", details.missingScopes.join(","));
  }

  if (details?.unexpectedScopes?.length) {
    url.searchParams.set(
      "meta_unexpected_scopes",
      details.unexpectedScopes.join(","),
    );
  }

  if (details?.stage) {
    url.searchParams.set("meta_callback_stage", details.stage);
  }

  return noStoreRedirect(url);
}

function tokenTimes(input: {
  expiresAt: Date | null;
  expiresInSeconds: number | null;
}) {
  const now = new Date();
  const expiresInSeconds =
    input.expiresInSeconds && input.expiresInSeconds > 0
      ? input.expiresInSeconds
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  const expiresAt =
    input.expiresAt ?? new Date(now.getTime() + expiresInSeconds * 1000);
  const effectiveLifetimeSeconds = Math.max(
    1,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
  );
  const refreshDelaySeconds = Math.max(
    1,
    Math.min(
      TOKEN_REFRESH_AFTER_SECONDS,
      Math.floor(effectiveLifetimeSeconds * 0.75),
    ),
  );

  return {
    expiresAt,
    refreshAt: new Date(now.getTime() + refreshDelaySeconds * 1000),
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const providerError = requestUrl.searchParams.get("error");

  if (providerError) {
    const reason = providerError === "access_denied" ? "cancelled" : "provider";
    return dashboardRedirect("error", reason);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = createPortalUrl("/login");
    loginUrl.searchParams.set("next", "/dashboard");
    loginUrl.searchParams.set("error", "Meta-Verbindung benötigt eine aktive Sitzung");
    return noStoreRedirect(loginUrl);
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (!code || !state) {
    return dashboardRedirect("error", "missing_response");
  }

  let stage = "environment";

  try {
    const {
      appId,
      appSecret,
      stateSecret,
      tokenEncryptionKey,
    } = getMetaCallbackEnv();

    stage = "state_validation";
    if (!verifyOAuthState(state, stateSecret, user.id)) {
      return dashboardRedirect("error", "invalid_state");
    }

    stage = "code_exchange";
    const codeAccessToken = await exchangeCodeForAccessToken({
      appId,
      appSecret,
      code,
      redirectUri: createPortalUrl("/api/connectors/meta/callback").toString(),
    });
    stage = "long_lived_token_exchange";
    const longLivedToken = await resolvePersistedMetaAccessToken({
      appId,
      appSecret,
      codeAccessToken,
    });
    stage = "token_debug";
    const tokenDebug = await debugMetaAccessToken({
      appId,
      appSecret,
      accessToken: longLivedToken.accessToken,
    });
    stage = "identity";
    const identity = await getMetaIdentity({
      accessToken: longLivedToken.accessToken,
      appSecret,
    });
    stage = "scope_validation";
    const {
      missingScopes,
      compatibleSystemUserScopes,
      unexpectedScopes,
    } = classifyMetaGrantedScopes(tokenDebug.scopes, META_ALLOWED_SCOPES);

    if (
      !tokenDebug.isValid ||
      tokenDebug.appId !== appId ||
      !tokenDebug.userId ||
      tokenDebug.userId !== identity.id
    ) {
      return dashboardRedirect("error", "token_validation");
    }

    if (missingScopes.length || unexpectedScopes.length) {
      return dashboardRedirect("error", "scope_validation", {
        missingScopes,
        unexpectedScopes,
      });
    }

    if (compatibleSystemUserScopes.length) {
      console.info("[meta-oauth] System-User-Kompatibilitätsscopes erkannt", {
        scopes: compatibleSystemUserScopes.sort(),
      });
    }

    const allowedInstagramAccountIds = new Set(
      getGranularTargetIds(tokenDebug, "instagram_basic"),
    );

    console.info("[meta-oauth] Granulare Meta-Auswahl (Ziel-IDs)", {
      instagramTargets: allowedInstagramAccountIds.size,
      granularScopes: tokenDebug.granularScopes.map((item) => ({
        scope: item.scope,
        targetCount: item.targetIds.length,
      })),
    });

    // Instagram must come from dialog target_ids. Pages/ads often omit
    // target_ids when Meta marks the permission as "applies to all" — then we
    // derive them from the selected Instagram / page linkage (never fall-open
    // to every /me asset).
    if (!allowedInstagramAccountIds.size) {
      return dashboardRedirect("error", "missing_instagram_targets");
    }

    stage = "asset_discovery";
    const pageSelection = await resolveMetaSelectedPageIds({
      accessToken: longLivedToken.accessToken,
      appSecret,
      tokenDebug,
      allowedInstagramAccountIds,
    });
    const allowedPageIds = pageSelection.pageIds;

    console.info("[meta-oauth] Seitenauswahl aufgelöst", {
      pageTargets: allowedPageIds.size,
      pageSource: pageSelection.source,
    });

    if (!allowedPageIds.size) {
      return dashboardRedirect("error", "missing_page_targets");
    }

    const adAccountSelection = await resolveMetaSelectedAdAccountIds({
      accessToken: longLivedToken.accessToken,
      appSecret,
      tokenDebug,
      allowedPageIds,
    });
    const allowedAdAccountIds = adAccountSelection.adAccountIds;

    console.info("[meta-oauth] Werbekonto-Auswahl aufgelöst", {
      adAccountTargets: allowedAdAccountIds.size,
      adAccountSource: adAccountSelection.source,
    });

    if (!allowedAdAccountIds.size) {
      return dashboardRedirect("error", "missing_ad_account_targets");
    }

    const assets = await getMetaConnectionAssets({
      accessToken: longLivedToken.accessToken,
      appSecret,
      allowedPageIds,
      allowedInstagramAccountIds,
      allowedAdAccountIds,
    });

    if (
      !assets.pages.length ||
      !assets.instagramAccounts.length ||
      !assets.adAccounts.length
    ) {
      console.warn("[meta-oauth] Ausgewählte Assets nicht lesbar", {
        pages: assets.pages.length,
        instagramAccounts: assets.instagramAccounts.length,
        adAccounts: assets.adAccounts.length,
        pageTargets: allowedPageIds.size,
        pageSource: pageSelection.source,
        instagramTargets: allowedInstagramAccountIds.size,
        adAccountTargets: allowedAdAccountIds.size,
        adAccountSource: adAccountSelection.source,
      });
      return dashboardRedirect("error", "no_assets");
    }

    console.info("[meta-oauth] Assetauswahl übernommen", {
      pageSource: pageSelection.source,
      adAccountSource: adAccountSelection.source,
      pages: assets.pages.map((page) => page.name),
      instagramUsernames: assets.instagramAccounts.map(
        (account) => account.username,
      ),
      adAccounts: assets.adAccounts.map((account) => account.name),
    });

    const pageIds = assets.pages.map((page) => page.id);
    const adAccountIds = assets.adAccounts.map((account) => account.id);
    const instagramAccountIds = assets.instagramAccounts.map(
      (account) => account.id,
    );
    const selectedInstagramAccountIds = new Set(instagramAccountIds);
    const parentPageIdByInstagramId = new Map(
      assets.pages.flatMap((page) =>
        page.instagramAccount &&
        selectedInstagramAccountIds.has(page.instagramAccount.id)
          ? [[page.instagramAccount.id, page.id] as const]
          : [],
      ),
    );
    const assetRows = [
      ...assets.pages.map((page) => ({
        asset_type: "facebook_page",
        meta_asset_id: page.id,
        parent_meta_asset_id: null,
        name: page.name,
        username: null,
      })),
      ...assets.instagramAccounts.map((account) => ({
        asset_type: "instagram_account",
        meta_asset_id: account.id,
        parent_meta_asset_id:
          parentPageIdByInstagramId.get(account.id) ?? null,
        name: account.name,
        username: account.username,
      })),
      ...assets.adAccounts.map((account) => ({
        asset_type: "ad_account",
        meta_asset_id: account.id,
        parent_meta_asset_id: null,
        name: account.name,
        username: null,
      })),
    ];
    stage = "token_encryption";
    const encryptedToken = encryptAccessToken(
      longLivedToken.accessToken,
      tokenEncryptionKey,
    );
    const times = tokenTimes({
      expiresAt: tokenDebug.expiresAt,
      expiresInSeconds: longLivedToken.expiresInSeconds,
    });
    stage = "storage";
    const admin = createAdminClient();
    const { error } = await admin.rpc("replace_meta_connection", {
      p_user_id: user.id,
      p_meta_user_id: identity.id,
      p_account_name: "Meta-Verbindung",
      p_access_token_encrypted: encryptedToken.ciphertext,
      p_token_iv: encryptedToken.iv,
      p_token_auth_tag: encryptedToken.authTag,
      p_expires_at: times.expiresAt.toISOString(),
      p_refresh_at: times.refreshAt.toISOString(),
      p_data_access_expires_at:
        tokenDebug.dataAccessExpiresAt?.toISOString() ?? null,
      p_scopes: [...META_ALLOWED_SCOPES],
      p_page_ids: pageIds,
      p_ad_account_ids: adAccountIds,
      p_instagram_account_ids: instagramAccountIds,
      p_assets: assetRows,
    });

    if (error) {
      console.error("[meta-oauth] Connector konnte nicht gespeichert werden", {
        code: error.code,
      });
      return dashboardRedirect("error", "storage");
    }

    stage = "revalidation";
    revalidatePath("/dashboard", "page");
    return dashboardRedirect("connected");
  } catch (error) {
    console.error("[meta-oauth] Callback konnte nicht verarbeitet werden", {
      stage,
      kind: error instanceof MetaGraphError ? "meta_graph" : "internal",
      code: error instanceof MetaGraphError ? error.code : null,
      name: error instanceof Error ? error.name : "unknown",
    });
    return dashboardRedirect("error", "callback", { stage });
  }
}
