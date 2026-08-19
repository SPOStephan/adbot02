import "server-only";

import { inspectCreativeImage } from "./image";
import { PHASE5_MAX_STYLE_REFERENCES } from "./style-reference-constants";
import {
  CreativeAssetProviderError,
  type CreativeImageMimeType,
} from "./types";
import { createAdminClient } from "../supabase/admin";

export type StyleReferenceAsset = {
  assetId: string;
  bytes: Uint8Array;
  sha256: string;
  mimeType: CreativeImageMimeType;
  width: number;
  height: number;
  source:
    | "customer_marked_good"
    | "customer_performance_winner"
    | "customer_style_reference"
    | "inspiration_vault";
};

function classifySource(row: {
  library_scope: string;
  asset_role: string;
  training_status: string;
}): StyleReferenceAsset["source"] {
  if (row.library_scope === "INSPIRATION") {
    return "inspiration_vault";
  }
  if (row.training_status === "performance_winner") {
    return "customer_performance_winner";
  }
  if (row.training_status === "marked_good") {
    return "customer_marked_good";
  }
  return "customer_style_reference";
}

/**
 * Load style references for generation.
 * Allowed:
 * - CUSTOMER owned by user: READY/APPROVED + (marked_good | performance_winner | STYLE_REFERENCE)
 * - INSPIRATION vault: READY/APPROVED + STYLE_REFERENCE (global style corpus)
 */
export async function loadVerifiedStyleReferenceAssets(input: {
  userId: string;
  platformAccountId: string;
  assetIds: readonly string[];
}): Promise<StyleReferenceAsset[]> {
  if (input.assetIds.length < 1) {
    return [];
  }
  if (input.assetIds.length > PHASE5_MAX_STYLE_REFERENCES) {
    throw new CreativeAssetProviderError({
      code: "style_reference_limit",
      message: `Höchstens ${PHASE5_MAX_STYLE_REFERENCES} Style-Referenzen pro Job.`,
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  const uniqueIds = [...new Set(input.assetIds.map((id) => id.toLowerCase()))];
  if (uniqueIds.length !== input.assetIds.length) {
    throw new CreativeAssetProviderError({
      code: "style_reference_duplicate",
      message: "reference_asset_ids dürfen keine Duplikate enthalten.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select(
      "id,user_id,platform_account_id,sha256,mime_type,byte_size,width,height,storage_bucket,storage_path,status,moderation_status,library_scope,asset_role,training_status",
    )
    .in("id", uniqueIds)
    .eq("status", "READY")
    .eq("moderation_status", "APPROVED");

  if (error) {
    throw new CreativeAssetProviderError({
      code: "style_reference_lookup_failed",
      message: "Style-Referenzen konnten nicht geladen werden.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: true,
    });
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== uniqueIds.length) {
    throw new CreativeAssetProviderError({
      code: "style_reference_not_found",
      message:
        "Mindestens eine Style-Referenz fehlt oder ist nicht READY/APPROVED.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  const byId = new Map(
    rows.map((row) => [(row as { id: string }).id.toLowerCase(), row]),
  );
  const loaded: StyleReferenceAsset[] = [];

  for (const assetId of uniqueIds) {
    const row = byId.get(assetId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new CreativeAssetProviderError({
        code: "style_reference_not_found",
        message: "Style-Referenz wurde nicht gefunden.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    const libraryScope = String(row.library_scope ?? "");
    const assetRole = String(row.asset_role ?? "");
    const trainingStatus = String(row.training_status ?? "none");
    const ownerUserId = String(row.user_id ?? "");
    const ownerPlatformAccountId = String(row.platform_account_id ?? "");

    const isInspiration =
      libraryScope === "INSPIRATION" && assetRole === "STYLE_REFERENCE";
    const isCustomerEligible =
      libraryScope === "CUSTOMER" &&
      ownerUserId === input.userId &&
      ownerPlatformAccountId === input.platformAccountId &&
      (trainingStatus === "marked_good" ||
        trainingStatus === "performance_winner" ||
        assetRole === "STYLE_REFERENCE");

    if (!isInspiration && !isCustomerEligible) {
      throw new CreativeAssetProviderError({
        code: "style_reference_not_allowed",
        message:
          "Style-Referenz muss Inspiration-Vault (STYLE_REFERENCE) oder eigenes marked_good/performance_winner Asset sein.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    const sha256 = String(row.sha256 ?? "");
    const mimeType = String(row.mime_type ?? "") as CreativeImageMimeType;
    const bucket = String(row.storage_bucket ?? "");
    const path = String(row.storage_path ?? "");
    if (
      !/^[0-9a-f]{64}$/.test(sha256) ||
      (mimeType !== "image/png" && mimeType !== "image/jpeg") ||
      !bucket ||
      !path
    ) {
      throw new CreativeAssetProviderError({
        code: "style_reference_invalid",
        message: "Style-Referenz-Metadaten sind ungültig.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    const downloaded = await admin.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) {
      throw new CreativeAssetProviderError({
        code: "style_reference_download_failed",
        message: "Style-Referenz-Bytes konnten nicht geladen werden.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: true,
      });
    }

    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const inspected = inspectCreativeImage({
      bytes,
      declaredMimeType: mimeType,
    });
    if (
      inspected.sha256 !== sha256 ||
      inspected.byteSize !== Number(row.byte_size) ||
      inspected.width !== Number(row.width) ||
      inspected.height !== Number(row.height)
    ) {
      throw new CreativeAssetProviderError({
        code: "style_reference_integrity_failed",
        message: "Style-Referenz-Integrität (Hash/Maße) stimmt nicht.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    loaded.push({
      assetId,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      source: classifySource({
        library_scope: libraryScope,
        asset_role: assetRole,
        training_status: trainingStatus,
      }),
    });
  }

  return loaded;
}

export function styleReferenceToDataUrl(asset: StyleReferenceAsset): string {
  const base64 = Buffer.from(asset.bytes).toString("base64");
  return `data:${asset.mimeType};base64,${base64}`;
}
