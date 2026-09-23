import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { adExampleMetadata } from "@/lib/ad-examples/input";
import { loadInspirationMemorySnapshot } from "@/lib/ad-learning/retrieve";
import { getCreativeAssetStorageBucket } from "@/lib/creative-assets/env";
import { MediaLibraryError, uploadInspirationVaultImage } from "@/lib/media-library/upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveChatGPTAdLibraryUploaderUserId } from "@/lib/chatgpt-ad-library/uploader";
import {
  assertReadyForImport,
  collectorDraftToAdExampleInput,
  CollectorInputError,
  normalizeCollectorDraft,
} from "./normalize";
import { buildCollectorMemoryPreview } from "./preview";
import { canTransitionCollectorStatus } from "./status";
import {
  COLLECTOR_IMPORT_BATCH_MAX,
  EMPTY_COLLECTOR_COUNTS,
  type CollectorDraft,
  type CollectorInbox,
  type CollectorItemView,
  type CollectorMemoryPreview,
  type CollectorStatus,
} from "./types";

export class CollectorServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CollectorServiceError";
    this.code = code;
    this.status = status;
  }
}

type ItemRow = {
  id: string;
  provider: string;
  external_id: string;
  platform: string;
  status: string;
  source_url: string | null;
  source_kind: string;
  collector_batch_id: string | null;
  image_url: string | null;
  image_hash: string | null;
  image_storage_bucket: string | null;
  image_storage_path: string | null;
  title: string;
  advertiser_name: string;
  industry: string;
  objective: string;
  objective_detail: string;
  funnel_stage: string;
  evidence_level: string;
  rights_basis: string;
  rights_confirmed: boolean;
  format: string;
  country: string;
  language: string;
  hook_text: string;
  body_text: string;
  cta_text: string;
  landing_page_url: string | null;
  performance_note: string;
  why_it_works: string;
  tags: unknown;
  quality_rating: number;
  use_for_generation: boolean;
  raw_payload: unknown;
  brand_asset_id: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const ITEM_SELECT =
  "id,provider,external_id,platform,status,source_url,source_kind,collector_batch_id,image_url,image_hash,image_storage_bucket,image_storage_path,title,advertiser_name,industry,objective,objective_detail,funnel_stage,evidence_level,rights_basis,rights_confirmed,format,country,language,hook_text,body_text,cta_text,landing_page_url,performance_note,why_it_works,tags,quality_rating,use_for_generation,raw_payload,brand_asset_id,last_error,created_by,created_at,updated_at";

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /does not exist|ad_library_collector_items/i.test(error.message ?? "")
  );
}

function tagsFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function view(row: ItemRow): CollectorItemView {
  return {
    id: row.id,
    provider: row.provider as CollectorItemView["provider"],
    externalId: row.external_id,
    collectorBatchId: row.collector_batch_id,
    platform: row.platform,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    imageHash: row.image_hash,
    title: row.title,
    advertiserName: row.advertiser_name,
    industry: row.industry,
    objective: row.objective,
    objectiveDetail: row.objective_detail,
    funnelStage: row.funnel_stage,
    evidenceLevel: row.evidence_level,
    rightsBasis: row.rights_basis,
    rightsConfirmed: Boolean(row.rights_confirmed),
    format: row.format,
    country: row.country,
    language: row.language,
    hookText: row.hook_text,
    bodyText: row.body_text,
    ctaText: row.cta_text,
    landingPageUrl: row.landing_page_url,
    performanceNote: row.performance_note,
    whyItWorks: row.why_it_works,
    tags: tagsFrom(row.tags),
    qualityRating: row.quality_rating,
    useForGeneration: Boolean(row.use_for_generation),
    rawPayload:
      row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
        ? (row.raw_payload as Record<string, unknown>)
        : {},
    status: row.status as CollectorStatus,
    imageStorageBucket: row.image_storage_bucket,
    imageStoragePath: row.image_storage_path,
    brandAssetId: row.brand_asset_id,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasImage: Boolean(row.image_storage_path || row.image_url),
  };
}

