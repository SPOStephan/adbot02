/** Branding für das Kunden-Dashboard: "<Firma> Funnel" plus Logo aus den Funnels des Kontos. */
export type AccountBranding = {
  /** Angezeigter Kurzname ("Boncred"), steht im Dashboard-Kopf vor "Funnel". */
  companyName: string | null;
  /** Vollständiger Firmenname inkl. Rechtsform, falls im Konto hinterlegt. */
  legalName: string | null;
  logoUrl: string | null;
  logoAlt: string;
};

export const DEFAULT_DASHBOARD_TITLE = "Adbot Funnel";

/** Postfach-Anbieter, deren Domain nichts über die Firma aussagt. */
const GENERIC_MAIL_DOMAINS = new Set([
  "gmail", "googlemail", "gmx", "web", "t-online", "outlook", "hotmail", "live", "msn",
  "yahoo", "icloud", "me", "mac", "aol", "freenet", "posteo", "mailbox", "protonmail",
  "proton", "arcor", "online", "example",
]);

const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "or", "ac", "gv", "net", "org"]);

const GENERIC_LOGO_ALTS = new Set(["unternehmenslogo", "logo", "firmenlogo", "logo-vorschau"]);

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("de-DE") + value.slice(1);
}

/** "adbot@boncred.info" → "Boncred"; Freemail-Adressen liefern null. */
export function companyNameFromEmail(email: string | null | undefined): string | null {
  const domain = email?.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  let index = labels.length - 2;
  if (labels.length >= 3 && SECOND_LEVEL_SUFFIXES.has(labels[index])) index -= 1;
  const label = labels[index];
  if (!label || GENERIC_MAIL_DOMAINS.has(label)) return null;
  return capitalize(label);
}

/** "Boncred Logo" / "Logo der Boncred GmbH" → Firmenname; Platzhalter-Texte liefern null. */
export function companyNameFromLogoAlt(logoAlt: string | null | undefined): string | null {
  const trimmed = logoAlt?.trim() ?? "";
  if (!trimmed || GENERIC_LOGO_ALTS.has(trimmed.toLowerCase())) return null;
  const cleaned = trimmed
    .replace(/^(unternehmens|firmen)?logo(\s+(der|des|von))?\s+/i, "")
    .replace(/\s+(unternehmens|firmen)?logo$/i, "")
    .trim();
  if (!cleaned || GENERIC_LOGO_ALTS.has(cleaned.toLowerCase())) return null;
  return cleaned;
}

/** Reihenfolge: hinterlegter Kurzname, hinterlegter Firmenname, Konto-Domain, Logo-Alternativtext. */
export function deriveCompanyName(input: {
  displayName?: string | null;
  companyName?: string | null;
  email?: string | null;
  logoAlt?: string | null;
}): string | null {
  return input.displayName?.trim()
    || input.companyName?.trim()
    || companyNameFromEmail(input.email)
    || companyNameFromLogoAlt(input.logoAlt);
}

export function dashboardTitle(companyName: string | null | undefined): string {
  const name = companyName?.trim();
  return name ? `${name} Funnel` : DEFAULT_DASHBOARD_TITLE;
}
