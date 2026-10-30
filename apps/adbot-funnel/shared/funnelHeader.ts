import type { FunnelBrand, FunnelPage, FunnelStepsHeader, LogoTint } from "./funnel";
import { LOGO_TINTS } from "./funnel";

export const EMPTY_STEPS_HEADER: FunnelStepsHeader = {
  enabled: false,
  logoUrl: "",
  logoTint: "original",
  securityTextColor: "",
  securityIconColor: "",
};

export const DEFAULT_SECURITY_TEXT = "SSL-verschlüsselt";
export const DEFAULT_SECURITY_ICON = "lock";
export const MAX_SECURITY_TEXT = 60;

/** Missing = the default note, an explicitly empty string hides it. */
export function resolveSecurityText(value?: string | null): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_SECURITY_TEXT) : DEFAULT_SECURITY_TEXT;
}

/** Missing = lock, an explicitly empty string hides the icon. */
export function resolveSecurityIcon(value?: string | null): string {
  return typeof value === "string" ? value.trim() : DEFAULT_SECURITY_ICON;
}

export const LOGO_TINT_META: Array<{ id: LogoTint; title: string; description: string }> = [
  { id: "original", title: "Original", description: "Logo wie hochgeladen." },
  { id: "white", title: "Weiß", description: "Für dunkle oder farbige Hintergründe." },
  { id: "dark", title: "Dunkel", description: "Für helle Hintergründe." },
];

export function resolveLogoTint(value?: string | null): LogoTint {
  return (LOGO_TINTS as readonly string[]).includes(value ?? "") ? (value as LogoTint) : "original";
}

/**
 * CSS filter that turns every visible pixel of the logo white or near-black.
 * Works for PNG/WebP with transparent background; a JPG becomes a solid rectangle.
 */
export function logoTintFilter(tint?: string | null): string | undefined {
  const resolved = resolveLogoTint(tint);
  if (resolved === "white") return "brightness(0) invert(1)";
  if (resolved === "dark") return "brightness(0)";
  return undefined;
}

export function normalizeStepsHeader(input?: Partial<FunnelStepsHeader> | null): FunnelStepsHeader {
  return {
    enabled: input?.enabled === true,
    ...(typeof input?.securityColorsEnabled === "boolean" ? { securityColorsEnabled: input.securityColorsEnabled } : {}),
    logoUrl: typeof input?.logoUrl === "string" ? input.logoUrl.trim().slice(0, 2048) : "",
    logoTint: resolveLogoTint(input?.logoTint),
    securityTextColor: hexOrEmpty(input?.securityTextColor),
    securityIconColor: hexOrEmpty(input?.securityIconColor),
  };
}

function hexOrEmpty(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "";
}

/** The page of type "start" uses the start settings; legal pages and all later steps use the follow-up settings. */
export function isStartPageStep(pages: Pick<FunnelPage, "type">[] | undefined, step: number): boolean {
  return pages?.[step]?.type === "start";
}

export type ResolvedFunnelHeader = {
  logoUrl: string;
  logoTint: LogoTint;
  securityText: string;
  securityIcon: string;
  securityTextColor: string;
  /** Empty = inherits the text color. */
  securityIconColor: string;
};

/** Logo and "SSL-verschlüsselt" for one page. Without enabled follow-up settings every page looks like the start page. */
export function resolveFunnelHeader(brand: FunnelBrand, isStartPage: boolean): ResolvedFunnelHeader {
  const start: ResolvedFunnelHeader = {
    logoUrl: brand.logoUrl,
    logoTint: resolveLogoTint(brand.logoTint),
    securityText: resolveSecurityText(brand.securityText),
    securityIcon: resolveSecurityIcon(brand.securityIcon),
    securityTextColor: brand.securityTextColor ?? "",
    securityIconColor: brand.securityIconColor ?? "",
  };
  const steps = brand.stepsHeader;
  if (isStartPage || !steps) return start;
  const header = { ...start };
  if (steps.enabled) {
    header.logoUrl = steps.logoUrl || brand.logoUrl;
    header.logoTint = resolveLogoTint(steps.logoTint);
  }
  if (stepsSecurityColorsEnabled(steps)) {
    header.securityTextColor = steps.securityTextColor ?? "";
    header.securityIconColor = steps.securityIconColor ?? "";
  }
  return header;
}

export function stepsSecurityColorsEnabled(steps?: Pick<FunnelStepsHeader, "enabled" | "securityColorsEnabled"> | null): boolean {
  return steps?.securityColorsEnabled ?? steps?.enabled === true;
}
