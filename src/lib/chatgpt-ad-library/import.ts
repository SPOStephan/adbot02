import "server-only";

import sharp from "sharp";

import { adExampleMetadata } from "@/lib/ad-examples/input";
import {
  externalSourceMetadata,
  normalizeChatGPTAdLibraryRecord,
  toAdExampleInput,
  ChatGPTAdLibraryParseError,
} from "@/lib/chatgpt-ad-library/normalize";
import {
  CHATGPT_AD_LIBRARY_IMAGE_HOST,
  CHATGPT_AD_LIBRARY_PROVIDER,
  type ChatGPTAdLibraryImportResult,
  type ChatGPTAdLibraryImportSummary,
  type ChatGPTAdLibraryRecord,
} from "@/lib/chatgpt-ad-library/types";
import { CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX } from "@/lib/chatgpt-ad-library/import-constants";
import {
  mergeChatGPTAdLibraryCopy,
  sanitizeChatGPTAdLibraryCopy,
  scoreChatGPTAdLibraryCopy,
} from "@/lib/chatgpt-ad-library/parse-html";
import { chatGPTAdLibrarySeedRecordForId } from "@/lib/chatgpt-ad-library/seed-records";
import { sanitizeAssetMetadata } from "@/lib/creative-assets/image";
import { MediaLibraryError, uploadInspirationVaultImage } from "@/lib/media-library/upload";
import { createAdminClient } from "@/lib/supabase/admin";

export { CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX } from "@/lib/chatgpt-ad-library/import-constants";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export class ChatGPTAdLibraryImportError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ChatGPTAdLibraryImportError";
    this.code = code;
    this.status = status;
  }
}

