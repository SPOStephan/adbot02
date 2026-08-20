import { redirect } from "next/navigation";

import { LegalPagesEditor } from "@/components/LegalPagesEditor";
import { isSiteAdmin } from "@/lib/auth/site-admin";
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

  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const pages = await Promise.all(
    LEGAL_SLUGS.map((slug) => getLegalPage(slug)),
  );

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Rechtliches
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Impressum, Datenschutz und weitere rechtliche Seiten bearbeiten.
        </p>
      </div>

      <div className="mt-8">
        <LegalPagesEditor pages={pages} />
      </div>
    </>
  );
}
