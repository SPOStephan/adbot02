import { NextRequest } from "next/server";

import { completeKireadyLogin, kireadyLoginErrorRedirect } from "@/lib/kiready/complete-login";
import { clearOidcFlowCookies, decodePendingLink, KIREADY_COOKIE } from "@/lib/kiready/cookies";
import { getKireadyOidcEnv, isKireadyOidcConfigured } from "@/lib/kiready/env";
import { APP_SITE_URL } from "@/lib/site-urls";
import type { KireadyAdbotContext } from "@/lib/kiready/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secure =
    request.nextUrl.protocol === "https:" || APP_SITE_URL.startsWith("https://");
  if (!isKireadyOidcConfigured()) {
    return kireadyLoginErrorRedirect("KIready-Anmeldung ist noch nicht konfiguriert.");
  }

  const env = getKireadyOidcEnv();
  const pending = decodePendingLink(request.cookies.get(KIREADY_COOKIE.pending)?.value, env.stateSecret);
  if (!pending) {
    const response = kireadyLoginErrorRedirect("Die Kontoverknüpfung ist abgelaufen. Bitte erneut mit KIready anmelden.");
    clearOidcFlowCookies(response, secure);
    return response;
  }

  const form = await request.formData();
  if (form.get("confirm") !== "1") {
    const response = kireadyLoginErrorRedirect("Kontoverknüpfung abgebrochen. Es wurden keine Daten zusammengeführt.");
    clearOidcFlowCookies(response, secure);
    return response;
  }

  const context: KireadyAdbotContext = {
    version: "2026-09-20",
    identity: {
      subject: pending.subject,
      email: pending.email,
      emailVerified: true,
    },
    organization: {
      id: pending.organizationId,
      name: pending.organizationName,
      slug: pending.organizationSlug,
    },
    membership: {
      role: pending.role,
      permissions: pending.permissions,
    },
    entitlement: {
      productCode: "adbot",
      planCode: pending.entitlementPlanCode,
      status: pending.entitlementStatus,
      validUntil: pending.entitlementValidUntil,
      hasAccess: pending.entitlementHasAccess,
    },
  };

  return completeKireadyLogin({
    env,
    context,
    userId: pending.existingUserId,
    email: pending.email,
    next: pending.next,
    tokens: { accessToken: "", refreshToken: null, expiresIn: null },
    secure,
  });
}
