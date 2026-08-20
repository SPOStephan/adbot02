import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  SITE_FAVICON_RECOMMENDATIONS,
  SITE_LOGO_RECOMMENDATIONS,
} from "@/lib/site-branding/recommendations";
import type { LogoVariant } from "@/lib/site-branding/types";

export const SITE_BRANDING_BUCKET = "site-branding";
export const SITE_BRANDING_CACHE_CONTROL = "86400";

const BUCKET_OPTIONS = {
  public: true,
  fileSizeLimit: SITE_LOGO_RECOMMENDATIONS.maxBytes,
  allowedMimeTypes: [
    ...SITE_LOGO_RECOMMENDATIONS.allowedMimeTypes,
    ...SITE_FAVICON_RECOMMENDATIONS.allowedMimeTypes,
  ],
};

function extensionForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/x-icon" || mime === "image/vnd.microsoft.icon") {
    return "ico";
  }
  return "jpg";
}

export async function ensureSiteBrandingBucket(): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.getBucket(SITE_BRANDING_BUCKET);
  if (error && !/not found|404/i.test(error.message)) {
    throw new Error("Logo-Storage-Bucket konnte nicht gelesen werden.");
  }

  if (!data) {
    const { error: createError } = await admin.storage.createBucket(
      SITE_BRANDING_BUCKET,
      BUCKET_OPTIONS,
    );
    if (createError && !/already exists|duplicate/i.test(createError.message)) {
      throw new Error("Logo-Storage-Bucket konnte nicht angelegt werden.");
    }
  }

  const { error: updateError } = await admin.storage.updateBucket(
    SITE_BRANDING_BUCKET,
    BUCKET_OPTIONS,
  );
  if (updateError) {
    throw new Error("Logo-Storage-Bucket konnte nicht aktualisiert werden.");
  }
}

export function buildSiteLogoPath(variant: LogoVariant, mime: string): string {
  const stamp = Date.now().toString(36);
  return `logos/${variant}/${stamp}.${extensionForMime(mime)}`;
}

export function buildSiteFaviconPath(mime: string): string {
  const stamp = Date.now().toString(36);
  return `favicon/${stamp}.${extensionForMime(mime)}`;
}

export async function uploadSiteLogo(input: {
  variant: LogoVariant;
  bytes: Uint8Array;
  mimeType: (typeof SITE_LOGO_RECOMMENDATIONS.allowedMimeTypes)[number];
}): Promise<string> {
  if (
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength > SITE_LOGO_RECOMMENDATIONS.maxBytes
  ) {
    throw new Error("Logo-Datei ist leer oder größer als 2 MB.");
  }

  await ensureSiteBrandingBucket();
  const path = buildSiteLogoPath(input.variant, input.mimeType);
  const admin = createAdminClient();
  const { error } = await admin.storage.from(SITE_BRANDING_BUCKET).upload(
    path,
    input.bytes,
    {
      contentType: input.mimeType,
      cacheControl: SITE_BRANDING_CACHE_CONTROL,
      upsert: false,
    },
  );
  if (error) {
    throw new Error(`Logo-Upload fehlgeschlagen: ${error.message}`);
  }
  return path;
}

export async function uploadSiteFavicon(input: {
  bytes: Uint8Array;
  mimeType: (typeof SITE_FAVICON_RECOMMENDATIONS.allowedMimeTypes)[number];
}): Promise<string> {
  if (
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength > SITE_FAVICON_RECOMMENDATIONS.maxBytes
  ) {
    throw new Error("Favicon-Datei ist leer oder größer als 512 KB.");
  }

  await ensureSiteBrandingBucket();
  const path = buildSiteFaviconPath(input.mimeType);
  const admin = createAdminClient();
  const { error } = await admin.storage.from(SITE_BRANDING_BUCKET).upload(
    path,
    input.bytes,
    {
      contentType: input.mimeType,
      cacheControl: SITE_BRANDING_CACHE_CONTROL,
      upsert: false,
    },
  );
  if (error) {
    throw new Error(`Favicon-Upload fehlgeschlagen: ${error.message}`);
  }
  return path;
}

export async function removeSiteLogoObject(
  path: string | null | undefined,
): Promise<void> {
  if (!path) return;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(SITE_BRANDING_BUCKET)
    .remove([path]);
  if (error && !/not found|404/i.test(error.message)) {
    throw new Error(`Logo konnte nicht gelöscht werden: ${error.message}`);
  }
}

export function publicUrlForSiteLogoPath(
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/storage/v1/object/public/${SITE_BRANDING_BUCKET}/${encoded}`;
}
