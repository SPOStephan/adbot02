import Link from "next/link";
import { ExternalLink, Filter } from "lucide-react";

import { FUNNEL_SITE_URL, createFunnelSsoEntryPath } from "@/lib/site-urls";

type FunnelWorkspaceCardProps = {
  userEmail?: string | null;
};

export function FunnelWorkspaceCard({ userEmail }: FunnelWorkspaceCardProps) {
  const ssoUrl = createFunnelSsoEntryPath();

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
            Der Funnel-Builder läuft unter{" "}
            <span className="font-semibold text-slate-800">
              {FUNNEL_SITE_URL.replace(/^https?:\/\//, "")}
            </span>
            . Du wirst automatisch mit deinem Adbot-Konto angemeldet und siehst
            nur deine eigenen Funnel
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
                href="/dashboard/traffic-launch#meta-pixel"
              >
                Meta Pixel im Portal bestätigen
              </Link>{" "}
              (Traffic-Launch) — die ID wandert soft in den Funnel, wenn dort
              noch keine andere steht.
            </li>
            <li>
              Funnel öffnen → gewünschten Funnel →{" "}
              <span className="font-semibold text-slate-800">Einstellungen</span>
              : CAPI-Token setzen und{" "}
              <span className="font-semibold text-slate-800">Custom Domain</span>{" "}
              registrieren / DNS prüfen.
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