async function findExistingByExternalId(externalId: string): Promise<string | null> {
  const admin = createAdminClient();
  // Prefer a path filter; fall back to a bounded metadata scan.
  const filtered = await admin
    .from("brand_assets")
    .select("id,metadata")
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->external_source->>external_id", "eq", externalId)
    .limit(20);

  const rows = !filtered.error && Array.isArray(filtered.data) ? filtered.data : null;
  if (!rows) {
    const fallback = await admin
      .from("brand_assets")
      .select("id,metadata")
      .eq("library_scope", "INSPIRATION")
      .neq("status", "REVOKED")
      .filter("metadata->>library", "eq", "ad_example_library")
      .limit(500);
    if (fallback.error || !fallback.data) {
      throw new ChatGPTAdLibraryImportError(
        "dedupe_lookup_failed",
        500,
        "Bestehende ChatGPT-Library-Einträge konnten nicht geprüft werden.",
      );
    }
    for (const row of fallback.data) {
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
        external.provider === CHATGPT_AD_LIBRARY_PROVIDER &&
        String(external.external_id ?? "") === externalId
      ) {
        return String(row.id);
      }
    }
    return null;
  }

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
      external.provider === CHATGPT_AD_LIBRARY_PROVIDER &&
      String(external.external_id ?? "") === externalId
    ) {
      return String(row.id);
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

/**
 * Existing seed/image-only rows keep the file. Richer live copy overwrites thin metadata.
 */
async function refreshExistingLibraryCopy(input: {
  brandAssetId: string;
  record: ChatGPTAdLibraryRecord;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select("metadata")
    .eq("id", input.brandAssetId)
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .maybeSingle();
  if (error || !data) return false;

  const metadata = asRecord(data.metadata);
  const example = asRecord(metadata.ad_example);
  const external = asRecord(metadata.external_source);
  const current = {
    title: asText(example.title),
    advertiserName: asText(example.advertiser_name),
    body: asText(example.body_text),
    triggeringPrompts: asStringArray(external.triggering_prompts),
  };
  const incoming = sanitizeChatGPTAdLibraryCopy({
    title: input.record.title,
    advertiserName: input.record.advertiserName,
    body: input.record.body,
    triggeringPrompts: input.record.triggeringPrompts,
  });
  const seed = chatGPTAdLibrarySeedRecordForId(input.record.id);
  const seedCopy = seed
    ? sanitizeChatGPTAdLibraryCopy({
        title: seed.title,
        advertiserName: seed.advertiserName,
        body: seed.body,
        triggeringPrompts: [...seed.triggeringPrompts],
      })
    : null;
  const merged =
    mergeChatGPTAdLibraryCopy(current, incoming) ??
    (scoreChatGPTAdLibraryCopy(current) < 0 && seedCopy
      ? mergeChatGPTAdLibraryCopy(current, seedCopy)
      : null);
  if (!merged) return false;

  const nextRecord = {
    ...input.record,
    title: merged.title || input.record.title,
    advertiserName: merged.advertiserName || input.record.advertiserName,
    body: merged.body,
    triggeringPrompts: merged.triggeringPrompts,
    landingPageUrl:
      input.record.landingPageUrl ??
      (seed && "landingPageUrl" in seed ? seed.landingPageUrl : null) ??
      asText(example.landing_page_url) ||
      null,
  };

  const nextMetadata = sanitizeAssetMetadata({
    ...metadata,
    ...adExampleMetadata(toAdExampleInput(nextRecord)),
    never_launch: true,
    external_source: {
      ...external,
      ...externalSourceMetadata(nextRecord),
    },
  });

  const updated = await admin
    .from("brand_assets")
    .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
    .eq("id", input.brandAssetId)
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .select("id")
    .maybeSingle();
  return Boolean(updated.data?.id);
}

export async function downloadAndConvertLibraryImage(imageUrl: string): Promise<{
  bytes: Uint8Array;
  mimeType: "image/jpeg";
  fileName: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new ChatGPTAdLibraryImportError("invalid_image_url", 400, "Bild-URL ist ungültig.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== CHATGPT_AD_LIBRARY_IMAGE_HOST) {
    throw new ChatGPTAdLibraryImportError(
      "image_host_forbidden",
      400,
      `Bilder dürfen nur von ${CHATGPT_AD_LIBRARY_IMAGE_HOST} geladen werden.`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/webp,image/jpeg,image/png,*/*",
        "User-Agent": "AdbotInternalCorpus/1.0 (+admin-inspiration-import)",
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new ChatGPTAdLibraryImportError(
      "image_fetch_failed",
      502,
      error instanceof Error && error.name === "AbortError"
        ? "Bild-Download hat das Zeitlimit überschritten."
        : "Bild konnte nicht geladen werden.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ChatGPTAdLibraryImportError(
      "image_fetch_failed",
      502,
      `Bild-Download fehlgeschlagen (HTTP ${response.status}).`,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new ChatGPTAdLibraryImportError(
      "image_too_large",
      413,
      "Bild ist größer als 8 MB.",
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ChatGPTAdLibraryImportError(
      "image_too_large",
      413,
      "Bild ist leer oder größer als 8 MB.",
    );
  }

  // Reject HTML challenge pages masquerading as images.
  const head = buffer.subarray(0, 64).toString("utf8").toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) {
    throw new ChatGPTAdLibraryImportError(
      "image_not_binary",
      502,
      "CDN lieferte HTML statt eines Bildes (vermutlich Bot-Schutz).",
    );
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(buffer, { failOn: "error", animated: false })
      .rotate()
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ChatGPTAdLibraryImportError(
      "image_convert_failed",
      400,
      "WebP/Bild konnte nicht nach JPEG konvertiert werden.",
    );
  }

  const fileStem = parsed.pathname.split("/").pop()?.replace(/\.webp$/i, "") || "chatgpt-ad";
  return {
    bytes: new Uint8Array(jpeg),
    mimeType: "image/jpeg",
    fileName: `${fileStem.slice(0, 80)}.jpg`,
  };
}

export async function importChatGPTAdLibraryRecord(input: {
  uploaderUserId: string;
  record: unknown;
}): Promise<ChatGPTAdLibraryImportResult> {
  let record: ChatGPTAdLibraryRecord;
  try {
    record = normalizeChatGPTAdLibraryRecord(input.record);
  } catch (error) {
    return {
      externalId:
        input.record &&
        typeof input.record === "object" &&
        !Array.isArray(input.record) &&
        "id" in input.record
          ? String((input.record as { id: unknown }).id)
          : "unknown",
      status: "failed",
      brandAssetId: null,
      error:
        error instanceof ChatGPTAdLibraryParseError
          ? error.message
          : "Datensatz ungültig.",
    };
  }

  const externalId = String(record.id);
  try {
    const existingId = await findExistingByExternalId(externalId);
    if (existingId) {
      const refreshed = await refreshExistingLibraryCopy({
        brandAssetId: existingId,
        record,
      });
      return {
        externalId,
        status: refreshed ? "refreshed" : "skipped_duplicate",
        brandAssetId: existingId,
        error: null,
      };
    }

    const image = await downloadAndConvertLibraryImage(record.imageUrl);
    const exampleInput = toAdExampleInput(record);
    const metadata = {
      ...adExampleMetadata(exampleInput),
      external_source: externalSourceMetadata(record),
    };

    const uploaded = await uploadInspirationVaultImage({
      uploaderUserId: input.uploaderUserId,
      fileName: image.fileName,
      mimeType: image.mimeType,
      bytes: image.bytes,
      metadata,
    });

    return {
      externalId,
      status: "imported",
      brandAssetId: uploaded.brandAssetId,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof ChatGPTAdLibraryImportError || error instanceof MediaLibraryError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Import fehlgeschlagen.";
    return {
      externalId,
      status: "failed",
      brandAssetId: null,
      error: message.slice(0, 500),
    };
  }
}

export async function importChatGPTAdLibraryBatch(input: {
  uploaderUserId: string;
  records: unknown[];
}): Promise<ChatGPTAdLibraryImportSummary> {
  if (!Array.isArray(input.records) || input.records.length < 1) {
    throw new ChatGPTAdLibraryImportError(
      "empty_batch",
      400,
      "Mindestens ein Datensatz ist erforderlich.",
    );
  }
  if (input.records.length > CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX) {
    throw new ChatGPTAdLibraryImportError(
      "batch_too_large",
      400,
      `Höchstens ${CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX} Datensätze pro Anfrage.`,
    );
  }

  const results: ChatGPTAdLibraryImportResult[] = [];
  for (const record of input.records) {
    results.push(
      await importChatGPTAdLibraryRecord({
        uploaderUserId: input.uploaderUserId,
        record,
      }),
    );
  }

  return {
    attempted: results.length,
    imported: results.filter((item) => item.status === "imported").length,
    refreshed: results.filter((item) => item.status === "refreshed").length,
    skippedDuplicate: results.filter((item) => item.status === "skipped_duplicate").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  };
}
