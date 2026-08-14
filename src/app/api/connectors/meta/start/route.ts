import { NextRequest, NextResponse } from "next/server";

import { resetStoredMetaAuthorization } from "@/lib/meta/authorization-reset";
import { createMetaLoginUrl, MetaGraphError } from "@/lib/meta/client";
import { createOAuthState } from "@/lib/meta/crypto";
import { getMetaCallbackEnv } from "@/lib/meta/env";
import { APP_SITE_URL, createPortalUrl } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const META_CALLBACK_PATH = "/api/connectors/meta/callback";

function noStoreRedirect(url: URL, status: 303 | 307 = 307) {
  const response = NextResponse.redirect(url, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = createPortalUrl("/login");
    loginUrl.searchParams.set("next", "/dashboard");
    return noStoreRedirect(loginUrl, 303);
  }

  const intent =
    new URL(request.url).searchParams.get("intent") === "extend"
      ? "extend"
      : "reconnect";

  let stage = "environment";

  try {
    const {
      appId,
      appSecret,
      loginConfigId,
      stateSecret,
      tokenEncryptionKey,
    } = getMetaCallbackEnv();

    let authorizationReset = false;

    if (intent === "extend") {
      // Additive: keep existing Meta grant + Adbot assets; only open dialog for more.
      stage = "extend_login_redirect";
      authorizationReset = false;
    } else {
      stage = "authorization_reset";
      const reset = await resetStoredMetaAuthorization({
        userId: user.id,
        appId,
        appSecret,
        tokenEncryptionKey,
      });
      authorizationReset = reset.authorizationReset;
      stage = "login_redirect";
    }

    const redirectUri = `${APP_SITE_URL}${META_CALLBACK_PATH}`;
    const state = createOAuthState(
      user.id,
      stateSecret,
      Date.now(),
      authorizationReset,
      intent,
    );
    const metaLoginUrl = createMetaLoginUrl({
      appId,
      configId: loginConfigId,
      redirectUri,
      state,
    });

    return noStoreRedirect(metaLoginUrl, 303);
  } catch (error) {
    console.error("[meta-oauth] Frischer Meta-Start fehlgeschlagen", {
      stage,
      intent,
      kind: error instanceof MetaGraphError ? "meta_graph" : "internal",
      code: error instanceof MetaGraphError ? error.code : null,
    });
    const errorUrl = createPortalUrl("/dashboard");
    errorUrl.searchParams.set("meta", "error");
    errorUrl.searchParams.set(
      "meta_error",
      intent === "extend" ? "extend_start" : "authorization_reset",
    );
    return noStoreRedirect(errorUrl, 303);
  }
}
