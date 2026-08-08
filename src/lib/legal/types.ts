export const LEGAL_SLUGS = ["impressum", "datenschutz", "agb"] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export type LegalPage = {
  slug: LegalSlug;
  title: string;
  body: string;
  source: "database" | "file";
  updatedAt: string | null;
};

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}
