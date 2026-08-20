import "server-only";

import { getSiteBranding } from "@/lib/site-branding/branding";

const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#111111"/>
  <text x="16" y="22" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="15" font-weight="700" fill="#ffffff">A</text>
</svg>`;

function defaultFaviconResponse(): Response {
  return new Response(DEFAULT_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

/**
 * Serves the admin-uploaded site favicon (proxied from public storage)
 * or a small Adbot.one default mark. Same-origin so browsers prefer it
 * over a leftover static /favicon.ico.
 */
export async function serveSiteFaviconResponse(): Promise<Response> {
  try {
    const branding = await getSiteBranding();
    if (!branding.faviconUrl) {
      return defaultFaviconResponse();
    }

    const upstream = await fetch(branding.faviconUrl, {
      // Fresh enough after admin upload; CDN still caches briefly.
      next: { revalidate: 60 },
    });

    if (!upstream.ok) {
      return defaultFaviconResponse();
    }

    const contentType =
      upstream.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/png";
    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch {
    return defaultFaviconResponse();
  }
}
