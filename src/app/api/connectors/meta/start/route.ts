import { NextResponse } from "next/server";

import { createMetaLoginUrl } from "@/lib/meta/client";
import { createOAuthState } from "@/lib/meta/crypto";
import { getMetaCallbackEnv } from "@/lib/meta/env";
import { APP_SITE_URL, createPortalUrl } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const META_CALLBACK_PATH = "/api/connectors/meta/callback";

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = createPortalUrl("/login");
    loginUrl.searchParams.set("next", "/dashboard");
    return noStoreRedirect(loginUrl);
  }

  try {
    const { appId, loginConfigId, stateSecret } = getMetaCallbackEnv();
    const redirectUri = `${APP_SITE_URL}${META_CALLBACK_PATH}`;
    const state = createOAuthState(user.id, stateSecret);
    const metaLoginUrl = createMetaLoginUrl({
      appId,
      configId: loginConfigId,
      redirectUri,
      state,
    });

    return noStoreRedirect(metaLoginUrl);
  } catch {
    console.error("[meta-oauth] Startkonfiguration nicht verfügbar");
    const errorUrl = createPortalUrl("/dashboard");
    errorUrl.searchParams.set("meta_error", "configuration");
    return noStoreRedirect(errorUrl);
  }
}
