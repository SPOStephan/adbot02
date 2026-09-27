import "server-only";

import type { FunnelAdCategory, FunnelPurposeHint } from "@/lib/funnel-purpose-hint-types";
import { createAdminClient } from "@/lib/supabase/admin";

export function categoryFromFunnelTags(tags: unknown): FunnelAdCategory {
  if (!Array.isArray(tags)) return "standard";
  return tags.some(tag => tag === "employment" || tag === "jobs")
    ? "employment"
    : "standard";
}

function publicCategoryFromPurpose(purpose: unknown): FunnelAdCategory {
  // Vor Einführung des Purpose-Felds waren alle Funnel Recruiting-Funnel.
  return purpose === undefined || purpose === null || purpose === "recruiting"
    ? "employment"
    : "standard";
}

function funnelApiBaseUrl(): string {
  return (
    process.env.FUNNEL_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_FUNNEL_SITE_URL?.trim() ||
    "https://funnel.adbot.one"
  ).replace(/\/+$/, "");
}

async function publicFunnelQuery<T>(procedure: string, input: Record<string, unknown>): Promise<T | null> {
  const query = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await fetch(`${funnelApiBaseUrl()}/api/trpc/${procedure}?input=${query}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as {
    result?: { data?: { json?: T } };
  } | null;
  return body?.result?.data?.json ?? null;
}

export async function resolvePublicFunnelPurposeHint(
  destinationUrl: string,
): Promise<FunnelPurposeHint | null> {
  let destination: URL;
  try {
    destination = new URL(destinationUrl);
  } catch {
    return null;
  }
  if (destination.protocol !== "https:" || destination.username || destination.password || destination.port) {
    return null;
  }

  const hostname = destination.hostname.toLowerCase();
  const pathSlug = destination.pathname.match(/^\/f\/([^/]+)\/?$/)?.[1];
  let decodedSlug: string | null = null;
  try {
    decodedSlug = pathSlug ? decodeURIComponent(pathSlug) : null;
  } catch {
    return null;
  }
  let selected: { slug?: string; title?: string } | null = decodedSlug
    ? { slug: decodedSlug, title: "Funnel" }
    : null;
  if (!selected) {
    const catalog = await publicFunnelQuery<{
      funnels?: Array<{ slug?: string; title?: string }>;
    }>("funnel.publicCatalogByHost", { hostname });
    const funnels = Array.isArray(catalog?.funnels) ? catalog.funnels.slice(0, 100) : [];
    selected = funnels.length === 1 ? funnels[0] : null;
  }
  if (!selected?.slug) return null;

  const config = await publicFunnelQuery<{
    purpose?: unknown;
    title?: string;
    metaTracking?: {
      enabled?: unknown;
      pixelId?: unknown;
      eventName?: unknown;
    };
  }>("funnel.publicConfig", { slug: selected.slug, hostname });
  if (!config) return null;
  const metaTracking = config.metaTracking;
  return {
    destinationUrl: destination.toString(),
    title: typeof config.title === "string" ? config.title : (selected.title || "Funnel"),
    category: publicCategoryFromPurpose(config.purpose),
    metaTracking: {
      enabled: metaTracking?.enabled === true,
      pixelId: typeof metaTracking?.pixelId === "string" ? metaTracking.pixelId : "",
      eventName: typeof metaTracking?.eventName === "string" ? metaTracking.eventName : "Lead",
    },
  };
}

export async function listFunnelPurposeHints(userId: string): Promise<FunnelPurposeHint[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("funnel_creative_handoffs")
    .select("destination_url,title,tags")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return [];

  return (data ?? [])
    .filter(row => typeof row.destination_url === "string" && row.destination_url.startsWith("https://"))
    .map(row => ({
      destinationUrl: String(row.destination_url),
      title: typeof row.title === "string" ? row.title : "Funnel",
      category: categoryFromFunnelTags(row.tags),
    }));
}
