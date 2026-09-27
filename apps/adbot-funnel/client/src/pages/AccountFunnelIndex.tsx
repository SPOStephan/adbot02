import { FormattedText } from "@/components/funnel/FormattedText";
import type { PublicFunnelListItem } from "@shared/funnelHostResolve";

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
    </main>
  );
}
