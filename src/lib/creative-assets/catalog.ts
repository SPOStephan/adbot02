import "server-only";

import { createAdminClient } from "../supabase/admin";

export type BrandAssetSourceType =
  | "EXISTING_META"
  | "UPLOADED"
  | "GENERATED";

export type ReadyBrandAsset = {
  id: string;
  sourceType: BrandAssetSourceType;
  mimeType: string;
  width: number | null;
  height: number | null;
  brandPolicyVersion: number;
  metaImageHash: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  sha256: string;
  updatedAt: string;
};

export type BrandAssetRequirement = {
  allowedMimeTypes: readonly string[];
  minimumWidth?: number;
  minimumHeight?: number;
  targetAspectRatio?: number;
  aspectRatioTolerance?: number;
  currentBrandPolicyVersion?: number;
};

export type BrandAssetDecision =
  | {
      action: "REUSE";
      asset: ReadyBrandAsset;
      reason: "MATCHING_READY_ASSET";
    }
  | {
      action: "GENERATE";
      asset: null;
      reason: "NO_READY_ASSET" | "NO_FORMAT_MATCH" | "NO_DIMENSION_MATCH";
    };

type BrandAssetRow = {
  id: string;
  source_type: BrandAssetSourceType;
  mime_type: string;
  width: number | null;
  height: number | null;
  brand_policy_version: number;
  meta_image_hash: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  sha256: string;
  updated_at: string;
};

function assertUuid(value: string, name: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
}

function validateRequirement(requirement: BrandAssetRequirement): void {
  if (
    requirement.allowedMimeTypes.length === 0 ||
    requirement.allowedMimeTypes.length > 10 ||
    requirement.allowedMimeTypes.some(
      (mimeType) => !/^(image|video)\/[a-z0-9.+-]+$/.test(mimeType),
    )
  ) {
    throw new Error("Brand asset MIME requirements are invalid");
  }
  for (const value of [requirement.minimumWidth, requirement.minimumHeight]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 8192)) {
      throw new Error("Brand asset dimension requirements are invalid");
    }
  }
  if (
    requirement.targetAspectRatio !== undefined &&
    (!Number.isFinite(requirement.targetAspectRatio) ||
      requirement.targetAspectRatio < 0.1 ||
      requirement.targetAspectRatio > 10)
  ) {
    throw new Error("Brand asset aspect-ratio requirement is invalid");
  }
  if (
    requirement.aspectRatioTolerance !== undefined &&
    (!Number.isFinite(requirement.aspectRatioTolerance) ||
      requirement.aspectRatioTolerance < 0 ||
      requirement.aspectRatioTolerance > 0.5)
  ) {
    throw new Error("Brand asset aspect-ratio tolerance is invalid");
  }
}

function normalizedRow(row: BrandAssetRow): ReadyBrandAsset {
  return {
    id: row.id,
    sourceType: row.source_type,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    brandPolicyVersion: row.brand_policy_version,
    metaImageHash: row.meta_image_hash,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    sha256: row.sha256,
    updatedAt: row.updated_at,
  };
}

function matchesDimensions(
  asset: ReadyBrandAsset,
  requirement: BrandAssetRequirement,
): boolean {
  if (
    requirement.minimumWidth !== undefined &&
    (asset.width === null || asset.width < requirement.minimumWidth)
  ) {
    return false;
  }
  if (
    requirement.minimumHeight !== undefined &&
    (asset.height === null || asset.height < requirement.minimumHeight)
  ) {
    return false;
  }
  if (requirement.targetAspectRatio !== undefined) {
    if (!asset.width || !asset.height) {
      return false;
    }
    const actualRatio = asset.width / asset.height;
    const relativeDifference = Math.abs(
      actualRatio - requirement.targetAspectRatio,
    ) / requirement.targetAspectRatio;
    if (relativeDifference > (requirement.aspectRatioTolerance ?? 0.05)) {
      return false;
    }
  }
  return true;
}

function scoreAsset(
  asset: ReadyBrandAsset,
  requirement: BrandAssetRequirement,
): number {
  let score = 0;
  if (
    requirement.currentBrandPolicyVersion !== undefined &&
    asset.brandPolicyVersion === requirement.currentBrandPolicyVersion
  ) {
    score += 100;
  }
  if (asset.metaImageHash) {
    score += 30;
  }
  if (asset.sourceType === "EXISTING_META") {
    score += 20;
  } else if (asset.sourceType === "UPLOADED") {
    score += 10;
  }
  if (
    requirement.targetAspectRatio !== undefined &&
    asset.width &&
    asset.height
  ) {
    const relativeDifference = Math.abs(
      asset.width / asset.height - requirement.targetAspectRatio,
    ) / requirement.targetAspectRatio;
    score += Math.max(0, 20 - relativeDifference * 100);
  }
  return score;
}

export function decideBrandAssetAction(input: {
  candidates: readonly ReadyBrandAsset[];
  requirement: BrandAssetRequirement;
}): BrandAssetDecision {
  validateRequirement(input.requirement);
  if (input.candidates.length === 0) {
    return { action: "GENERATE", asset: null, reason: "NO_READY_ASSET" };
  }

  const formatMatches = input.candidates.filter((asset) =>
    input.requirement.allowedMimeTypes.includes(asset.mimeType),
  );
  if (formatMatches.length === 0) {
    return { action: "GENERATE", asset: null, reason: "NO_FORMAT_MATCH" };
  }

  const validMatches = formatMatches.filter((asset) =>
    matchesDimensions(asset, input.requirement),
  );
  if (validMatches.length === 0) {
    return { action: "GENERATE", asset: null, reason: "NO_DIMENSION_MATCH" };
  }

  const selected = [...validMatches].sort((left, right) => {
    const scoreDifference =
      scoreAsset(right, input.requirement) - scoreAsset(left, input.requirement);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    const updatedDifference = right.updatedAt.localeCompare(left.updatedAt);
    return updatedDifference !== 0
      ? updatedDifference
      : left.id.localeCompare(right.id);
  })[0];

  return {
    action: "REUSE",
    asset: selected,
    reason: "MATCHING_READY_ASSET",
  };
}

export async function listReadyBrandAssets(input: {
  userId: string;
  platformAccountId: string;
  limit?: number;
}): Promise<ReadyBrandAsset[]> {
  assertUuid(input.userId, "userId");
  assertUuid(input.platformAccountId, "platformAccountId");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Brand asset list limit must be between 1 and 200");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select([
      "id", "source_type", "mime_type", "width", "height",
      "brand_policy_version", "meta_image_hash", "storage_bucket",
      "storage_path", "sha256", "updated_at",
    ].join(","))
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("status", "READY")
    .eq("moderation_status", "APPROVED")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error("Ready brand asset catalog query failed");
  }

  const rows = (data ?? []) as unknown as BrandAssetRow[];
  return rows.map(normalizedRow);
}
