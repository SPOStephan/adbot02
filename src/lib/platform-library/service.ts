import "server-only";

import { normalizeCreativeTags } from "@/lib/ad-examples/structure";
import { getCreativeAssetStorageBucket } from "@/lib/creative-assets/env";
import {
  inspectCreativeImage,
  sanitizeAssetMetadata,
} from "@/lib/creative-assets/image";
import { CreativeAssetProviderError } from "@/lib/creative-assets/types";
import {
  MediaLibraryError,
  uploadCustomerLibraryImage,
} from "@/lib/media-library/upload";
import { createAdminClient } from "@/lib/supabase/admin";

import { describePlatformMotifImage } from "./caption";
import {
  emptyPlatformMotifMetadata,
  readPlatformMotifMetadata,
} from "./metadata";
import { storePlatformLibraryAsset } from "./storage";
import type { PlatformMotifView } from "./types";

const LIST_SELECT =
  "id,original_filename,width,height,mime_type,metadata,created_at,updated_at,status";

function asRow(row: Record<string, unknown>): PlatformMotifView {
  const meta = readPlatformMotifMetadata(row.metadata);
  return {
    id: String(row.id),
    originalFilename: String(row.original_filename ?? "Motiv"),
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    mimeType: String(row.mime_type ?? ""),
    tags: meta.tags,
    contentSummary: meta.content_summary,
    captionStatus: meta.caption_status,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listPlatformMotifs(input?: {
  tag?: string | null;
  search?: string | null;
  limit?: number;
}): Promise<{ motifs: PlatformMotifView[]; total: number }> {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(input?.limit ?? 60, 1), 200);
  const tag = input?.tag?.trim().toLowerCase() ?? "";
  let query = admin
    .from("brand_assets")
    .select(LIST_SELECT, { count: "exact" })
    .eq("library_scope", "PLATFORM")
    .neq("status", "REVOKED")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tag) {
    query = query.contains("metadata", { tags: [tag] });
  }

  const { data, error, count } = await query;
  if (error) {
    throw new MediaLibraryError(
      "list_failed",
      500,
      "Die Motivbibliothek konnte nicht geladen werden.",
    );
  }

  const search = input?.search?.trim().toLowerCase() ?? "";
  const motifs = (data ?? [])
    .map((row) => asRow(row as Record<string, unknown>))
    .filter((motif) => {
      if (!search) return true;
      return (
        motif.originalFilename.toLowerCase().includes(search) ||
        motif.tags.some((item) => item.includes(search)) ||
        (motif.contentSummary ?? "").toLowerCase().includes(search)
      );
    });

  return { motifs, total: count ?? motifs.length };
}

export async function uploadPlatformMotif(input: {
  uploaderUserId: string;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  tags?: readonly string[];
}): Promise<{ motif: PlatformMotifView; reusedExisting: boolean }> {
  const declared =
    input.mimeType === "image/png" || input.mimeType === "image/jpeg"
      ? input.mimeType
      : input.mimeType === "image/jpg"
        ? "image/jpeg"
        : null;
  if (!declared) {
    throw new MediaLibraryError(
      "unsupported_type",
      400,
      "Nur PNG oder JPEG sind erlaubt.",
    );
  }

  let inspected;
  try {
    inspected = inspectCreativeImage({
      bytes: input.bytes,
      declaredMimeType: declared,
    });
  } catch (error) {
    if (error instanceof CreativeAssetProviderError) {
      throw new MediaLibraryError(error.code, 400, error.message);
    }
    throw new MediaLibraryError(
      "inspect_failed",
      400,
      "Bild konnte nicht geprüft werden.",
    );
  }

  const bucket = getCreativeAssetStorageBucket();
  const stored = await storePlatformLibraryAsset({
    uploaderUserId: input.uploaderUserId,
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    mimeType: inspected.mimeType,
    bucket,
  });

  const admin = createAdminClient();
  const prior = await admin
    .from("brand_assets")
    .select("id")
    .eq("library_scope", "PLATFORM")
    .eq("sha256", inspected.sha256)
    .neq("status", "REVOKED")
    .limit(1);
  const reusedExisting = Boolean(prior.data?.[0]?.id);

  const metadata = sanitizeAssetMetadata(
    emptyPlatformMotifMetadata(input.tags ?? []),
  );
  const { data, error } = await admin.rpc("register_platform_library_asset", {
    p_uploader_user_id: input.uploaderUserId,
    p_storage_bucket: stored.bucket,
    p_storage_path: stored.path,
    p_original_filename: (input.fileName || "motiv.jpg").slice(0, 160),
    p_sha256: inspected.sha256,
    p_mime_type: inspected.mimeType,
    p_byte_size: inspected.byteSize,
    p_width: inspected.width,
    p_height: inspected.height,
    p_metadata: metadata,
  });
  if (error || typeof data !== "string") {
    throw new MediaLibraryError(
      "register_failed",
      409,
      error?.message || "Motiv konnte nicht registriert werden.",
    );
  }

  if (!reusedExisting) {
    void captionPlatformMotif({
      assetId: data,
      adminUserId: input.uploaderUserId,
      bytes: inspected.bytes,
      mimeType: inspected.mimeType,
    }).catch((captionError) => {
      console.error("[platform-library] caption failed", captionError);
    });
  }

  const loaded = await loadPlatformMotif(data);
  return { motif: loaded, reusedExisting };
}

