import { NextRequest, NextResponse } from "next/server";

import { listCustomerCustomDomains } from "@/lib/custom-domains/service";
import {
  createFunnelSsoConsumeUrl,
  defaultFunnelAdminPath,
  isAllowedFunnelAdminPath,
  resolveCustomerFunnelAdminHostname,
  sharedFunnelHostname,
} from "@/lib/funnel-admin-host";
import { createFunnelSsoToken } from "@/lib/funnel-sso";
import { syncConfirmedPixelsToWorkspaces } from "@/lib/meta/customer-control-service";
import { createFunnelSsoEntryPath, createPortalUrl } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function noStoreRedirect(url: URL, status: 303 | 307 = 303) {
  const response = NextResponse.redirect(url, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function requestedAdminPath(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get("next")?.trim() ?? "";
  if (!raw) return null;
  return isAllowedFunnelAdminPath(raw) ? raw : null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const requestedNext = requestedAdminPath(request);

  if (!user?.id || !user.email) {
    const loginUrl = createPortalUrl("/login");
    loginUrl.searchParams.set(
      "next",
      createFunnelSsoEntryPath(requestedNext ?? "/admin"),
    );
    return noStoreRedirect(loginUrl);
  }

  try {
    // Best-effort: push confirmed pixels into Funnel before admin open (for live tests).
    await Promise.race([
      syncConfirmedPixelsToWorkspaces(user.id),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]).catch((error) => {
      console.warn("[funnel-sso] Pixel-Sync übersprungen", error);
    });

    let hostname: string | null = null;
    try {
      const domains = await listCustomerCustomDomains(user.id);
      hostname = resolveCustomerFunnelAdminHostname(domains);
    } catch (error) {
      console.warn("[funnel-sso] Custom-Domain für Admin nicht lesbar", error);
    }

    const nextPath = requestedNext ?? defaultFunnelAdminPath(Boolean(hostname));
    const audienceHostname = hostname ?? sharedFunnelHostname();
    const token = createFunnelSsoToken({
      userId: user.id,
      email: user.email,
      name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : user.email,
      audienceHostname,
    });
    const target = createFunnelSsoConsumeUrl({ hostname, nextPath });
    target.searchParams.set("token", token);
    return noStoreRedirect(target);
  } catch (error) {
    console.error("[funnel-sso] Token konnte nicht erzeugt werden", error);
    const dashboard = createPortalUrl("/dashboard");
    dashboard.searchParams.set("funnel_sso", "config_error");
    return noStoreRedirect(dashboard);
  }
}
