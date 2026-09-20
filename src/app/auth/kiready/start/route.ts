import { NextRequest, NextResponse } from "next/server";

import { normalizeSafeNextPath } from "@/lib/auth/safe-next-path";
import { randomOidcValue } from "@/lib/kiready/crypto";
import { setOidcFlowCookies } from "@/lib/kiready/cookies";
import { getKireadyOidcEnv, isKireadyOidcConfigured } from "@/lib/kiready/env";
import {
  buildKireadyAuthorizeUrl,
  createPkcePair,
  loadKireadyDiscovery,
} from "@/lib/kiready/oidc";
import { kireadyLoginErrorRedirect } from "@/lib/kiready/complete-login";
import { APP_SITE_URL } from "@/lib/site-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isKireadyOidcConfigured()) {
    return kireadyLoginErrorRedirect(
      "KIready-Anmeldung ist noch nicht konfiguriert. Client-ID und Secret fehlen.",
    );
  }

  try {
    const env = getKireadyOidcEnv();
    const discovery = await loadKireadyDiscovery(env.issuer);
    const state = randomOidcValue();
    const nonce = randomOidcValue();
    const { verifier, challenge } = createPkcePair();
    const next = normalizeSafeNextPath(request.nextUrl.searchParams.get("next"));
    const authorizeUrl = buildKireadyAuthorizeUrl({
      env,
      authorizationEndpoint: discovery.authorization_endpoint,
      state,
      nonce,
      challenge,
    });
    const response = NextResponse.redirect(authorizeUrl);
    setOidcFlowCookies(response, {
      state,
      nonce,
      verifier,
      next,
      secure: request.nextUrl.protocol === "https:" || APP_SITE_URL.startsWith("https://"),
    });
    return response;
  } catch {
    return kireadyLoginErrorRedirect("KIready-Anmeldung konnte nicht gestartet werden.");
  }
}
