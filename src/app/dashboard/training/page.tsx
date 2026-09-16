import { redirect } from "next/navigation";

import { AdbotTrainingGround } from "@/components/AdbotTrainingGround";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { loadTrainingInbox } from "@/lib/ad-training/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdbotTrainingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/training");
  }
  if (!(await isSiteAdmin(user.id))) {
    redirect("/dashboard");
  }

  const inbox = await loadTrainingInbox().catch(() => ({
    runs: [],
    ratedCount: 0,
    keepCount: 0,
    rejectCount: 0,
    migrationNeeded: true,
    imageGenerationConfigured: false,
  }));

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Admin
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          KI-Training
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Trainingsgelände: beliebige HTTPS-URL, Adbot gestaltet eine Anzeige,
          du bewertest. Jede Bewertung macht den nächsten Vorschlag schlauer.
        </p>
      </div>
      <div className="mt-8">
        <AdbotTrainingGround initialInbox={inbox} />
      </div>
    </>
  );
}