export async function loadPlatformMotif(assetId: string): Promise<PlatformMotifView> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select(LIST_SELECT)
    .eq("id", assetId)
    .eq("library_scope", "PLATFORM")
    .maybeSingle();
  if (error || !data) {
    throw new MediaLibraryError("not_found", 404, "Motiv wurde nicht gefunden.");
  }
  return asRow(data as Record<string, unknown>);
}

export async function updatePlatformMotif(input: {
  adminUserId: string;
  assetId: string;
  tags?: readonly string[];
  contentSummary?: string | null;
}): Promise<PlatformMotifView> {
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from("brand_assets")
    .select("metadata")
    .eq("id", input.assetId)
    .eq("library_scope", "PLATFORM")
    .maybeSingle();
  if (loadError || !existing) {
    throw new MediaLibraryError("not_found", 404, "Motiv wurde nicht gefunden.");
  }

  const current = readPlatformMotifMetadata(existing.metadata);
  const next = sanitizeAssetMetadata({
    ...current,
    tags:
      input.tags === undefined
        ? current.tags
        : normalizeCreativeTags([...input.tags]),
    content_summary:
      input.contentSummary === undefined
        ? current.content_summary
        : input.contentSummary?.trim().slice(0, 400) || null,
    caption_status:
      input.contentSummary === undefined
        ? current.caption_status
        : input.contentSummary?.trim()
          ? "ready"
          : current.caption_status,
  });

  const { error } = await admin.rpc("update_platform_library_asset_metadata", {
    p_admin_user_id: input.adminUserId,
    p_asset_id: input.assetId,
    p_metadata: next,
  });
  if (error) {
    throw new MediaLibraryError(
      "update_failed",
      409,
      error.message || "Motiv konnte nicht aktualisiert werden.",
    );
  }
  return loadPlatformMotif(input.assetId);
}

export async function captionPlatformMotif(input: {
  assetId: string;
  adminUserId: string;
  bytes?: Uint8Array;
  mimeType?: "image/png" | "image/jpeg";
}): Promise<PlatformMotifView> {
  const admin = createAdminClient();
  let bytes = input.bytes;
  let mimeType = input.mimeType;
  if (!bytes || !mimeType) {
    const { data: asset, error } = await admin
      .from("brand_assets")
      .select("storage_bucket,storage_path,mime_type")
      .eq("id", input.assetId)
      .eq("library_scope", "PLATFORM")
      .maybeSingle();
    if (error || !asset?.storage_bucket || !asset.storage_path) {
      throw new MediaLibraryError("not_found", 404, "Motiv wurde nicht gefunden.");
    }
    const downloaded = await admin.storage
      .from(String(asset.storage_bucket))
      .download(String(asset.storage_path));
    if (downloaded.error || !downloaded.data) {
      throw new MediaLibraryError(
        "download_failed",
        500,
        "Motiv konnte nicht gelesen werden.",
      );
    }
    bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    mimeType =
      asset.mime_type === "image/png" ? "image/png" : "image/jpeg";
  }

  let summary: string | null = null;
  let status: "ready" | "failed" | "skipped" = "skipped";
  try {
    summary = await describePlatformMotifImage({
      bytes,
      mimeType,
    });
    status = summary ? "ready" : "skipped";
  } catch (error) {
    console.error("[platform-library] caption provider failed", error);
    status = "failed";
  }

  const { data: existing } = await admin
    .from("brand_assets")
    .select("metadata")
    .eq("id", input.assetId)
    .eq("library_scope", "PLATFORM")
    .maybeSingle();
  const current = readPlatformMotifMetadata(existing?.metadata);
  await admin.rpc("update_platform_library_asset_metadata", {
    p_admin_user_id: input.adminUserId,
    p_asset_id: input.assetId,
    p_metadata: sanitizeAssetMetadata({
      ...current,
      content_summary: summary ?? current.content_summary,
      caption_status: status,
    }),
  });
  return loadPlatformMotif(input.assetId);
}

