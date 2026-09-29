"use client";

import { useMemo, useState } from "react";
import { Archive, Megaphone, PlayCircle } from "lucide-react";

import { MetaAdPreviewGallery } from "@/components/MetaAdPreviewGallery";
import {
  CAMPAIGN_KIND_LABELS,
  CAMPAIGN_KIND_ORDER,
  type CampaignAdOverviewItem,
  type CampaignKind,
  type CampaignLifecycle,
} from "@/lib/meta/campaign-ad-overview";

type KindFilter = CampaignKind | "all";

type Props = {
  items: readonly CampaignAdOverviewItem[];
  advertiserName: string;
  loadError?: boolean;
  initialKind?: string | null;
  initialLifecycle?: string | null;
};

const KIND_BADGE: Record<CampaignKind, string> = {
  lead: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  traffic: "bg-blue-50 text-blue-800 ring-blue-200",
  boost: "bg-violet-50 text-violet-800 ring-violet-200",
  other: "bg-slate-100 text-slate-700 ring-slate-200",
};

const KIND_PARAM: Record<CampaignKind, string> = {
  lead: "lead",
  traffic: "traffic",
  boost: "beitrag-push",
  other: "sonstige",
};

function kindFromParam(value: string | null | undefined): KindFilter {
  const match = CAMPAIGN_KIND_ORDER.find((kind) => KIND_PARAM[kind] === value);
  return match ?? "all";
}