function draftToInsert(draft: CollectorDraft, createdBy: string | null) {
  return {
    provider: draft.provider,
    external_id: draft.externalId,
    platform: draft.platform,
    source_kind: draft.sourceKind,
    source_url: draft.sourceUrl,
    collector_batch_id: draft.collectorBatchId,
    image_url: draft.imageUrl,
    image_hash: draft.imageHash,
    title: draft.title,
    advertiser_name: draft.advertiserName,
    industry: draft.industry,
    objective: draft.objective,
    objective_detail: draft.objectiveDetail,
    funnel_stage: draft.funnelStage,
    evidence_level: draft.evidenceLevel,
    rights_basis: draft.rightsBasis,
    rights_confirmed: draft.rightsConfirmed,
    format: draft.format,
    country: draft.country,
    language: draft.language,
    hook_text: draft.hookText,
    body_text: draft.bodyText,
    cta_text: draft.ctaText,
    landing_page_url: draft.landingPageUrl,
    performance_note: draft.performanceNote,
    why_it_works: draft.whyItWorks,
    tags: draft.tags,
    quality_rating: draft.qualityRating,
    use_for_generation: draft.useForGeneration,
    raw_payload: draft.rawPayload,
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };
}

async function storeStagingImage(input: {
  itemId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ bucket: string; path: string; hash: string }> {
  const bucket = getCreativeAssetStorageBucket();
  const safeName = (input.fileName || "creative.jpg")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 80);
  const path = `collector-staging/${input.itemId}/${safeName}`;
  const admin = createAdminClient();
  const uploaded = await admin.storage.from(bucket).upload(path, input.bytes, {
    contentType: input.mimeType,
    upsert: true,
  });
  if (uploaded.error) {
    throw new CollectorServiceError(
      "staging_image_failed",
      502,
      "Das Staging-Bild konnte nicht gespeichert werden.",
    );
  }
  return {
    bucket,
    path,
    hash: createHash("sha256").update(input.bytes).digest("hex"),
  };
}

export async function loadCollectorInbox(input?: {
  status?: CollectorStatus | "all";
  limit?: number;
}): Promise<CollectorInbox> {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(input?.limit ?? 80, 1), 200);
  let query = admin
    .from("ad_library_collector_items")
    .select(ITEM_SELECT)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (input?.status && input.status !== "all") {
    query = query.eq("status", input.status);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) {
      return {
        items: [],
        counts: { ...EMPTY_COLLECTOR_COUNTS },
        lastBatchId: null,
        migrationNeeded: true,
      };
    }
    throw new CollectorServiceError(
      "load_failed",
      500,
      "Die Collector-Sandbox konnte nicht geladen werden.",
    );
  }
  const items = ((data ?? []) as ItemRow[]).map(view);
  const counts = { ...EMPTY_COLLECTOR_COUNTS };
  for (const item of items) {
    counts[item.status] += 1;
    counts.total += 1;
  }
  const lastBatchId =
    items.find((item) => item.collectorBatchId)?.collectorBatchId ?? null;
  return { items, counts, lastBatchId, migrationNeeded: false };
}

