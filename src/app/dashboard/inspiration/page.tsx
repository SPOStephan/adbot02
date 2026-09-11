import { redirect } from "next/navigation";

import { AdExampleLibraryAdmin } from "@/components/AdExampleLibraryAdmin";
import { loadAdExamples } from "@/lib/ad-examples/service";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdExampleLibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/inspiration");
  }
  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const examples = await loadAdExamples();

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Werbebeispielbibliothek
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Reale Anzeigen strukturiert nach Branche, Werbeziel, Funnel-Stufe,
          Plattform und Evidenz erfassen. Die Bibliothek ist intern, für Kunden
          unsichtbar und technisch von Kampagnen-Uploads getrennt.
        </p>
      </div>

      <div className="mt-8">
        <AdExampleLibraryAdmin initialExamples={examples} />
      </div>
    </>
  );
}
