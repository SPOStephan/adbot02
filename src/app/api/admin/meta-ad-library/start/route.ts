import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import { createLibraryLoginUrl, createLibraryOAuthState } from "@/lib/meta-ad-library/client";
import { requireMetaAdLibraryApp } from "@/lib/meta-ad-library/env";
import { MetaAdLibraryError } from "@/lib/meta-ad-library/errors";
import { isDashboardSameOriginRequest } from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithNotice(origin: string, notice: string) {
  const url = new URL("/dashboard/inspiration", origin);
  url.searchParams.set("library", notice);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: NextRequest) {
  if (!isDashboardSameOriginRequest(request)) {
    return new NextResponse("Ungültige Herkunft.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectWithNotice(request.nextUrl.origin, "login");
  }
  if (!(await isSiteAdmin(user.id))) {
    return redirectWithNotice(request.nextUrl.origin, "forbidden");
  }
  try {
    const app = requireMetaAdLibraryApp();
    const state = createLibraryOAuthState(user.id, app.appSecret);
    const login = createLibraryLoginUrl({
      appId: app.appId,
      redirectUri: app.redirectUri,
      state,
    });
    const response = NextResponse.redirect(login, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const message =
      error instanceof MetaAdLibraryError ? error.code : "oauth_start_failed";
    return redirectWithNotice(request.nextUrl.origin, message);
  }
}
