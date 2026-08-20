import { NextResponse } from "next/server";

import { createFunnelSsoToken } from "@/lib/funnel-sso";
import { syncConfirmedPixelsToWorkspaces } from "@/lib/meta/customer-control-service";
import { createFunnelUrl, createPortalUrl } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function noStoreRedirect(url: URL, status: 303 | 307 = 303) {
  const response = NextResponse.redirect(url, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    const loginUrl = createPortalUrl("/login");
    loginUrl.searchParams.set("next", "/api/funnel/sso");
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

    const token = createFunnelSsoToken({
      userId: user.id,
      email: user.email,
      name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : user.email,
    });
    const target = createFunnelUrl("/api/auth/adbot-sso");
    target.searchParams.set("token", token);
    return noStoreRedirect(target);
  } catch (error) {
    console.error("[funnel-sso] Token konnte nicht erzeugt werden", error);
    const dashboard = createPortalUrl("/dashboard");
    dashboard.searchParams.set("funnel_sso", "config_error");
    return noStoreRedirect(dashboard);
  }
}
