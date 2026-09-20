import Link from "next/link";

import { SiteBrandMark } from "@/components/SiteBrandMark";
import { denialMessage, type KireadyAccessReason } from "@/lib/kiready/policy";
import { kireadyPortalUrl } from "@/lib/kiready/public";
import { MARKETING_SITE_URL } from "@/lib/site-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ reason?: string }>;
};

const REASONS: KireadyAccessReason[] = [
  "no_personal_use",
  "no_company_access",
  "canceled",
  "expired",
  "past_due",
];

export default async function KireadyDeniedPage({ searchParams }: PageProps) {
  const { reason } = await searchParams;
  const typed = REASONS.includes(reason as KireadyAccessReason)
    ? (reason as KireadyAccessReason)
    : "no_company_access";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
        <SiteBrandMark href={MARKETING_SITE_URL} tone="dark" />
        <h1 className="mt-10 text-3xl font-extrabold tracking-tight">Kein Adbot-Zugang</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">{denialMessage(typed)}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white hover:bg-blue-700"
            href={kireadyPortalUrl()}
          >
            KIready öffnen
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-600 px-5 py-3 text-sm font-extrabold text-slate-100 hover:bg-slate-900"
            href="/login"
          >
            Zur Anmeldung
          </Link>
        </div>
      </div>
    </main>
  );
}
