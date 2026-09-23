import Link from "next/link";
import { ExternalLink, Filter } from "lucide-react";

import { FUNNEL_SITE_URL, createFunnelSsoEntryPath } from "@/lib/site-urls";

type FunnelWorkspaceCardProps = {
  userEmail?: string | null;
  adminHostname?: string | null;
};

export function FunnelWorkspaceCard({
  userEmail,
  adminHostname = null,
}: FunnelWorkspaceCardProps) {
  const ssoUrl = createFunnelSsoEntryPath(
    adminHostname ? "/admin/applications" : "/admin",
  );
  const adminHost = adminHostname || FUNNEL_SITE_URL.replace(/^https?:\/\//, "");

  return (
    <section
      aria-labelledby="funnel-workspace-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
      id="funnel"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <Filter className="size-5" aria-hidden="true" />
            </span>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
              Funnel
            </p>
          </div>
          <h2
            className="text-2xl font-extrabold tracking-tight text-slate-950"
            id="funnel-workspace-title"
          >
            Lead- und Bewerbungsfunnel verwalten
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {adminHostname ? (
              <>
                Funnel und Bewerbungsübersicht laufen unter{" "}
                <span className="font-semibold text-slate-800">{adminHost}</span>
                . Du wirst mit deinem Adbot-Konto angemeldet und landest auf der
                Inbox dieser Domain
              </>
            ) : (
              <>
                Solange keine eigene Domain READY und an einen Funnel gebunden
                ist, öffnet der Admin unter{" "}
                <span className="font-semibold text-slate-800">{adminHost}</span>
                . Mit eigener Domain liegen Übersicht und Verwaltung dort
              </>
            )}
            {userEmail ? (
              <>
                {" "}
                (<span className="font-medium text-slate-800">{userEmail}</span>)
              </>
            ) : null}
            .
          </p>

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>
              <Link
                className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                href="/dashboard/tracking"
              >
                Meta Pixel global unter Tracking verbinden
              </Link>{" "}
              — Funnel übernimmt die ID soft, wenn das Feld dort leer ist.
            </li>
            <li>
              <Link
                className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                href="/dashboard/domains"
              >
                Custom Domain global unter Domains verbinden
              </Link>{" "}
              — dann beim Lead-Launch als Ziel-URL wählbar.
            </li>
            <li>
              <Link
                className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                href="/dashboard/hilfe"
              >
                Einfache Anleitung für Pixel, Domain und Lead-Bewertung
              </Link>{" "}
              — inklusive Gut/Schlecht zurück an Meta.
            </li>
          </ol>
        </div>
        <a
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          href={ssoUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Funnel öffnen
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
