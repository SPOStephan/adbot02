import { redirect } from "next/navigation";

import { AdExampleLibraryAdmin } from "@/components/AdExampleLibraryAdmin";
import { loadAdIntelligenceCorpusSummary } from "@/lib/ad-intelligence/corpus";
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

  const [examples, corpus] = await Promise.all([
    loadAdExamples(),
    loadAdIntelligenceCorpusSummary(),
  ]);

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

      {corpus ? (
        <section className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
            Adbot Intelligence · interner Seed-Korpus
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CorpusMetric label="Situationen" value={corpus.records} />
            <CorpusMetric label="Training" value={corpus.trainRecords} />
            <CorpusMetric label="Blind-Evaluation" value={corpus.evalRecords} />
            <CorpusMetric label="Branchen" value={corpus.industries} />
          </div>
          <p className="mt-4 text-sm text-blue-950">
            {Object.entries(corpus.platforms)
              .map(([platform, count]) => `${platform}: ${count}`)
              .join(" · ")}
          </p>
          <p className="mt-2 text-xs text-blue-800">
            {corpus.rightsClean
              ? "Rechtebereinigter synthetischer Seed: keine Kundendaten und keine kopierten Fremdanzeigen."
              : "Korpus-Herkunft prüfen, bevor Training oder Evaluation gestartet wird."}
          </p>
        </section>
      ) : null}

      <div className="mt-8">
        <AdExampleLibraryAdmin initialExamples={examples} />
      </div>
    </>
  );
}

function CorpusMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold text-slate-950">{value}</p>
    </div>
  );
}
