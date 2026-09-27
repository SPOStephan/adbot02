import { FormattedText } from "@/components/funnel/FormattedText";
import type { PublicFunnelListItem } from "@shared/funnelHostResolve";

function AccountLegalFooter() {
  return (
    <p className="mt-10 text-xs text-slate-500">
      <a className="underline-offset-2 hover:underline" href="/impressum">Impressum</a>
      {" · "}
      <a className="underline-offset-2 hover:underline" href="/datenschutz">Datenschutz</a>
    </p>
  );
}

export function AccountFunnelIndex({
  hostname,
  funnels,
}: {
  hostname: string;
  funnels: PublicFunnelListItem[];
}) {
  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-xl px-5 py-12">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0165c3]">Stellen</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#10253f]">Offene Wege</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Jede Stelle hat eine eigene Adresse unter <code>/{`f`}/…</code> auf{" "}
        <strong>{hostname}</strong>.
      </p>
      {funnels.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">
          Noch keine veröffentlichten Funnel auf dieser Domain.
        </p>
      ) : (
        <ul className="mt-8 grid gap-3">
          {funnels.map(funnel => (
            <li key={funnel.slug}>
              <a
                className="block rounded-2xl border bg-white px-4 py-4 shadow-sm transition hover:border-[#0165c3]/40"
                href={`/f/${funnel.slug}`}
              >
                <FormattedText as="strong" className="block text-base text-[#10253f]" value={funnel.title} />
                <span className="mt-1 block font-mono text-xs text-slate-500">/f/{funnel.slug}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <AccountLegalFooter />
    </main>
  );
}

export function AccountHostLegal({
  kind,
  hostname,
  funnels,
}: {
  kind: "imprint" | "privacy";
  hostname: string;
  funnels: PublicFunnelListItem[];
}) {
  const title = kind === "imprint" ? "Impressum" : "Datenschutz";
  const path = kind === "imprint" ? "impressum" : "datenschutz";
  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-xl px-5 py-12">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0165c3]">{hostname}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#10253f]">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {title} steht bei jeder Stelle im jeweiligen Funnel — nicht einmal für die ganze Domain.
      </p>
      {funnels.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">
          Noch keine veröffentlichten Funnel auf dieser Domain.
        </p>
      ) : (
        <ul className="mt-8 grid gap-3">
          {funnels.map(funnel => (
            <li key={funnel.slug}>
              <a
                className="block rounded-2xl border bg-white px-4 py-4 shadow-sm transition hover:border-[#0165c3]/40"
                href={`/f/${funnel.slug}/${path}`}
              >
                <FormattedText as="strong" className="block text-base text-[#10253f]" value={funnel.title} />
                <span className="mt-1 block font-mono text-xs text-slate-500">/f/{funnel.slug}/{path}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-10 text-xs text-slate-500">
        <a className="underline-offset-2 hover:underline" href="/">Alle Stellen</a>
      </p>
    </main>
  );
}
