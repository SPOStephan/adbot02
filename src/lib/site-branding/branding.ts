import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  publicUrlForSiteLogoPath,
  removeSiteLogoObject,
  uploadSiteLogo,
} from "@/lib/site-branding/storage";
import { SITE_LOGO_RECOMMENDATIONS } from "@/lib/site-branding/recommendations";
import type { LogoVariant, SiteBranding } from "@/lib/site-branding/types";

type BrandingRow = {
  logo_on_light_path: string | null;
  logo_on_light_mime: string | null;
  logo_on_dark_path: string | null;
  logo_on_dark_mime: string | null;
  updated_at: string | null;
};

const EMPTY: SiteBranding = {
  logoOnLightUrl: null,
  logoOnDarkUrl: null,
  updatedAt: null,
};

function mapRow(row: BrandingRow | null): SiteBranding {
  if (!row) return EMPTY;
  return {
    logoOnLightUrl: publicUrlForSiteLogoPath(row.logo_on_light_path),
    logoOnDarkUrl: publicUrlForSiteLogoPath(row.logo_on_dark_path),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export const getSiteBranding = cache(async (): Promise<SiteBranding> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("site_branding")
      .select(
        "logo_on_light_path, logo_on_light_mime, logo_on_dark_path, logo_on_dark_mime, updated_at",
      )
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return EMPTY;
    }

    return mapRow(data as BrandingRow);
  } catch {
    return EMPTY;
  }
});

export async function getSiteBrandingAdmin(): Promise<SiteBranding & {
  logoOnLightPath: string | null;
  logoOnDarkPath: string | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_branding")
    .select(
      "logo_on_light_path, logo_on_light_mime, logo_on_dark_path, logo_on_dark_mime, updated_at",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message.includes("site_branding") || error.code === "42P01"
        ? "Tabelle site_branding fehlt — bitte SQL-Migration anwenden."
        : `Branding konnte nicht geladen werden: ${error.message}`,
    );
  }

  const row = (data as BrandingRow | null) ?? null;
  return {
    ...mapRow(row),
    logoOnLightPath: row?.logo_on_light_path ?? null,
    logoOnDarkPath: row?.logo_on_dark_path ?? null,
  };
}

export async function saveSiteLogoVariant(input: {
  variant: LogoVariant;
  bytes: Uint8Array;
  mimeType: (typeof SITE_LOGO_RECOMMENDATIONS.allowedMimeTypes)[number];
  userId: string;
}): Promise<SiteBranding> {
  const current = await getSiteBrandingAdmin();
  const previousPath =
    input.variant === "on_light"
      ? current.logoOnLightPath
      : current.logoOnDarkPath;

  const path = await uploadSiteLogo({
    variant: input.variant,
    bytes: input.bytes,
    mimeType: input.mimeType,
  });

  const patch =
    input.variant === "on_light"
      ? {
          logo_on_light_path: path,
          logo_on_light_mime: input.mimeType,
        }
      : {
          logo_on_dark_path: path,
          logo_on_dark_mime: input.mimeType,
        };

  const admin = createAdminClient();
  const updatedAt = new Date().toISOString();
  const { error } = await admin
    .from("site_branding")
    .update({
      ...patch,
      updated_at: updatedAt,
      updated_by: input.userId,
    })
    .eq("id", 1);

  if (error) {
    await removeSiteLogoObject(path).catch(() => undefined);
    throw new Error(
      error.message.includes("site_branding") || error.code === "42P01"
        ? "Tabelle site_branding fehlt — bitte SQL-Migration anwenden."
        : `Logo konnte nicht gespeichert werden: ${error.message}`,
    );
  }

  if (previousPath && previousPath !== path) {
    await removeSiteLogoObject(previousPath).catch(() => undefined);
  }

  return getSiteBrandingAdmin();
}

export async function clearSiteLogoVariant(input: {
  variant: LogoVariant;
  userId: string;
}): Promise<SiteBranding> {
  const current = await getSiteBrandingAdmin();
  const previousPath =
    input.variant === "on_light"
      ? current.logoOnLightPath
      : current.logoOnDarkPath;

  const patch =
    input.variant === "on_light"
      ? {
          logo_on_light_path: null,
          logo_on_light_mime: null,
        }
      : {
          logo_on_dark_path: null,
          logo_on_dark_mime: null,
        };

  const admin = createAdminClient();
  const updatedAt = new Date().toISOString();
  const { error } = await admin
    .from("site_branding")
    .update({
      ...patch,
      updated_at: updatedAt,
      updated_by: input.userId,
    })
    .eq("id", 1);

  if (error) {
    throw new Error(
      error.message.includes("site_branding") || error.code === "42P01"
        ? "Tabelle site_branding fehlt — bitte SQL-Migration anwenden."
        : `Logo konnte nicht entfernt werden: ${error.message}`,
    );
  }

  await removeSiteLogoObject(previousPath).catch(() => undefined);
  return getSiteBrandingAdmin();
}
