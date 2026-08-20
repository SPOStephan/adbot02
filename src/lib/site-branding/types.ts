export const LOGO_VARIANTS = ["on_light", "on_dark"] as const;

export type LogoVariant = (typeof LOGO_VARIANTS)[number];

export type SiteBranding = {
  logoOnLightUrl: string | null;
  logoOnDarkUrl: string | null;
  faviconUrl: string | null;
  updatedAt: string | null;
};

export function isLogoVariant(value: string): value is LogoVariant {
  return (LOGO_VARIANTS as readonly string[]).includes(value);
}

/** Page surface: light dashboard vs dark landing/auth. */
export type BrandSurface = "light" | "dark";
