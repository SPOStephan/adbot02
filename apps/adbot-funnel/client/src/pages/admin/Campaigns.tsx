import { accountFunnelPath, preferredPublicFunnelUrl } from "@shared/funnelHostResolve";
import { Archive, Globe2, Loader2, Megaphone, MoreHorizontal, PlayCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import type { PortalCampaignAdCard, PortalFunnelCampaign } from "@shared/portalCampaigns";

type KindFilter = "all" | "lead" | "traffic";
type Lifecycle = "active" | "archived";

const KIND_LABELS: Record<"lead" | "traffic", string> = {
  lead: "Lead / Funnel",
  traffic: "Traffic",
};

const KIND_BADGE: Record<"lead" | "traffic", string> = {
  lead: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  traffic: "bg-blue-50 text-blue-800 ring-blue-200",
};

function formatMoney(value: number | null, currency: string) {
  if (value === null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("de-DE").format(value);
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : null;
}

function budgetLabel(campaign: PortalFunnelCampaign) {
  if (campaign.dailyBudgetMinor !== null) return `${formatMoney(campaign.dailyBudgetMinor / 100, campaign.currency)} pro Tag`;
  if (campaign.lifetimeBudgetMinor !== null) return `${formatMoney(campaign.lifetimeBudgetMinor / 100, campaign.currency)} gesamt`;
  return "Budget auf Anzeigengruppen-Ebene";
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "AD").toUpperCase();
}

export default function Campaigns() {
  const funnelsQuery = trpc.funnel.funnels.useQuery();
  const accountDomainsQuery = trpc.funnel.accountDomains.useQuery();
  const readyAccountHostname = (accountDomainsQuery.data ?? []).find(domain => domain.status === "READY")?.hostname ?? null;

  // Every public URL a funnel can be reached under, mapped to its title.
  const funnelTitleByUrl = useMemo(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const map = new Map<string, string>();
    for (const funnel of funnelsQuery.data ?? []) {
      const urls = [
        preferredPublicFunnelUrl({ slug: funnel.slug, readyAccountHostname, fallbackOrigin: origin }),
        `${origin.replace(/\/+$/, "")}${accountFunnelPath(funnel.slug)}`,
      ];
      for (const url of urls) if (url && !map.has(url)) map.set(url, funnel.title);
    }
    return map;
  }, [funnelsQuery.data, readyAccountHostname]);

  const overviewQuery = trpc.funnel.campaignOverview.useQuery(
    { funnelUrls: Array.from(funnelTitleByUrl.keys()).filter(url => /^https:\/\//.test(url)) },
    { enabled: funnelTitleByUrl.size > 0 },
  );

  const [lifecycle, setLifecycle] = useState<Lifecycle>("active");
  const [kind, setKind] = useState<KindFilter>("all");
  const [funnelFilter, setFunnelFilter] = useState<string>("all");

  const campaigns = overviewQuery.data?.campaigns ?? [];
  const advertiserName = overviewQuery.data?.advertiserName ?? "Deine Facebook-Seite";
  const funnelTitles = useMemo(
    () => Array.from(new Set(campaigns.map(campaign => funnelTitleByUrl.get(campaign.funnelUrl) ?? campaign.funnelUrl))).sort(),
    [campaigns, funnelTitleByUrl],
  );
  const inLifecycle = campaigns.filter(campaign => campaign.lifecycle === lifecycle);
  const inFunnel = funnelFilter === "all"
    ? inLifecycle
    : inLifecycle.filter(campaign => (funnelTitleByUrl.get(campaign.funnelUrl) ?? campaign.funnelUrl) === funnelFilter);
  const visible = kind === "all" ? inFunnel : inFunnel.filter(campaign => campaign.kind === kind);
  const lifecycleCount = (value: Lifecycle) => campaigns.filter(campaign => campaign.lifecycle === value).length;
  const kindCount = (value: KindFilter) => value === "all" ? inFunnel.length : inFunnel.filter(campaign => campaign.kind === value).length;
  const loading = funnelsQuery.isLoading || overviewQuery.isLoading;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-2 sm:p-4">
      <header>
        <p className="text-xs font-bold uppercase tracking-[.15em] text-[#0165c3]">Funnel-Bewerbung</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Kampagnen</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Alle Meta-Kampagnen, die deine Funnels bewerben, mit ihren Anzeigen. Pausierte und beendete Kampagnen findest du im Archiv.</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {([["active", "Aktiv", PlayCircle], ["archived", "Archiv", Archive]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" role="tab" aria-selected={lifecycle === value} onClick={() => setLifecycle(value)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition ${lifecycle === value ? "bg-[#10253f] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              <Icon className="size-4" aria-hidden="true" />{label} ({lifecycleCount(value)})
            </button>
          ))}
        </div>
        {funnelTitles.length > 1 ? (
          <Select value={funnelFilter} onValueChange={setFunnelFilter}>
            <SelectTrigger className="w-64" aria-label="Nach Funnel filtern"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Funnels</SelectItem>
              {funnelTitles.map(title => <SelectItem key={title} value={title}>{title}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Nach Kampagnentyp filtern">
        {(["all", "lead", "traffic"] as const).map(value => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition ${kind === value ? "bg-[#0165c3] text-white ring-[#0165c3]" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>
            {value === "all" ? "Alle" : KIND_LABELS[value]} ({kindCount(value)})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid min-h-40 place-items-center rounded-xl border bg-white" role="status"><span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Kampagnen werden geladen …</span></div>
      ) : overviewQuery.data && !overviewQuery.data.available ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Die Kampagnen konnten gerade nicht geladen werden. Bitte lade die Seite gleich noch einmal.</div>
      ) : visible.length === 0 ? (
        <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
          <div>
            <Megaphone className="mx-auto size-6 text-slate-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-bold text-slate-900">{lifecycle === "active" ? "Keine aktive Kampagne in dieser Auswahl" : "Keine archivierte Kampagne in dieser Auswahl"}</p>
            <p className="mt-1 text-sm text-slate-500">Sobald ein Funnel beworben wird, erscheint die Kampagne hier.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((campaign, index) => (
            <CampaignCard key={campaign.id} campaign={campaign} advertiserName={advertiserName} funnelTitle={funnelTitleByUrl.get(campaign.funnelUrl) ?? null} defaultOpen={index === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCard({ campaign, advertiserName, funnelTitle, defaultOpen }: { campaign: PortalFunnelCampaign; advertiserName: string; funnelTitle: string | null; defaultOpen: boolean }) {
  const since = formatDate(campaign.startTime);
  const until = formatDate(campaign.stopTime);
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/60" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${KIND_BADGE[campaign.kind]}`}>{KIND_LABELS[campaign.kind]}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${campaign.lifecycle === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>{campaign.statusLabel}</span>
            {funnelTitle ? <span className="text-xs font-semibold text-slate-500">Funnel: {funnelTitle}</span> : null}
          </div>
          <h2 className="mt-2 truncate text-base font-bold text-[#10253f]">{campaign.displayName}</h2>
          <p className="mt-1 text-xs text-slate-500">{budgetLabel(campaign)}{since ? ` · seit ${since}` : ""}{until ? ` · bis ${until}` : ""}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs sm:grid-cols-4">
          <div><dt className="font-semibold text-slate-500">Ausgaben 30 T.</dt><dd className="font-bold text-slate-900">{formatMoney(campaign.spend, campaign.currency)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Impressionen</dt><dd className="font-bold text-slate-900">{formatNumber(campaign.impressions)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Link-Klicks</dt><dd className="font-bold text-slate-900">{formatNumber(campaign.linkClicks)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Leads</dt><dd className="font-bold text-slate-900">{formatNumber(campaign.leads)}</dd></div>
        </dl>
      </summary>
      <div className="border-t border-slate-200 bg-white p-4">
        {campaign.cards.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">Für diese Kampagne liegen noch keine Anzeigendaten vor. Sie erscheinen nach dem nächsten Abruf von Meta.</p>
        ) : (
          <>
            <p className="mb-3 text-xs leading-5 text-slate-500">
              {campaign.previewMode === "dynamic"
                ? `Meta kombiniert die gewählten Varianten dynamisch. ${campaign.isTruncated ? `Gezeigt werden ${campaign.cards.length} von ${campaign.totalCombinationCount} möglichen Kombinationen.` : ""}`
                : "So erscheinen die Anzeigen dieser Kampagne bei Meta. Die Darstellung kann je nach Platzierung leicht abweichen."}
            </p>
            <div className="grid items-start gap-5 xl:grid-cols-2 2xl:grid-cols-3">
              {campaign.cards.map(card => <AdCard key={card.key} card={card} advertiserName={advertiserName} />)}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function AdCard({ card, advertiserName }: { card: PortalCampaignAdCard; advertiserName: string }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{card.previewLabel}</p>
        <p className="text-xs font-semibold text-slate-500">Facebook-Feed</p>
      </div>
      <div className="flex items-start gap-3 px-4 pb-2 pt-4">
        <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-black text-white">{initials(advertiserName)}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-950">{advertiserName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">Gesponsert <span aria-hidden="true">·</span> <Globe2 aria-label="Öffentlich" className="size-3.5" /></p>
        </div>
        <MoreHorizontal aria-hidden="true" className="mt-1 size-5 text-slate-600" />
      </div>
      {card.primaryText ? <p className="whitespace-pre-wrap px-4 pb-4 pt-2 text-[15px] leading-6 text-slate-900">{card.primaryText}</p> : null}
      <div className="flex min-h-64 max-h-[430px] items-center justify-center overflow-hidden bg-slate-950">
        {card.imageUrl ? (
          <img alt={`Motiv in ${card.previewLabel}`} className="max-h-[430px] w-full object-contain" loading="lazy" referrerPolicy="no-referrer" src={card.imageUrl} />
        ) : (
          <p className="px-6 text-center text-sm font-semibold text-slate-300">Kein Motiv verfügbar</p>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
        <div className="min-w-0 flex-1">
          {card.destinationUrl ? <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-500">{hostname(card.destinationUrl)}</p> : null}
          {card.headline ? <h3 className="mt-0.5 line-clamp-2 text-base font-bold leading-5 text-slate-950">{card.headline}</h3> : null}
          {card.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{card.description}</p> : null}
        </div>
        <span className="shrink-0 rounded-md bg-slate-200 px-3 py-2 text-xs font-bold text-slate-800">{card.callToActionLabel}</span>
      </div>
    </article>
  );
}
