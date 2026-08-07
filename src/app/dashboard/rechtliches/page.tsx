import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Scale } from "lucide-react";

import { LegalPagesEditor } from "@/components/LegalPagesEditor";
import { SignOutButton } from "@/components/SignOutButton";
import { SiteFooter } from "@/components/SiteFooter";
import { getLegalPage } from "@/lib/legal/pages";
import { LEGAL_SLUGS } from "@/lib/legal/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardLegalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/rechtliches");
  }

  const pages = await Promise.all(
    LEGAL_SLUGS.map((slug) => getLegalPage(slug)),
  );

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white">
              <Scale className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Dashboard
              </p>
              <h1 className="text-lg font-extrabold">Rechtliches</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950"
              href="/dashboard"
            >
              <ArrowLeft className="size-3.5" />
              Übersicht
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <LegalPagesEditor pages={pages} />
      </div>

      <SiteFooter tone="light" />
    </main>
  );
}
