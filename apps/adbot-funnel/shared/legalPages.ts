import { defaultFunnel } from "./defaultFunnel";
import type { FunnelConfig, FunnelLegal, LegalPageMode } from "./funnel";

export const DEFAULT_PRIVACY_TITLE = "Datenschutzerklärung";
export const DEFAULT_IMPRINT_TITLE = "Impressum";

export function resolveLegalPageMode(value: unknown, fallback: LegalPageMode): LegalPageMode {
  return value === "internal" || value === "external" ? value : fallback;
}

export function isHttpsUrl(value?: string | null): boolean {
  return typeof value === "string" && /^https:\/\//i.test(value.trim());
}

export function resolveImprintLink(legal: FunnelLegal, internalPath: string): { href: string; external: boolean } {
  if (resolveLegalPageMode(legal.imprintMode, "internal") === "external" && isHttpsUrl(legal.imprintUrl)) {
    return { href: legal.imprintUrl.trim(), external: true };
  }
  return { href: internalPath, external: false };
}

export function resolvePrivacyLink(
  legal: FunnelLegal,
  privacyUrl: string,
  internalPath: string,
): { href: string; external: boolean } {
  if (resolveLegalPageMode(legal.privacyMode, "external") === "external" && isHttpsUrl(privacyUrl)) {
    return { href: privacyUrl.trim(), external: true };
  }
  return { href: internalPath, external: false };
}

export function legalFooterLinks(
  config: Pick<FunnelConfig, "legal" | "privacyUrl" | "privacyLabel">,
  paths: { imprintUrl: string; privacyUrl: string },
) {
  const imprint = resolveImprintLink(config.legal, paths.imprintUrl);
  const privacy = resolvePrivacyLink(config.legal, config.privacyUrl, paths.privacyUrl);
  return {
    privacyUrl: privacy.href,
    privacyLabel: config.privacyLabel,
    privacyExternal: privacy.external,
    imprintUrl: imprint.href,
    imprintExternal: imprint.external,
  };
}

export function normalizeFunnelLegal(legal?: Partial<FunnelLegal> | null): FunnelLegal {
  const source = legal ?? {};
  return {
    imprintMode: resolveLegalPageMode(source.imprintMode, "internal"),
    imprintTitle: typeof source.imprintTitle === "string" && source.imprintTitle.trim()
      ? source.imprintTitle
      : defaultFunnel.legal.imprintTitle,
    imprintContent: typeof source.imprintContent === "string" ? source.imprintContent : defaultFunnel.legal.imprintContent,
    imprintUrl: typeof source.imprintUrl === "string" ? source.imprintUrl.trim() : "",
    privacyMode: resolveLegalPageMode(source.privacyMode, "external"),
    privacyTitle: typeof source.privacyTitle === "string" && source.privacyTitle.trim()
      ? source.privacyTitle
      : DEFAULT_PRIVACY_TITLE,
    privacyContent: typeof source.privacyContent === "string" ? source.privacyContent : "",
  };
}

export function legalPagesAreValid(config: Pick<FunnelConfig, "legal" | "privacyUrl">): { ok: true } | { ok: false; message: string } {
  const { legal } = config;
  if (resolveLegalPageMode(legal.imprintMode, "internal") === "internal") {
    if (!legal.imprintTitle.trim() || !legal.imprintContent.trim()) {
      return { ok: false, message: "Bitte fülle Überschrift und Inhalt der Impressums-Seite aus." };
    }
  } else if (!isHttpsUrl(legal.imprintUrl)) {
    return { ok: false, message: "Für das externe Impressum ist eine HTTPS-Adresse erforderlich." };
  }
  if (resolveLegalPageMode(legal.privacyMode, "external") === "internal") {
    if (!legal.privacyTitle.trim() || !legal.privacyContent.trim()) {
      return { ok: false, message: "Bitte fülle Überschrift und Inhalt der Datenschutz-Seite aus." };
    }
  } else if (!isHttpsUrl(config.privacyUrl)) {
    return { ok: false, message: "Für den externen Datenschutz ist eine HTTPS-Adresse erforderlich." };
  }
  return { ok: true };
}
