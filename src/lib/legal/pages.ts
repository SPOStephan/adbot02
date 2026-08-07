import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LegalPage, LegalSlug } from "@/lib/legal/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type { LegalPage, LegalSlug };
export { isLegalSlug, LEGAL_SLUGS } from "@/lib/legal/types";

const DEFAULT_TITLES: Record<LegalSlug, string> = {
  impressum: "Impressum",
  datenschutz: "Datenschutzerklärung",
};

async function readFallbackFile(slug: LegalSlug): Promise<string> {
  const filePath = path.join(process.cwd(), "content", "legal", `${slug}.md`);
  return readFile(filePath, "utf8");
}

export async function getLegalPage(slug: LegalSlug): Promise<LegalPage> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("site_legal_pages")
      .select("slug, title, body, updated_at")
      .eq("slug", slug)
      .maybeSingle();

    if (!error && data && typeof data.body === "string" && data.body.trim()) {
      return {
        slug,
        title:
          typeof data.title === "string" && data.title.trim()
            ? data.title.trim()
            : DEFAULT_TITLES[slug],
        body: data.body,
        source: "database",
        updatedAt:
          typeof data.updated_at === "string" ? data.updated_at : null,
      };
    }
  } catch {
    // Table may be absent before migration; fall back to files.
  }

  const body = await readFallbackFile(slug);
  return {
    slug,
    title: DEFAULT_TITLES[slug],
    body,
    source: "file",
    updatedAt: null,
  };
}

export async function saveLegalPage(input: {
  slug: LegalSlug;
  title: string;
  body: string;
  userId: string;
}): Promise<LegalPage> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 120) {
    throw new Error("Titel ungültig (1–120 Zeichen).");
  }
  if (!body || body.length > 200_000) {
    throw new Error("Inhalt ungültig (1–200000 Zeichen).");
  }

  const admin = createAdminClient();
  const updatedAt = new Date().toISOString();
  const { error } = await admin.from("site_legal_pages").upsert(
    {
      slug: input.slug,
      title,
      body,
      updated_at: updatedAt,
      updated_by: input.userId,
    },
    { onConflict: "slug" },
  );

  if (error) {
    throw new Error(
      error.message.includes("site_legal_pages") || error.code === "42P01"
        ? "Tabelle site_legal_pages fehlt — bitte SQL-Migration anwenden."
        : `Speichern fehlgeschlagen: ${error.message}`,
    );
  }

  return {
    slug: input.slug,
    title,
    body,
    source: "database",
    updatedAt,
  };
}
