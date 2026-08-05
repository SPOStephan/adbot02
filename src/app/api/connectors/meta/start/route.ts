import { NextResponse } from "next/server";

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

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = createPortalUrl("/login");
    loginUrl.searchParams.set("next", "/dashboard");
    return noStoreRedirect(loginUrl, 303);
  }

  let stage = "environment";

  try {
    const {
      appId,
      appSecret,
      loginConfigId,
      stateSecret,
      tokenEncryptionKey,
    } = getMetaCallbackEnv();

    stage = "authorization_reset";
    const reset = await resetStoredMetaAuthorization({
      userId: user.id,
      appId,
      appSecret,
      tokenEncryptionKey,
    });

    stage = "login_redirect";
    const redirectUri = `${APP_SITE_URL}${META_CALLBACK_PATH}`;
    const state = createOAuthState(
      user.id,
      stateSecret,
      Date.now(),
      reset.authorizationReset,
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
      kind: error instanceof MetaGraphError ? "meta_graph" : "internal",
      code: error instanceof MetaGraphError ? error.code : null,
    });
    const errorUrl = createPortalUrl("/dashboard");
    errorUrl.searchParams.set("meta", "error");
    errorUrl.searchParams.set("meta_error", "authorization_reset");
    return noStoreRedirect(errorUrl, 303);
  }
}
