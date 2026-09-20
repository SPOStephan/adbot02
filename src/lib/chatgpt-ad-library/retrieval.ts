import "server-only";

import { CHATGPT_AD_LIBRARY_PAGE_SIZE } from "@/lib/chatgpt-ad-library/import-constants";
import { CHATGPT_AD_LIBRARY_PROVIDER } from "@/lib/chatgpt-ad-library/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChatGPTAdLibraryIntelligenceHit = {
  brandAssetId: string;
  externalId: string;
  title: string;
  advertiserName: string;
  industry: string;
  hookText: string;
  bodyText: string;
  whyItWorks: string;
  tags: string[];
  triggeringPrompts: string[];
  categories: string[];
  sourceUrl: string | null;
  landingPageUrl: string | null;
  previewUrl: string;
  useForGeneration: boolean;
  customerVisible: false;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Internal-only retrieval for Adbot intelligence / admin research.
 * Never returns customer-library assets. Never implies customer visibility.
 * Creative generation still requires explicit use_for_generation on the ad_example.
 */
export { CHATGPT_AD_LIBRARY_PAGE_SIZE };

function applyChatGPTLibraryFilters<T extends { filter: (column: string, op: string, value: string) => T; or: (filters: string) => T }>(
  query: T,
  needle: string,
): T {
  let next = query
    .filter("metadata->>library", "eq", "ad_example_library")
    .filter("metadata->external_source->>provider", "eq", CHATGPT_AD_LIBRARY_PROVIDER)
    .filter("metadata->external_source->>use_for_internal_intelligence", "eq", "true");
  const safe = needle.replace(/[%*,()]/g, " ").slice(0, 80);
  if (safe) {
    next = next.or(
      [
        `metadata->ad_example->>title.ilike.%${safe}%`,
        `metadata->ad_example->>advertiser_name.ilike.%${safe}%`,
        `metadata->ad_example->>body_text.ilike.%${safe}%`,
        `metadata->external_source->>external_id.ilike.%${safe}%`,
      ].join(","),
    );
  }
  return next;
}

export async function loadChatGPTAdLibraryPage(input?: {
  limit?: number;
  offset?: number;
  query?: string;
}): Promise<{
  hits: ChatGPTAdLibraryIntelligenceHit[];
  total: number;
  offset: number;
  limit: number;
}> {
  const limit = Math.min(Math.max(input?.limit ?? CHATGPT_AD_LIBRARY_PAGE_SIZE, 1), 48);
  const offset = Math.max(Math.floor(input?.offset ?? 0), 0);
  const needle = (input?.query ?? "").trim();
  const admin = createAdminClient();

  const counted = applyChatGPTLibraryFilters(
    admin
      .from("brand_assets")
      .select("id", { count: "exact", head: true })
      .eq("library_scope", "INSPIRATION")
      .neq("status", "REVOKED"),
    needle,
  );
  const listed = applyChatGPTLibraryFilters(
    admin
      .from("brand_assets")
      .select("id,metadata,updated_at")
      .eq("library_scope", "INSPIRATION")
      .neq("status", "REVOKED")
      .order("updated_at", { ascending: false }),
    needle,
  );

  const [{ count, error: countError }, { data, error }] = await Promise.all([
    counted,
    listed.range(offset, offset + limit - 1),
  ]);

  if (error || !Array.isArray(data)) {
    return { hits: [], total: 0, offset, limit };
  }

  const hits: ChatGPTAdLibraryIntelligenceHit[] = [];
  for (const row of data) {
    const metadata = record(row.metadata);
    const external = record(metadata.external_source);
    if (external.provider !== CHATGPT_AD_LIBRARY_PROVIDER) continue;
    if (external.use_for_internal_intelligence !== true) continue;
    if (external.customer_visible === true) continue;

    const example = record(metadata.ad_example);
    const title = text(example.title);
    const advertiserName = text(example.advertiser_name);
    const industry = text(example.industry);
    const hookText = text(example.hook_text);
    const bodyText = text(example.body_text);
    const whyItWorks = text(example.why_it_works);
    const tags = stringArray(example.tags);
    const triggeringPrompts = stringArray(external.triggering_prompts);
    const categories = stringArray(external.categories);

    hits.push({
      brandAssetId: String(row.id),
      externalId: String(external.external_id ?? ""),
      title,
      advertiserName,
      industry,
      hookText,
      bodyText,
      whyItWorks,
      tags,
      triggeringPrompts,
      categories,
      sourceUrl: text(external.source_url) || text(example.source_url) || null,
      landingPageUrl: text(example.landing_page_url) || null,
      previewUrl: `/api/media-library/preview?assetId=${encodeURIComponent(String(row.id))}`,
      useForGeneration: example.use_for_generation === true,
      customerVisible: false,
    });
  }

  const total =
    !countError && typeof count === "number" ? count : offset + hits.length;
  return { hits, total, offset, limit };
}

export async function loadChatGPTAdLibraryForInternalIntelligence(input?: {
  limit?: number;
  offset?: number;
  query?: string;
}): Promise<ChatGPTAdLibraryIntelligenceHit[]> {
  const page = await loadChatGPTAdLibraryPage(input);
  return page.hits;
}

export async function countChatGPTAdLibraryImports(): Promise<number> {
  const admin = createAdminClient();
  const exact = await admin
    .from("brand_assets")
    .select("id", { count: "exact", head: true })
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->>library", "eq", "ad_example_library")
    .filter("metadata->external_source->>provider", "eq", CHATGPT_AD_LIBRARY_PROVIDER)
    .filter("metadata->external_source->>use_for_internal_intelligence", "eq", "true");
  if (!exact.error && typeof exact.count === "number") {
    return exact.count;
  }

  // New Supabase projects often cap a single response at 1000 rows (max-rows).
  let count = 0;
  const page = 200;
  for (let from = 0; from < 100_000; from += page) {
    const { data, error } = await admin
      .from("brand_assets")
      .select("id,metadata")
      .eq("library_scope", "INSPIRATION")
      .neq("status", "REVOKED")
      .filter("metadata->>library", "eq", "ad_example_library")
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error || !Array.isArray(data) || data.length < 1) break;
    for (const row of data) {
      const external = record(record(row.metadata).external_source);
      if (
        external.provider === CHATGPT_AD_LIBRARY_PROVIDER &&
        external.use_for_internal_intelligence === true
      ) {
        count += 1;
      }
    }
    if (data.length < page) break;
  }
  return count;
}
