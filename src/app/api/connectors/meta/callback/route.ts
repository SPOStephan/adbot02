import { NextResponse } from "next/server";

import {
  exchangeCodeForAccessToken,
  getMetaIdentity,
} from "@/lib/meta/client";
import { encryptAccessToken, verifyOAuthState } from "@/lib/meta/crypto";
import { getMetaCallbackEnv } from "@/lib/meta/env";
import { APP_SITE_URL, createPortalUrl } from "@/lib/site-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const META_CALLBACK_PATH = "/api/connectors/meta/callback";
const DAY_IN_SECONDS = 24 * 60 * 60;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 60 * DAY_IN_SECONDS;
const TOKEN_REFRESH_AFTER_SECONDS = 45 * DAY_IN_SECONDS;

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

    const redirectUri = `${APP_SITE_URL}${META_CALLBACK_PATH}`;
    const token = await exchangeCodeForAccessToken({
      appId,
      appSecret,
      code,
      redirectUri,
    });
    const identity = await getMetaIdentity({
      accessToken: token.accessToken,
      appSecret,
    });
    const encryptedToken = encryptAccessToken(
      token.accessToken,
      tokenEncryptionKey,
    );

    const now = new Date();
    const expiresInSeconds =
      token.expiresInSeconds && token.expiresInSeconds > 0
        ? token.expiresInSeconds
        : DEFAULT_TOKEN_LIFETIME_SECONDS;
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
    const refreshDelaySeconds = Math.max(
      1,
      Math.min(
        TOKEN_REFRESH_AFTER_SECONDS,
        Math.floor(expiresInSeconds * 0.75),
      ),
    );
    const refreshAt = new Date(
      now.getTime() + refreshDelaySeconds * 1000,
    );

    const admin = createAdminClient();
    const { error } = await admin.from("platform_accounts").upsert(
      {
        user_id: user.id,
        platform: "meta",
        platform_account_id: identity.id,
        account_id: identity.id,
        account_name: `Meta-Konto ${identity.id}`,
        access_token_encrypted: encryptedToken.ciphertext,
        token_iv: encryptedToken.iv,
        token_auth_tag: encryptedToken.authTag,
        token_version: 1,
        meta_user_id: identity.id,
        meta_business_id: null,
        ad_account_ids: [],
        page_ids: [],
        instagram_account_ids: [],
        expires_at: expiresAt.toISOString(),
        refresh_at: refreshAt.toISOString(),
        connected_at: now.toISOString(),
        updated_at: now.toISOString(),
        revoked_at: null,
      },
      {
        onConflict: "user_id,platform",
      },
    );

    if (error) {
      console.error("[meta-oauth] Connector konnte nicht gespeichert werden");
      return dashboardRedirect("error", "storage");
    }

    return dashboardRedirect("connected");
  } catch {
    console.error("[meta-oauth] Callback konnte nicht verarbeitet werden");
    return dashboardRedirect("error", "callback");
  }
}
