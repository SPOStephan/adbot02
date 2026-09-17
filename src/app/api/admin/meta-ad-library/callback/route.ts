import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import { exchangeLibraryCode, readLibraryOAuthState } from "@/lib/meta-ad-library/client";
import { saveLibraryConnection } from "@/lib/meta-ad-library/connection";
import { requireMetaAdLibraryApp } from "@/lib/meta-ad-library/env";
import { MetaAdLibraryError } from "@/lib/meta-ad-library/errors";
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

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const errorParam = request.nextUrl.searchParams.get("error");
  if (errorParam) {
    return redirectWithNotice(origin, "oauth_denied");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectWithNotice(origin, "login");
  if (!(await isSiteAdmin(user.id))) return redirectWithNotice(origin, "forbidden");

  try {
    const app = requireMetaAdLibraryApp();
    const state = readLibraryOAuthState(request.nextUrl.searchParams.get("state"), app.appSecret);
    if (!state || state.sub !== user.id) {
      return redirectWithNotice(origin, "oauth_state");
    }
    const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
    if (!code) return redirectWithNotice(origin, "oauth_code");
    const persisted = await exchangeLibraryCode({
      appId: app.appId,
      appSecret: app.appSecret,
      code,
      redirectUri: app.redirectUri,
    });
    await saveLibraryConnection({
      appId: app.appId,
      accessToken: persisted.accessToken,
      expiresInSeconds: persisted.expiresInSeconds,
      metaUserId: persisted.metaUserId,
      connectedBy: user.id,
    });
    return redirectWithNotice(origin, "connected");
  } catch (error) {
    const notice =
      error instanceof MetaAdLibraryError ? error.code : "oauth_callback_failed";
    return redirectWithNotice(origin, notice);
  }
}
