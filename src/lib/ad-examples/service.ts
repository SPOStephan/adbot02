import "server-only";

import { sanitizeAssetMetadata } from "@/lib/creative-assets/image";
import {
  adExampleMetadata,
  parseAdExampleInput,
} from "@/lib/ad-examples/input";
import {
  AD_EXAMPLE_PAGE_SIZE,
  type AdExampleInput,
  type AdExampleView,
} from "@/lib/ad-examples/types";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AdExampleServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "AdExampleServiceError";
    this.code = code;
    this.status = status;
  }
}

type AssetRow = {
  id: string;
  original_filename: string | null;
  width: number | null;
  height: number | null;
  metadata: unknown;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function inputFromMetadata(metadataValue: unknown): { input: AdExampleInput; legacy: boolean } {
  const metadata = record(metadataValue);
  const details = record(metadata.ad_example);
  if (metadata.library === "ad_example_library") {
    try {
      return {
        input: parseAdExampleInput({
          title: details.title,
          advertiserName: details.advertiser_name,
          platform: details.platform,
          industry: details.industry,
          objective: details.objective,
          objectiveDetail: details.objective_detail,
          funnelStage: details.funnel_stage,
          sourceKind: details.source_kind,
          sourceUrl: details.source_url,
          evidenceLevel: details.evidence_level,
          rightsBasis: details.rights_basis,
          rightsConfirmed: details.rights_confirmed,
          format: details.format,
          country: details.country,
          language: details.language,
          hookText: details.hook_text,
          bodyText: details.body_text,
          ctaText: details.cta_text,
          landingPageUrl: details.landing_page_url,
          performanceNote: details.performance_note,
          whyItWorks: details.why_it_works,
          tags: stringArray(details.tags),
          qualityRating: details.quality_rating,
          useForGeneration: details.use_for_generation,
          structureKind: details.structure && typeof details.structure === "object"
            ? (details.structure as { kind?: string }).kind
            : details.structure_kind,
          structureSlotsText: details.structure && typeof details.structure === "object"
            ? (details.structure as { slots?: unknown }).slots
            : details.structure_slots,
        }),
        legacy: false,
      };
    } catch {
      // Corrupt legacy metadata is shown fail-closed and never used for generation.
    }
  }

  return {
    input: {
      title: stringValue(metadata.note) || "Unklassifiziertes Inspirationsasset",
      advertiserName: "Nicht erfasst",
      platform: "other",
      industry: "Nicht klassifiziert",
      objective: "other",
      objectiveDetail: "Noch nicht klassifiziert",
      funnelStage: "awareness",
      sourceKind: "user_upload",
      sourceUrl: null,
      evidenceLevel: "visual_only",
      rightsBasis: "reference_only",
      rightsConfirmed: false,
      format: "Bild",
      country: "Nicht erfasst",
      language: "Nicht erfasst",
      hookText: "",
      bodyText: "",
      ctaText: "",
      landingPageUrl: null,
      performanceNote: "",
      whyItWorks: "",
      tags: [],
      qualityRating: 1,
      useForGeneration: false,
      structureKind: "none",
      structureSlotsText: "",
    },
    legacy: true,
  };
}

function view(row: AssetRow): AdExampleView {
  const parsed = inputFromMetadata(row.metadata);
  const external = record(record(row.metadata).external_source);
  return {
    id: row.id,
    ...parsed.input,
    originalFilename: row.original_filename ?? "Werbebeispiel",
    width: row.width,
    height: row.height,
    previewUrl: `/api/media-library/preview?assetId=${encodeURIComponent(row.id)}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legacy: parsed.legacy,
    triggeringPrompts: stringArray(external.triggering_prompts),
  };
}

export async function loadAdExamplesPage(input?: {
  page?: number;
  pageSize?: number;
  query?: string;
  platform?: string;
  objective?: string;
  industry?: string;
  tag?: string;
}): Promise<{
  examples: AdExampleView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  const pageSize = Math.min(Math.max(input?.pageSize ?? AD_EXAMPLE_PAGE_SIZE, 1), 48);
  const requestedPage = Math.max(Math.floor(input?.page ?? 1), 1);
  const from = (requestedPage - 1) * pageSize;
  const admin = createAdminClient();
  let query = admin
    .from("brand_assets")
    .select(
      "id,original_filename,width,height,metadata,storage_bucket,storage_path,created_at,updated_at",
      { count: "exact" },
    )
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .order("updated_at", { ascending: false });

  const platform = (input?.platform ?? "").trim();
  if (platform && platform !== "all") {
    query = query.filter("metadata->ad_example->>platform", "eq", platform);
  }
  const objective = (input?.objective ?? "").trim();
  if (objective && objective !== "all") {
    query = query.filter("metadata->ad_example->>objective", "eq", objective);
  }
  const industry = (input?.industry ?? "").trim();
  if (industry && industry !== "all") {
    query = query.filter("metadata->ad_example->>industry", "eq", industry);
  }
  const tag = (input?.tag ?? "").trim().toLowerCase();
  if (tag && tag !== "all") {
    query = query.filter("metadata->ad_example->>tags", "ilike", `%${tag.replace(/[%*,()]/g, "")}%`);
  }
  const needle = (input?.query ?? "").trim().replace(/[%*,()]/g, " ").slice(0, 80);
  if (needle) {
    query = query.or(
      [
        `metadata->ad_example->>title.ilike.%${needle}%`,
        `metadata->ad_example->>advertiser_name.ilike.%${needle}%`,
        `metadata->ad_example->>industry.ilike.%${needle}%`,
        `metadata->ad_example->>hook_text.ilike.%${needle}%`,
        `metadata->ad_example->>body_text.ilike.%${needle}%`,
      ].join(","),
    );
  }

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) {
    throw new AdExampleServiceError(
      "load_failed",
      500,
      "Die Werbebeispielbibliothek konnte nicht geladen werden.",
    );
  }
  const total = typeof count === "number" ? count : (data ?? []).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (requestedPage > pageCount && total > 0) {
    return loadAdExamplesPage({ ...input, page: pageCount });
  }
  return {
    examples: ((data ?? []) as AssetRow[]).map(view),
    total,
    page: requestedPage,
    pageSize,
    pageCount,
  };
}

export async function loadAdExamples(): Promise<AdExampleView[]> {
  const result = await loadAdExamplesPage({ page: 1, pageSize: AD_EXAMPLE_PAGE_SIZE });
  return result.examples;
}

export async function updateAdExample(input: {
  assetId: string;
  values: Record<string, unknown>;
}): Promise<AdExampleView> {
  if (!UUID_PATTERN.test(input.assetId)) {
    throw new AdExampleServiceError("invalid_id", 400, "Ungültige Beispiel-ID.");
  }
  const parsed = parseAdExampleInput(input.values);
  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("brand_assets")
    .select("metadata")
    .eq("id", input.assetId)
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .maybeSingle();
  if (existingError || !existing) {
    throw new AdExampleServiceError(
      "update_failed",
      404,
      "Das Werbebeispiel konnte nicht aktualisiert werden.",
    );
  }
  const previous = record(existing.metadata);
  const nextMetadata = {
    ...adExampleMetadata(parsed),
    // Preserve external crawl provenance (e.g. chatgptadlibrary.com) across edits.
    ...(previous.external_source && typeof previous.external_source === "object"
      ? { external_source: previous.external_source }
      : {}),
  };
  const metadata = sanitizeAssetMetadata(nextMetadata);
  const { data, error } = await admin
    .from("brand_assets")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", input.assetId)
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .select(
      "id,original_filename,width,height,metadata,storage_bucket,storage_path,created_at,updated_at",
    )
    .maybeSingle();
  if (error || !data) {
    throw new AdExampleServiceError(
      "update_failed",
      404,
      "Das Werbebeispiel konnte nicht aktualisiert werden.",
    );
  }
  return view(data as AssetRow);
}

export async function removeAdExample(assetId: string): Promise<void> {
  if (!UUID_PATTERN.test(assetId)) {
    throw new AdExampleServiceError("invalid_id", 400, "Ungültige Beispiel-ID.");
  }
  const admin = createAdminClient();
  const { data: asset, error } = await admin
    .from("brand_assets")
    .select("id,storage_bucket,storage_path")
    .eq("id", assetId)
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .maybeSingle();
  if (error || !asset) {
    throw new AdExampleServiceError("not_found", 404, "Werbebeispiel nicht gefunden.");
  }

  const { error: updateError } = await admin
    .from("brand_assets")
    .update({ status: "REVOKED", updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("library_scope", "INSPIRATION");
  if (updateError) {
    throw new AdExampleServiceError(
      "remove_failed",
      409,
      "Das Werbebeispiel konnte nicht entfernt werden.",
    );
  }

  if (asset.storage_bucket && asset.storage_path) {
    const storage = await admin.storage
      .from(String(asset.storage_bucket))
      .remove([String(asset.storage_path)]);
    if (storage.error && !/not found|404/i.test(storage.error.message)) {
      console.error("ad_example_storage_cleanup_failed", { assetId });
    }
  }
}

export { parseAdExampleInput };
