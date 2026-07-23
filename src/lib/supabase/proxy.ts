import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  APP_SITE_URL,
  MARKETING_SITE_URL,
  createPortalUrl,
  isMarketingHostname,
  isPortalHostname,
  isPortalPath,
  normalizeHostname,
} from "@/lib/site-urls";

import { getSupabaseEnv } from "./env";

function redirectPreservingCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const pathname = request.nextUrl.pathname;
  const hostname = normalizeHostname(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  const isProtectedRoute =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isAuthRoute = pathname === "/login" || pathname === "/registrieren";

  if (isMarketingHostname(hostname) && isPortalPath(pathname)) {
    return redirectPreservingCookies(
      createPortalUrl(pathname, request.nextUrl.search),
      response,
    );
  }

  if (isPortalHostname(hostname) && pathname === "/") {
    const portalEntryUrl = new URL(
      claims ? "/dashboard" : "/login",
      `${APP_SITE_URL}/`,
    );
    return redirectPreservingCookies(portalEntryUrl, response);
  }

  if (
    isPortalHostname(hostname) &&
    !isPortalPath(pathname) &&
    !pathname.startsWith("/api")
  ) {
    const marketingUrl = new URL(pathname, `${MARKETING_SITE_URL}/`);
    marketingUrl.search = request.nextUrl.search;
    return redirectPreservingCookies(marketingUrl, response);
  }

  if (!claims && isProtectedRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return redirectPreservingCookies(loginUrl, response);
  }

  if (claims && isAuthRoute) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return redirectPreservingCookies(dashboardUrl, response);
  }

  return response;
}
