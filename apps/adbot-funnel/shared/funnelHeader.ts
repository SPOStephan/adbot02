import type { FunnelBrand, FunnelPage, FunnelStepsHeader, LogoTint } from "./funnel";
import { LOGO_TINTS } from "./funnel";

export const EMPTY_STEPS_HEADER: FunnelStepsHeader = {
  enabled: false,
  logoUrl: "",
  logoTint: "original",
  securityTextColor: "",
};

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
    logoUrl: typeof input?.logoUrl === "string" ? input.logoUrl.trim().slice(0, 2048) : "",
    logoTint: resolveLogoTint(input?.logoTint),
    securityTextColor: typeof input?.securityTextColor === "string" && /^#[0-9a-fA-F]{6}$/.test(input.securityTextColor) ? input.securityTextColor : "",
  };
}

/** The page of type "start" uses the start settings; legal pages and all later steps use the follow-up settings. */
export function isStartPageStep(pages: Pick<FunnelPage, "type">[] | undefined, step: number): boolean {
  return pages?.[step]?.type === "start";
}

export type ResolvedFunnelHeader = {
  logoUrl: string;
  logoTint: LogoTint;
  securityTextColor: string;
};

/** Logo and "SSL-verschlüsselt" for one page. Without enabled follow-up settings every page looks like the start page. */
export function resolveFunnelHeader(brand: FunnelBrand, isStartPage: boolean): ResolvedFunnelHeader {
  const start: ResolvedFunnelHeader = {
    logoUrl: brand.logoUrl,
    logoTint: resolveLogoTint(brand.logoTint),
    securityTextColor: brand.securityTextColor ?? "",
  };
  const steps = brand.stepsHeader;
  if (isStartPage || !steps?.enabled) return start;
  return {
    logoUrl: steps.logoUrl || brand.logoUrl,
    logoTint: resolveLogoTint(steps.logoTint),
    securityTextColor: steps.securityTextColor ?? "",
  };
}
