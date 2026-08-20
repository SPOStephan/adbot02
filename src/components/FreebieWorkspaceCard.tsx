import Link from "next/link";
import { ExternalLink, Gift } from "lucide-react";

import { FREEBIE_SITE_URL, createFreebieSsoEntryPath } from "@/lib/site-urls";

type FreebieWorkspaceCardProps = {
  userEmail?: string | null;
};

export function FreebieWorkspaceCard({ userEmail }: FreebieWorkspaceCardProps) {
  const ssoUrl = createFreebieSsoEntryPath();

  return (
    <section
      aria-labelledby="freebie-workspace-title"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
      id="freebie"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <Gift className="size-5" aria-hidden="true" />
            </span>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Freebie
            </p>
          </div>
          <h2
            className="text-2xl font-extrabold tracking-tight text-slate-950"
            id="freebie-workspace-title"
          >
            Lead-Magnete mit DOI oder OTP
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Der Freebie-Builder läuft unter{" "}
            <span className="font-semibold text-slate-800">
              {FREEBIE_SITE_URL.replace(/^https?:\/\//, "")}
            </span>
            . Du wirst automatisch mit deinem Adbot-Konto angemeldet und siehst
            nur deine eigenen Freebies
            {userEmail ? (
              <>
                {" "}
                (<span className="font-medium text-slate-800">{userEmail}</span>)
              </>
            ) : null}
            . Dateien liegen auf Bunny CDN.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Meta Pixel zuerst{" "}
            <Link
              className="font-semibold text-emerald-800 underline-offset-2 hover:underline"
              href="/dashboard/tracking"
            >
              global unter Tracking
            </Link>{" "}
            verbinden — Freebie übernimmt die ID soft, wenn das Tracking-Feld
            leer ist.
          </p>
        </div>
        <a
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
          href={ssoUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Freebie öffnen
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
