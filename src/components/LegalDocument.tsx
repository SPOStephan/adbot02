import Link from "next/link";

import { SiteBrandMark } from "@/components/SiteBrandMark";
import { SiteFooter } from "@/components/SiteFooter";
import type { LegalPage } from "@/lib/legal/types";
import { MARKETING_SITE_URL } from "@/lib/site-urls";

type Props = {
  page: LegalPage;
};

export async function LegalDocument({ page }: Props) {
  return (
    <main className="flex min-h-screen flex-col bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <SiteBrandMark href={MARKETING_SITE_URL} size="sm" tone="light" />
          <nav className="flex items-center gap-4 text-xs font-bold text-slate-600">
            <Link className="hover:text-slate-950" href="/impressum">
              Impressum
            </Link>
            <Link className="hover:text-slate-950" href="/datenschutz">
              Datenschutz
            </Link>
          </nav>
        </div>
      </header>

      <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:py-14">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {page.title}
        </h1>
        {page.updatedAt ? (
          <p className="mt-3 text-xs font-semibold text-slate-500">
            Zuletzt aktualisiert:{" "}
            {new Intl.DateTimeFormat("de-DE", {
              dateStyle: "long",
              timeStyle: "short",
            }).format(new Date(page.updatedAt))}
          </p>
        ) : null}
        <div className="mt-8 whitespace-pre-wrap text-sm leading-7 text-slate-700 sm:text-base sm:leading-8">
          {page.body}
        </div>
      </article>

      <SiteFooter tone="light" />
    </main>
  );
}
