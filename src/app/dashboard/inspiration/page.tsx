import { redirect } from "next/navigation";

import { AdExampleLibraryAdmin } from "@/components/AdExampleLibraryAdmin";
import { AdLibraryCollectorSandbox } from "@/components/AdLibraryCollectorSandbox";
import { ChatGPTAdLibraryImportPanel } from "@/components/ChatGPTAdLibraryImportPanel";
import { getChatGPTAdLibraryCrawlStatus } from "@/lib/chatgpt-ad-library/crawl-state";
import { CHATGPT_AD_LIBRARY_PAGE_SIZE } from "@/lib/chatgpt-ad-library/import-constants";
import { loadChatGPTAdLibraryPage } from "@/lib/chatgpt-ad-library/retrieval";
import { loadAdIntelligenceCorpusSummary } from "@/lib/ad-intelligence/corpus";
import { EMPTY_COLLECTOR_COUNTS } from "@/lib/ad-library-collector/types";
import { loadCollectorInbox } from "@/lib/ad-library-collector/service";
import { loadAdExamplesPage } from "@/lib/ad-examples/service";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

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

  const [examples, corpus, crawlResult, vaultPage, collectorInbox] = await Promise.all([
    withTimeout(loadAdExamplesPage({ page: 1 }), 12_000, {
      examples: [],
      total: 0,
      page: 1,
      pageSize: 24,
      pageCount: 1,
    }),
    withTimeout(loadAdIntelligenceCorpusSummary(), 12_000, null),
    withTimeout(
      getChatGPTAdLibraryCrawlStatus()
        .then((status) => ({ status, error: null as string | null }))
        .catch((error: unknown) => ({
          status: null,
          error:
            error instanceof Error ? error.message : "Crawl-Status nicht verfügbar.",
        })),
      12_000,
      { status: null, error: "Crawl-Status hat zu lange gedauert." },
    ),
    withTimeout(
      loadChatGPTAdLibraryPage({ limit: CHATGPT_AD_LIBRARY_PAGE_SIZE, offset: 0 }),
      12_000,
      {
        hits: [],
        total: 0,
        offset: 0,
        limit: CHATGPT_AD_LIBRARY_PAGE_SIZE,
      },
    ),
    withTimeout(
      loadCollectorInbox(),
      12_000,
      {
        items: [],
        counts: { ...EMPTY_COLLECTOR_COUNTS },
        lastBatchId: null,
        migrationNeeded: true,
      },
    ),
  ]);
  const importedCount = crawlResult.status?.vaultCount ?? vaultPage.total;

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
          unsichtbar und technisch von Kampagnen-Uploads getrennt. Copy- und
          Creative-Vorschläge ziehen passende Muster plus First-Party-Winner
          aus diesem Korpus — ohne fremde Anzeigen zu kopieren oder deren
          Sichtbarkeit als Erfolg zu werten.
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

      <div className="mt-8 space-y-8">
        <AdLibraryCollectorSandbox initialInbox={collectorInbox} />
        <ChatGPTAdLibraryImportPanel
          initialCrawl={crawlResult.status}
          initialCrawlError={crawlResult.error}
          initialHits={vaultPage.hits}
          initialHitsTotal={vaultPage.total}
          initialImportedCount={importedCount}
        />
        <AdExampleLibraryAdmin
          initialExamples={examples.examples}
          initialTotal={examples.total}
          initialPage={examples.page}
          initialPageCount={examples.pageCount}
        />
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
