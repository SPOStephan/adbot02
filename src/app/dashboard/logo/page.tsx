import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Images } from "lucide-react";

import { SignOutButton } from "@/components/SignOutButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteLogoEditor } from "@/components/SiteLogoEditor";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getSiteBranding } from "@/lib/site-branding/branding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardLogoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/logo");
  }

  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const branding = await getSiteBranding();

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white">
              <Images className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Dashboard · Admin
              </p>
              <h1 className="text-lg font-extrabold">Logo</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950"
              href="/dashboard/rechtliches"
            >
              Rechtliches
            </Link>
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
        <SiteLogoEditor branding={branding} />
      </div>

      <SiteFooter tone="light" />
    </main>
  );
}