function formatMoney(value: number | null, currency: string) {
  if (value === null) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("de-DE").format(value);
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function budgetLabel(item: CampaignAdOverviewItem) {
  if (item.dailyBudgetMinor !== null) {
    return `${formatMoney(item.dailyBudgetMinor / 100, item.currency)} pro Tag`;
  }
  if (item.lifetimeBudgetMinor !== null) {
    return `${formatMoney(item.lifetimeBudgetMinor / 100, item.currency)} gesamt`;
  }
  return "Budget auf Anzeigengruppen-Ebene";
}

function syncUrl(kind: KindFilter, lifecycle: CampaignLifecycle) {
  try {
    const url = new URL(window.location.href);
    if (kind === "all") url.searchParams.delete("typ");
    else url.searchParams.set("typ", KIND_PARAM[kind]);
    if (lifecycle === "active") url.searchParams.delete("ansicht");
    else url.searchParams.set("ansicht", "archiv");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // URL sync is a convenience only.
  }
}

export function CampaignAdOverview({
  items,
  advertiserName,
  loadError = false,
  initialKind,
  initialLifecycle,
}: Props) {
  const [kind, setKind] = useState<KindFilter>(() => kindFromParam(initialKind));
  const [lifecycle, setLifecycle] = useState<CampaignLifecycle>(
    initialLifecycle === "archiv" ? "archived" : "active",
  );

  const lifecycleCounts = useMemo(
    () => ({
      active: items.filter((item) => item.lifecycle === "active").length,
      archived: items.filter((item) => item.lifecycle === "archived").length,
    }),
    [items],
  );
  const inLifecycle = useMemo(
    () => items.filter((item) => item.lifecycle === lifecycle),
    [items, lifecycle],
  );
  const kindCounts = useMemo(() => {
    const counts = new Map<CampaignKind, number>();
    for (const item of inLifecycle) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    return counts;
  }, [inLifecycle]);
  const visible =
    kind === "all" ? inLifecycle : inLifecycle.filter((item) => item.kind === kind);

  const chooseKind = (next: KindFilter) => {
    setKind(next);
    syncUrl(next, lifecycle);
  };
  const chooseLifecycle = (next: CampaignLifecycle) => {
    setLifecycle(next);
    syncUrl(kind, next);
  };

  return (
    <section
      aria-labelledby="campaign-ad-overview-title"
      className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      id="laufende-anzeigen"
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
        Kampagnen bei Meta
      </p>
      <h2
        className="mt-2 text-xl font-extrabold tracking-tight"
        id="campaign-ad-overview-title"
      >
        Laufende Anzeigen
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
        Alle Kampagnen mit ihren Anzeigen, so wie sie bei Meta erscheinen. Pausierte
        und beendete Kampagnen findest du im Archiv.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2" role="tablist">
        {(
          [
            ["active", "Aktiv", PlayCircle],
            ["archived", "Archiv", Archive],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            aria-selected={lifecycle === value}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition ${
              lifecycle === value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            key={value}
            onClick={() => chooseLifecycle(value)}
            role="tab"
            type="button"
          >
            <Icon className="size-4" />
            {label} ({lifecycleCounts[value]})
          </button>
        ))}
      </div>

      <div aria-label="Nach Kampagnentyp filtern" className="mt-3 flex flex-wrap gap-2">
        {(["all", ...CAMPAIGN_KIND_ORDER] as const).map((value) => {
          const count =
            value === "all" ? inLifecycle.length : (kindCounts.get(value) ?? 0);
          const selected = kind === value;
          return (
            <button
              aria-pressed={selected}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition ${
                selected
                  ? "bg-blue-600 text-white ring-blue-600"
                  : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
              }`}
              key={value}
              onClick={() => chooseKind(value)}
              type="button"
            >
              {value === "all" ? "Alle" : CAMPAIGN_KIND_LABELS[value]} ({count})
            </button>
          );
        })}
      </div>

      {loadError ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Die Anzeigen konnten gerade nicht geladen werden. Bitte lade die Seite gleich
          noch einmal.
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-5 grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
          <div>
            <Megaphone className="mx-auto size-6 text-slate-400" />
            <p className="mt-2 text-sm font-bold text-slate-900">
              {lifecycle === "active"
                ? "Keine aktive Kampagne in dieser Auswahl"
                : "Keine archivierte Kampagne in dieser Auswahl"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Neue Kampagnen erscheinen hier nach dem nächsten Abruf von Meta.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {visible.map((item, index) => (
            <CampaignAdOverviewCard
              advertiserName={advertiserName}
              defaultOpen={index === 0}
              item={item}
              key={item.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function CampaignAdOverviewCard({
  item,
  advertiserName,
  defaultOpen,
}: {
  item: CampaignAdOverviewItem;
  advertiserName: string;
  defaultOpen: boolean;
}) {
  const since = formatDate(item.startTime);
  const until = formatDate(item.stopTime);
  return (
    <details
      className="group rounded-xl border border-slate-200 bg-slate-50/60"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${KIND_BADGE[item.kind]}`}
            >
              {CAMPAIGN_KIND_LABELS[item.kind]}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
                item.lifecycle === "active"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-slate-100 text-slate-600 ring-slate-200"
              }`}
            >
              {item.statusLabel}
            </span>
            <span className="text-xs font-semibold text-slate-500">
              {item.launchedByAdbot ? "Von Adbot gestartet" : "Außerhalb von Adbot angelegt"}
            </span>
          </div>
          <h3 className="mt-2 truncate text-base font-extrabold text-slate-950">
            {item.displayName}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {budgetLabel(item)}
            {since ? ` · seit ${since}` : ""}
            {until ? ` · bis ${until}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs sm:grid-cols-4">
          <div>
            <dt className="font-semibold text-slate-500">Ausgaben 30 T.</dt>
            <dd className="font-extrabold text-slate-900">
              {formatMoney(item.spend, item.currency)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Impressionen</dt>
            <dd className="font-extrabold text-slate-900">{formatNumber(item.impressions)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Link-Klicks</dt>
            <dd className="font-extrabold text-slate-900">{formatNumber(item.linkClicks)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Leads</dt>
            <dd className="font-extrabold text-slate-900">{formatNumber(item.leads)}</dd>
          </div>
        </dl>
      </summary>
      <div className="border-t border-slate-200 bg-white p-4">
        {item.destinationUrl ? (
          <p className="mb-3 break-all text-xs font-medium text-blue-700">
            Zielseite: {item.destinationUrl}
            {item.variantDestinationUrl ? ` · Variante: ${item.variantDestinationUrl}` : ""}
          </p>
        ) : null}
        {item.cards.length > 0 && item.previewMode !== "none" ? (
          <MetaAdPreviewGallery
            advertiserName={advertiserName}
            assets={[]}
            callToActionLabel="Mehr erfahren"
            cards={item.cards}
            context="live"
            isTruncated={item.isTruncated}
            mode={item.previewMode}
            totalCombinationCount={item.totalCombinationCount}
          />
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
            Für diese Kampagne liegen noch keine Anzeigendaten vor. Sie erscheinen nach dem
            nächsten Abruf von Meta.
          </p>
        )}
      </div>
    </details>
  );
}