export async function revokePlatformMotif(input: {
  adminUserId: string;
  assetId: string;
}): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(input.adminUserId)) {
    throw new MediaLibraryError("forbidden", 403, "Nur Admins dürfen Motive entfernen.");
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .update({ status: "REVOKED", updated_at: new Date().toISOString() })
    .eq("id", input.assetId)
    .eq("library_scope", "PLATFORM")
    .neq("status", "REVOKED")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new MediaLibraryError("not_found", 404, "Motiv wurde nicht gefunden.");
  }
}

/**
 * Copy a PLATFORM motif into the calling customer's isolated library.
 * Launch and Meta writes stay on the CUSTOMER clone — never the shared row.
 */
export async function clonePlatformMotifForCustomer(input: {
  platformAssetId: string;
  userId: string;
  platformAccountId?: string | null;
  brandProfileId?: string | null;
}): Promise<{ brandAssetId: string; reusedExisting: boolean }> {
  const admin = createAdminClient();
  const { data: source, error } = await admin
    .from("brand_assets")
    .select(
      "id,sha256,mime_type,storage_bucket,storage_path,original_filename,metadata,status,library_scope",
    )
    .eq("id", input.platformAssetId)
    .eq("library_scope", "PLATFORM")
    .eq("status", "READY")
    .maybeSingle();
  if (error || !source?.storage_bucket || !source.storage_path) {
    throw new MediaLibraryError(
      "not_found",
      404,
      "Adbot-Motiv wurde nicht gefunden.",
    );
  }

  const existing = await admin
    .from("brand_assets")
    .select("id")
    .eq("user_id", input.userId)
    .eq("library_scope", "CUSTOMER")
    .eq("sha256", source.sha256)
    .neq("status", "REVOKED")
    .limit(1);
  const priorId = existing.data?.[0]?.id;
  if (typeof priorId === "string") {
    return { brandAssetId: priorId, reusedExisting: true };
  }

  const downloaded = await admin.storage
    .from(String(source.storage_bucket))
    .download(String(source.storage_path));
  if (downloaded.error || !downloaded.data) {
    throw new MediaLibraryError(
      "download_failed",
      500,
      "Adbot-Motiv konnte nicht kopiert werden.",
    );
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const sourceMeta = readPlatformMotifMetadata(source.metadata);
  const cloneMetadata = sanitizeAssetMetadata({
    contract_version: 1,
    library: "customer",
    source_kind: "platform_motif_clone",
    adopted_from_platform_asset_id: source.id,
    usable_one_to_one: true,
    tags: sourceMeta.tags,
  });

  if (!input.platformAccountId) {
    const { registerCustomerLibraryImage } = await import(
      "@/lib/creative-assets/library-generate"
    );
    const brandAssetId = await registerCustomerLibraryImage({
      userId: input.userId,
      platformAccountId: null,
      brandProfileId: input.brandProfileId,
      fileName: String(source.original_filename ?? "motiv.jpg"),
      bytes,
      sourceType: "UPLOADED",
      metadata: cloneMetadata,
    });
    return { brandAssetId, reusedExisting: false };
  }

  const uploaded = await uploadCustomerLibraryImage({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
    brandProfileId: input.brandProfileId,
    fileName: String(source.original_filename ?? "motiv.jpg"),
    mimeType: String(source.mime_type),
    bytes,
    generateMetaCrops: false,
  });
  await admin
    .from("brand_assets")
    .update({ metadata: cloneMetadata, updated_at: new Date().toISOString() })
    .eq("id", uploaded.brandAssetId)
    .eq("user_id", input.userId)
    .eq("library_scope", "CUSTOMER");
  return {
    brandAssetId: uploaded.brandAssetId,
    reusedExisting: false,
  };
}
