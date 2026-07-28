import { NextResponse } from "next/server";

import {
  debugMetaAccessToken,
  exchangeCodeForAccessToken,
  exchangeForLongLivedAccessToken,
  getGranularTargetIds,
  getMetaConnectionAssets,
  getMetaIdentity,
  META_ALLOWED_SCOPES,
  MetaGraphError,
} from "@/lib/meta/client";
import { encryptAccessToken, verifyOAuthState } from "@/lib/meta/crypto";
import { getMetaCallbackEnv } from "@/lib/meta/env";
import { createPortalUrl } from "@/lib/site-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_IN_SECONDS = 24 * 60 * 60;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 60 * DAY_IN_SECONDS;
const TOKEN_REFRESH_AFTER_SECONDS = 45 * DAY_IN_SECONDS;
const AUTOMATIC_META_SCOPES = new Set(["public_profile"]);

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function dashboardRedirect(status: "connected" | "error", reason?: string) {
  const url = createPortalUrl("/dashboard");
  url.searchParams.set("meta", status);

  if (reason) {
    url.searchParams.set("meta_error", reason);
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

  try {
    const {
      appId,
      appSecret,
      stateSecret,
      tokenEncryptionKey,
    } = getMetaCallbackEnv();

    if (!verifyOAuthState(state, stateSecret, user.id)) {
      return dashboardRedirect("error", "invalid_state");
    }

    const shortLivedToken = await exchangeCodeForAccessToken({
      appId,
      appSecret,
      code,
      redirectUri: createPortalUrl("/api/connectors/meta/callback").toString(),
    });
    const longLivedToken = await exchangeForLongLivedAccessToken({
      appId,
      appSecret,
      shortLivedAccessToken: shortLivedToken.accessToken,
    });
    const tokenDebug = await debugMetaAccessToken({
      appId,
      appSecret,
      accessToken: longLivedToken.accessToken,
    });
    const identity = await getMetaIdentity({
      accessToken: longLivedToken.accessToken,
      appSecret,
    });
    const grantedScopes = new Set(tokenDebug.scopes);
    const missingScopes = META_ALLOWED_SCOPES.filter(
      (scope) => !grantedScopes.has(scope),
    );
    const unexpectedScopes = tokenDebug.scopes.filter(
      (scope) =>
        !META_ALLOWED_SCOPES.includes(
          scope as (typeof META_ALLOWED_SCOPES)[number],
        ) && !AUTOMATIC_META_SCOPES.has(scope),
    );

    if (
      !tokenDebug.isValid ||
      tokenDebug.appId !== appId ||
      !tokenDebug.userId ||
      tokenDebug.userId !== identity.id
    ) {
      return dashboardRedirect("error", "token_validation");
    }

    if (missingScopes.length || unexpectedScopes.length) {
      return dashboardRedirect("error", "scope_validation");
    }

    const allowedPageIds = new Set([
      ...getGranularTargetIds(tokenDebug, "pages_show_list"),
      ...getGranularTargetIds(tokenDebug, "pages_read_engagement"),
    ]);
    const allowedAdAccountIds = getGranularTargetIds(tokenDebug, "ads_read");
    const assets = await getMetaConnectionAssets({
      accessToken: longLivedToken.accessToken,
      appSecret,
      allowedPageIds,
      allowedAdAccountIds,
    });
    const instagramAccounts = assets.pages.flatMap((page) =>
      page.instagramAccount ? [page.instagramAccount] : [],
    );

    if (
      !assets.pages.length ||
      !instagramAccounts.length ||
      !assets.adAccounts.length
    ) {
      return dashboardRedirect("error", "no_assets");
    }

    const pageIds = assets.pages.map((page) => page.id);
    const adAccountIds = assets.adAccounts.map((account) => account.id);
    const instagramAccountIds = instagramAccounts.map((account) => account.id);
    const assetRows = [
      ...assets.pages.map((page) => ({
        asset_type: "facebook_page",
        meta_asset_id: page.id,
        parent_meta_asset_id: null,
        name: page.name,
        username: null,
      })),
      ...assets.pages.flatMap((page) =>
        page.instagramAccount
          ? [
              {
                asset_type: "instagram_account",
                meta_asset_id: page.instagramAccount.id,
                parent_meta_asset_id: page.id,
                name:
                  page.instagramAccount.name ??
                  page.instagramAccount.username ??
                  "Instagram-Profil",
                username: page.instagramAccount.username,
              },
            ]
          : [],
      ),
      ...assets.adAccounts.map((account) => ({
        asset_type: "ad_account",
        meta_asset_id: account.id,
        parent_meta_asset_id: null,
        name: account.name,
        username: null,
      })),
    ];
    const encryptedToken = encryptAccessToken(
      longLivedToken.accessToken,
      tokenEncryptionKey,
    );
    const times = tokenTimes({
      expiresAt: tokenDebug.expiresAt,
      expiresInSeconds: longLivedToken.expiresInSeconds,
    });
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

    return dashboardRedirect("connected");
  } catch (error) {
    console.error("[meta-oauth] Callback konnte nicht verarbeitet werden", {
      kind: error instanceof MetaGraphError ? "meta_graph" : "internal",
      code: error instanceof MetaGraphError ? error.code : null,
    });
    return dashboardRedirect("error", "callback");
  }
}
