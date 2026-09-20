import { NextRequest, NextResponse } from "next/server";

import { normalizeSafeNextPath } from "@/lib/auth/safe-next-path";
import { completeKireadyLogin, kireadyLoginErrorRedirect } from "@/lib/kiready/complete-login";
import {
  fetchKireadyAdbotContext,
  hasPersonalAdbotUse,
} from "@/lib/kiready/context";
import {
  clearOidcFlowCookies,
  decodePendingLink,
  KIREADY_COOKIE,
  setPendingLinkCookie,
} from "@/lib/kiready/cookies";
import { decideAccessFromContext, denialMessage } from "@/lib/kiready/entitlement";
import { getKireadyOidcEnv, isKireadyOidcConfigured } from "@/lib/kiready/env";
import {
  createLocalAdbotUser,
  findIdentity,
  findUsersByVerifiedEmail,
} from "@/lib/kiready/identities";
import {
  exchangeKireadyCode,
  loadKireadyDiscovery,
  verifyKireadyIdToken,
} from "@/lib/kiready/oidc";
import { KIREADY_LINK_PATH } from "@/lib/kiready/public";
import { APP_SITE_URL } from "@/lib/site-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secure =
    request.nextUrl.protocol === "https:" || APP_SITE_URL.startsWith("https://");

  if (!isKireadyOidcConfigured()) {
    return kireadyLoginErrorRedirect("KIready-Anmeldung ist noch nicht konfiguriert.");
  }

  const errorParam = request.nextUrl.searchParams.get("error");
  if (errorParam) {
    return kireadyLoginErrorRedirect("KIready hat die Anmeldung abgebrochen.");
  }

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(KIREADY_COOKIE.state)?.value;
  const nonce = request.cookies.get(KIREADY_COOKIE.nonce)?.value;
  const verifier = request.cookies.get(KIREADY_COOKIE.verifier)?.value;
  const next = normalizeSafeNextPath(request.cookies.get(KIREADY_COOKIE.next)?.value);

  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !nonce || !verifier) {
    const response = kireadyLoginErrorRedirect("Ungültiger oder abgelaufener KIready-Anmeldevorgang.");
    clearOidcFlowCookies(response, secure);
    return response;
  }

  try {
    const env = getKireadyOidcEnv();
    const discovery = await loadKireadyDiscovery(env.issuer);
    const tokens = await exchangeKireadyCode({
      env,
      tokenEndpoint: discovery.token_endpoint,
      code,
      verifier,
    });
    const claims = await verifyKireadyIdToken({
      env,
      jwksUri: discovery.jwks_uri,
      idToken: tokens.idToken,
      nonce,
    });
    const context = await fetchKireadyAdbotContext({
      contextUrl: env.contextUrl,
      accessToken: tokens.accessToken,
    });

    if (context.identity.subject !== claims.sub) {
      return kireadyLoginErrorRedirect("KIready-Identität und Kontext passen nicht zusammen.");
    }
    if (!context.identity.emailVerified) {
      return kireadyLoginErrorRedirect("Die KIready-E-Mail-Adresse ist nicht bestätigt.");
    }

    const access = decideAccessFromContext(context);
    if (!access.allowDashboard && !hasPersonalAdbotUse(context)) {
      return kireadyLoginErrorRedirect(denialMessage(access.reason));
    }
    if (!access.allowDashboard) {
      return kireadyLoginErrorRedirect(denialMessage(access.reason));
    }

    const existing = await findIdentity({ issuer: env.issuer, subject: context.identity.subject });
    if (existing) {
      return completeKireadyLogin({
        env,
        context,
        userId: existing,
        email: context.identity.email,
        next,
        tokens,
        secure,
      });
    }

    const matches = await findUsersByVerifiedEmail(context.identity.email);
    if (matches.length > 1) {
      return kireadyLoginErrorRedirect(
        "Mehrere Adbot-Konten nutzen diese E-Mail. Automatische Verknüpfung ist nicht möglich.",
      );
    }
    if (matches.length === 1) {
      const pending = {
        v: 1 as const,
        issuer: env.issuer,
        subject: context.identity.subject,
        email: context.identity.email,
        organizationId: context.organization.id,
        organizationName: context.organization.name,
        organizationSlug: context.organization.slug,
        role: context.membership.role,
        permissions: context.membership.permissions,
        entitlementStatus: context.entitlement.status,
        entitlementPlanCode: context.entitlement.planCode,
        entitlementValidUntil: context.entitlement.validUntil,
        entitlementHasAccess: context.entitlement.hasAccess,
        existingUserId: matches[0],
        next,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 10 * 60,
      };
      const response = NextResponse.redirect(new URL(KIREADY_LINK_PATH, `${APP_SITE_URL}/`));
      setPendingLinkCookie(response, pending, env.stateSecret, secure);
      return response;
    }

    const userId = await createLocalAdbotUser(context.identity.email);
    return completeKireadyLogin({
      env,
      context,
      userId,
      email: context.identity.email,
      next,
      tokens,
      secure,
    });
  } catch {
    const response = kireadyLoginErrorRedirect("KIready-Anmeldung konnte nicht abgeschlossen werden.");
    clearOidcFlowCookies(response, secure);
    return response;
  }
}
