import "server-only";

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
export async function loadChatGPTAdLibraryForInternalIntelligence(input?: {
  limit?: number;
  query?: string;
}): Promise<ChatGPTAdLibraryIntelligenceHit[]> {
  const limit = Math.min(Math.max(input?.limit ?? 40, 1), 100);
  const needle = (input?.query ?? "").trim().toLowerCase();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("brand_assets")
    .select("id,metadata,updated_at")
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->>library", "eq", "ad_example_library")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !Array.isArray(data)) {
    return [];
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

    if (needle) {
      const haystack = [
        title,
        advertiserName,
        industry,
        hookText,
        bodyText,
        whyItWorks,
        ...tags,
        ...triggeringPrompts,
        ...categories,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) continue;
    }

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

    if (hits.length >= limit) break;
  }

  return hits;
}

export async function countChatGPTAdLibraryImports(): Promise<number> {
  const hits = await loadChatGPTAdLibraryForInternalIntelligence({ limit: 100 });
  // Count via a wider scan for the admin summary badge.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select("id,metadata")
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->>library", "eq", "ad_example_library")
    .limit(500);
  if (error || !Array.isArray(data)) return hits.length;
  let count = 0;
  for (const row of data) {
    const external = record(record(row.metadata).external_source);
    if (
      external.provider === CHATGPT_AD_LIBRARY_PROVIDER &&
      external.use_for_internal_intelligence === true
    ) {
      count += 1;
    }
  }
  return count;
}