export async function enqueueCollectorDrafts(input: {
  records: unknown[];
  createdBy: string | null;
  batchId?: string | null;
  image?: { fileName: string; mimeType: string; bytes: Uint8Array } | null;
}): Promise<{ items: CollectorItemView[]; upserted: number }> {
  if (input.records.length < 1) {
    throw new CollectorServiceError("empty_batch", 400, "Keine Datensätze übergeben.");
  }
  if (input.records.length > 40) {
    throw new CollectorServiceError("batch_too_large", 400, "Maximal 40 Datensätze pro Lauf.");
  }

  const admin = createAdminClient();
  const batchId =
    input.batchId?.trim() ||
    `sandbox-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const items: CollectorItemView[] = [];

  for (const record of input.records) {
    const draft = normalizeCollectorDraft(record);
    if (!draft.collectorBatchId) draft.collectorBatchId = batchId;

    const { data, error } = await admin
      .from("ad_library_collector_items")
      .upsert(
        {
          ...draftToInsert(draft, input.createdBy),
          status: "fetched",
          last_error: null,
        },
        { onConflict: "provider,external_id" },
      )
      .select(ITEM_SELECT)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) {
        throw new CollectorServiceError(
          "migration_needed",
          503,
          "Bitte zuerst die Migration ad_library_collector_items ausführen.",
        );
      }
      if (error.code === "23505") {
        throw new CollectorServiceError(
          "duplicate",
          409,
          `Eintrag ${draft.provider}/${draft.externalId} existiert bereits.`,
        );
      }
      throw new CollectorServiceError(
        "enqueue_failed",
        500,
        error.message || "Sandbox-Eintrag konnte nicht gespeichert werden.",
      );
    }
    if (!data) continue;
    let stored = view(data as ItemRow);
    if (input.image && input.records.length === 1) {
      const image = await storeStagingImage({
        itemId: stored.id,
        fileName: input.image.fileName,
        mimeType: input.image.mimeType,
        bytes: input.image.bytes,
      });
      const updated = await admin
        .from("ad_library_collector_items")
        .update({
          image_storage_bucket: image.bucket,
          image_storage_path: image.path,
          image_hash: image.hash,
          updated_at: new Date().toISOString(),
        })
        .eq("id", stored.id)
        .select(ITEM_SELECT)
        .maybeSingle();
      if (updated.data) stored = view(updated.data as ItemRow);
    }
    items.push(stored);
  }

  return { items, upserted: items.length };
}

export async function transitionCollectorItem(input: {
  id: string;
  status: CollectorStatus;
}): Promise<CollectorItemView> {
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from("ad_library_collector_items")
    .select(ITEM_SELECT)
    .eq("id", input.id)
    .maybeSingle();
  if (loadError || !existing) {
    throw new CollectorServiceError("not_found", 404, "Sandbox-Eintrag nicht gefunden.");
  }
  const current = view(existing as ItemRow);
  if (!canTransitionCollectorStatus(current.status, input.status)) {
    throw new CollectorServiceError(
      "invalid_transition",
      409,
      `Status ${current.status} → ${input.status} ist nicht erlaubt.`,
    );
  }
  if (input.status === "ready_for_import") {
    assertReadyForImport({ draft: current, hasImage: current.hasImage });
  }
  const { data, error } = await admin
    .from("ad_library_collector_items")
    .update({
      status: input.status,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select(ITEM_SELECT)
    .maybeSingle();
  if (error || !data) {
    throw new CollectorServiceError(
      "transition_failed",
      500,
      "Status konnte nicht geändert werden.",
    );
  }
  return view(data as ItemRow);
}

async function findVaultByExternal(input: {
  provider: string;
  externalId: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const filtered = await admin
    .from("brand_assets")
    .select("id,metadata")
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->external_source->>external_id", "eq", input.externalId)
    .limit(20);
  const rows = !filtered.error && Array.isArray(filtered.data) ? filtered.data : [];
  for (const row of rows) {
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const external =
      metadata.external_source &&
      typeof metadata.external_source === "object" &&
      !Array.isArray(metadata.external_source)
        ? (metadata.external_source as Record<string, unknown>)
        : {};
    if (
      String(external.provider ?? "") === input.provider &&
      String(external.external_id ?? "") === input.externalId
    ) {
      return String(row.id);
    }
  }
  return null;
}

async function loadStagingImageBytes(item: CollectorItemView): Promise<{
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  fileName: string;
}> {
  if (item.imageStorageBucket && item.imageStoragePath) {
    const admin = createAdminClient();
    const downloaded = await admin.storage
      .from(item.imageStorageBucket)
      .download(item.imageStoragePath);
    if (downloaded.error || !downloaded.data) {
      throw new CollectorServiceError(
        "staging_image_missing",
        409,
        "Staging-Bild nicht mehr im Storage.",
      );
    }
    const buffer = new Uint8Array(await downloaded.data.arrayBuffer());
    const mimeType = item.imageStoragePath.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";
    return {
      bytes: buffer,
      mimeType,
      fileName: item.imageStoragePath.split("/").pop() || "inspiration.jpg",
    };
  }
  if (!item.imageUrl) {
    throw new CollectorServiceError("image_missing", 409, "Kein Bild für den Import.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(item.imageUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "image/jpeg,image/png,image/webp,*/*" },
      cache: "no-store",
    });
  } catch {
    throw new CollectorServiceError("image_fetch_failed", 502, "Bild-URL konnte nicht geladen werden.");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new CollectorServiceError(
      "image_fetch_failed",
      502,
      `Bild-Download fehlgeschlagen (HTTP ${response.status}).`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength <= 0 || buffer.byteLength > 8 * 1024 * 1024) {
    throw new CollectorServiceError("image_too_large", 413, "Bild ist leer oder größer als 8 MB.");
  }
  const head = buffer.subarray(0, 64).toString("utf8").toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) {
    throw new CollectorServiceError("image_not_binary", 502, "URL lieferte HTML statt eines Bildes.");
  }
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(buffer, { failOn: "error", animated: false })
    .rotate()
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return {
    bytes: new Uint8Array(jpeg),
    mimeType: "image/jpeg",
    fileName: `${item.externalId.slice(0, 80)}.jpg`,
  };
}

export async function importReadyCollectorItems(input: {
  uploaderUserId?: string;
  ids?: string[];
  limit?: number;
}): Promise<{
  attempted: number;
  imported: number;
  skippedDuplicate: number;
  failed: number;
  results: Array<{
    id: string;
    externalId: string;
    status: "imported" | "skipped_duplicate" | "failed";
    brandAssetId: string | null;
    error: string | null;
  }>;
}> {
  const admin = createAdminClient();
  const uploaderUserId =
    input.uploaderUserId ?? (await resolveChatGPTAdLibraryUploaderUserId());
  const limit = Math.min(
    Math.max(input.limit ?? COLLECTOR_IMPORT_BATCH_MAX, 1),
    COLLECTOR_IMPORT_BATCH_MAX,
  );
  let query = admin
    .from("ad_library_collector_items")
    .select(ITEM_SELECT)
    .eq("status", "ready_for_import")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (input.ids?.length) {
    query = admin
      .from("ad_library_collector_items")
      .select(ITEM_SELECT)
      .in("id", input.ids)
      .eq("status", "ready_for_import");
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) {
      throw new CollectorServiceError(
        "migration_needed",
        503,
        "Bitte zuerst die Migration ad_library_collector_items ausführen.",
      );
    }
    throw new CollectorServiceError("load_failed", 500, "Bereite Einträge nicht ladbar.");
  }

  const results: Array<{
    id: string;
    externalId: string;
    status: "imported" | "skipped_duplicate" | "failed";
    brandAssetId: string | null;
    error: string | null;
  }> = [];
  let imported = 0;
  let skippedDuplicate = 0;
  let failed = 0;

  for (const row of (data ?? []) as ItemRow[]) {
    const item = view(row);
    try {
      assertReadyForImport({ draft: item, hasImage: item.hasImage });
      const existing = await findVaultByExternal({
        provider: item.provider,
        externalId: item.externalId,
      });
      if (existing) {
        await admin
          .from("ad_library_collector_items")
          .update({
            status: "imported",
            brand_asset_id: existing,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        skippedDuplicate += 1;
        results.push({
          id: item.id,
          externalId: item.externalId,
          status: "skipped_duplicate",
          brandAssetId: existing,
          error: null,
        });
        continue;
      }

      const image = await loadStagingImageBytes(item);
      const example = collectorDraftToAdExampleInput(item);
      const uploaded = await uploadInspirationVaultImage({
        uploaderUserId,
        fileName: image.fileName,
        mimeType: image.mimeType,
        bytes: image.bytes,
        metadata: {
          ...adExampleMetadata(example),
          external_source: {
            provider: item.provider,
            external_id: item.externalId,
            collector_batch_id: item.collectorBatchId,
            customer_visible: false,
            use_for_internal_intelligence: true,
            rights_basis: item.rightsBasis,
          },
        },
      });
      await admin
        .from("ad_library_collector_items")
        .update({
          status: "imported",
          brand_asset_id: uploaded.brandAssetId,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      imported += 1;
      results.push({
        id: item.id,
        externalId: item.externalId,
        status: "imported",
        brandAssetId: uploaded.brandAssetId,
        error: null,
      });
    } catch (caught) {
      const message =
        caught instanceof CollectorInputError ||
        caught instanceof CollectorServiceError ||
        caught instanceof MediaLibraryError
          ? caught.message
          : "Import fehlgeschlagen.";
      await admin
        .from("ad_library_collector_items")
        .update({
          status: "failed",
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      failed += 1;
      results.push({
        id: item.id,
        externalId: item.externalId,
        status: "failed",
        brandAssetId: null,
        error: message,
      });
    }
  }

  return {
    attempted: results.length,
    imported,
    skippedDuplicate,
    failed,
    results,
  };
}

export async function previewCollectorMemory(input: {
  platform?: string;
  objective?: string;
  industry?: string;
}): Promise<CollectorMemoryPreview> {
  const [snapshot, inbox] = await Promise.all([
    loadInspirationMemorySnapshot({
      platform: input.platform,
      objective: input.objective,
      industry: input.industry,
      limit: 8,
    }),
    loadCollectorInbox({ limit: 120 }),
  ]);
  return buildCollectorMemoryPreview({
    platform: input.platform,
    objective: input.objective,
    industry: input.industry,
    livePatterns: snapshot.patterns,
    census: snapshot.census,
    stagedItems: inbox.items,
  });
}

