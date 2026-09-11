import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardPageHeader } from "@/components/DashboardPageHeader";
import { getPublishedOpenAIAdsGuide } from "@/lib/openai-ads/guide";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OpenAIAdsGuidePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/chatgpt-ads/anleitung");
  }

  const guide = await getPublishedOpenAIAdsGuide();
  if (!guide) {
    redirect("/dashboard/chatgpt-ads");
  }

  return (
    <>
      <DashboardPageHeader
        description="So erzeugst du im OpenAI Ads Manager einen accountgebundenen API-Key und verbindest das Werbekonto sicher mit Adbot."
        eyebrow="Schritt-für-Schritt"
        title="ChatGPT Ads verbinden"
      />

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 hover:border-blue-300 hover:text-blue-700"
          href="/dashboard/chatgpt-ads"
        >
          <ArrowLeft className="size-4" />
          Zurück zur Verbindung
        </Link>
        <a
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-blue-700"
          href="https://ads.openai.com"
          rel="noreferrer"
          target="_blank"
        >
          OpenAI Ads Manager öffnen
          <ExternalLink className="size-4" />
        </a>
      </div>

      <section className="mt-8 space-y-6">
        {guide.steps.map((step, index) => (
          <article
            className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            key={step.id}
          >
            <div className="border-b border-blue-100 bg-blue-50 px-5 py-5 sm:px-7">
              <div className="flex items-start gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-black text-white">
                  {index + 1}
                </span>
                <div>
                  <h2 className="text-xl font-black text-slate-950">{step.title}</h2>
                  {step.description ? (
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                      {step.description}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="bg-slate-100 p-3 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`Anleitungsschritt ${index + 1}: ${step.title}`}
                className="mx-auto h-auto max-h-[75vh] w-auto max-w-full rounded-xl border border-slate-200 bg-white object-contain shadow-sm"
                height={step.height}
                loading={index === 0 ? "eager" : "lazy"}
                src={step.imageUrl}
                width={step.width}
              />
            </div>
          </article>
        ))}
      </section>

      <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
        <p className="font-extrabold">Wichtig</p>
        <p className="mt-1">
          Kopiere nur den Ads-API-Key in Adbot. Teile ihn nicht per E-Mail und
          veröffentliche ihn nicht in Screenshots. Adbot prüft den Key serverseitig
          und speichert ihn verschlüsselt.
        </p>
      </div>
    </>
  );
}
