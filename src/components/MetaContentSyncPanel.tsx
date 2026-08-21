"use client";

import {
  CalendarClock,
  Camera,
  Clock3,
  ExternalLink,
  Megaphone,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ContentCandidateBoostControls,
  type ContentBoostOverrideView,
  type HeldOrganicBoostPlanView,
} from "@/components/ContentCandidateBoostControls";
import { ContentCandidatePreview } from "@/components/ContentCandidatePreview";
import {
  MetaConnectedAssets,
  type MetaConnectedAssetView,
} from "@/components/MetaConnectedAssets";
import { MetaSyncButton } from "@/components/MetaSyncButton";
import { OrganicBoostAutoPlanner } from "@/components/OrganicBoostAutoPlanner";
import { shouldListAsContentCandidate } from "@/lib/meta/content-candidate-lifecycle";
import {
  isDetectionInWindow,
  type ContentDetectionSourceCounts,
} from "@/lib/meta/content-detection-history";
import type {
  ContentAssetSyncHint,
  ContentDetectionHistoryItem,
  ContentSyncCandidate,
} from "@/lib/meta/content-sync-snapshot";
import { resolveCustomerNextSyncAt } from "@/lib/meta/schedule";

type PreviewContentType =
  | "post"
  | "image"
  | "video"
  | "carousel"
  | "reel"
  | "unknown";

function normalizePreviewContentType(
  value: string | null | undefined,
): PreviewContentType {
  switch (value) {
    case "post":
    case "image":
    case "video":
    case "carousel":
    case "reel":
      return value;
    default:
      return "unknown";
  }
}

const SYNC_STATUS = {
  idle: {
    label: "Bereit für den ersten Abruf",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    description:
      "Die Verbindung steht. Der sichere Ausgangsbestand kann jetzt eingelesen werden.",
  },
  reconnected: {
    label: "Wieder verbunden",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    description:
      "Die Verbindung wurde erneuert. Der gespeicherte Ausgangsbestand bleibt erhalten.",
  },
  syncing: {
    label: "Abruf läuft",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    description: "Facebook- und Instagram-Beiträge werden gerade abgeglichen.",
  },
  success: {
    label: "Aktuell",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    description: "Der letzte Abruf wurde vollständig abgeschlossen.",
  },
  partial: {
    label: "Teilweise aktualisiert",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description: "Mindestens eine Quelle war kurzzeitig nicht erreichbar.",
  },
  error: {
    label: "Abruf wird wiederholt",
    className: "bg-red-50 text-red-700 ring-red-200",
    description:
      "Der automatische Abruf versucht es nach einer sicheren Pause erneut.",
  },
  assets_setup: {
    label: "Assets ergänzen",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description:
      "Meta ist verbunden. Für den Beitragsabruf fehlen noch eine Facebook-Seite oder ein Instagram-Konto.",
  },
  rate_limited: {
    label: "Meta-Pause aktiv",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description:
      "Der Abruf pausiert automatisch, um Meta-Nutzungslimits einzuhalten.",
  },
  reconnect_required: {
    label: "Verbindung erneuern",
    className: "bg-red-50 text-red-700 ring-red-200",
    description: "Der Lesezugriff ist abgelaufen oder wurde von Meta widerrufen.",
  },
} as const;

type SyncSnapshotState = {
  status: string | null;
  errorCode?: string | null;
  lastSyncStartedAt: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  displayNextSyncAt: string;
  baselineCompleted: boolean;
  seenCount: number;
  newCount: number;
  storedCandidateCount: number;
  candidates: ContentSyncCandidate[];
  detectionHistory: ContentDetectionHistoryItem[];
  detectionSummary: {
    today: ContentDetectionSourceCounts;
    week: ContentDetectionSourceCounts;
  };
  assetSyncHints: ContentAssetSyncHint[];
};

type DetectionHistoryWindow = "today" | "week";

const EMPTY_SOURCE_COUNTS: ContentDetectionSourceCounts = {
  facebook: 0,
  instagram: 0,
  total: 0,
};

const EMPTY_DETECTION_SUMMARY = {
  today: EMPTY_SOURCE_COUNTS,
  week: EMPTY_SOURCE_COUNTS,
};

type BoostContext = {
  boostMode: "OFF" | "REVIEW" | "AUTO";
  boostEnabled: boolean;
  canApprove: boolean;
  canPrepare: boolean;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED" | null;
  policyActive: boolean;
  organicPlannerStatus: string | null;
  organicPlannerLastError: string | null;
  autoPlanEnabled: boolean;
  pendingBoostCandidateIds: string[];
  heldPlanByCandidate: Record<string, HeldOrganicBoostPlanView>;
  overrideByCandidate: Record<string, ContentBoostOverrideView>;
};

type Props = {
  initial: SyncSnapshotState;
  reconnectRequired: boolean;
  writeScopeGranted: boolean;
  needsContentAssetSetup: boolean;
  connectedAssets: MetaConnectedAssetView[];
  showExtraAssetHint: boolean;
  boost: BoostContext;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatSourceCounts(counts: ContentDetectionSourceCounts) {
  return `${counts.total} · FB ${counts.facebook} · IG ${counts.instagram}`;
}

function resolveSyncInfo(
  status: string | null,
  baselineCompleted: boolean,
  _errorCode?: string | null,
  needsContentAssetSetup = false,
) {
  if (needsContentAssetSetup) {
    return SYNC_STATUS.assets_setup;
  }
  if (status === "idle" && baselineCompleted) {
    return SYNC_STATUS.reconnected;
  }
  return (
    SYNC_STATUS[(status as keyof typeof SYNC_STATUS) ?? "idle"] ??
    SYNC_STATUS.idle
  );
}

export function MetaContentSyncPanel({
  initial,
  reconnectRequired,
  writeScopeGranted,
  needsContentAssetSetup,
  connectedAssets,
  showExtraAssetHint,
  boost,
}: Props) {
  const [snapshot, setSnapshot] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [historyWindow, setHistoryWindow] =
    useState<DetectionHistoryWindow>("today");
  const inFlightRef = useRef(false);

  const displayNextSyncAt = useMemo(
    () =>
      resolveCustomerNextSyncAt(snapshot.nextSyncAt, new Date(now)),
    [snapshot.nextSyncAt, now],
  );

  const syncInfo = resolveSyncInfo(
    snapshot.status,
    snapshot.baselineCompleted,
    snapshot.errorCode,
    needsContentAssetSetup,
  );

  const refreshSnapshot = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await fetch("/api/connectors/meta/sync", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        ok?: boolean;
        connected?: boolean;
        status?: string | null;
        errorCode?: string | null;
        lastSyncStartedAt?: string | null;
        lastSyncedAt?: string | null;
        nextSyncAt?: string | null;
        displayNextSyncAt?: string;
        baselineCompleted?: boolean;
        seenCount?: number;
        newCount?: number;
        storedCandidateCount?: number;
        candidates?: ContentSyncCandidate[];
        detectionHistory?: ContentDetectionHistoryItem[];
        detectionSummary?: SyncSnapshotState["detectionSummary"];
        assetSyncHints?: ContentAssetSyncHint[];
      };
      if (!body.ok || body.connected === false) return;
      setSnapshot({
        status: body.status ?? null,
        errorCode: body.errorCode ?? null,
        lastSyncStartedAt: body.lastSyncStartedAt ?? null,
        lastSyncedAt: body.lastSyncedAt ?? null,
        nextSyncAt: body.nextSyncAt ?? null,
        displayNextSyncAt:
          body.displayNextSyncAt ??
          resolveCustomerNextSyncAt(body.nextSyncAt ?? null),
        baselineCompleted: Boolean(body.baselineCompleted),
        seenCount: body.seenCount ?? 0,
        newCount: body.newCount ?? 0,
        storedCandidateCount: body.storedCandidateCount ?? 0,
        candidates: Array.isArray(body.candidates) ? body.candidates : [],
        detectionHistory: Array.isArray(body.detectionHistory)
          ? body.detectionHistory
          : [],
        detectionSummary: body.detectionSummary ?? EMPTY_DETECTION_SUMMARY,
        assetSyncHints: Array.isArray(body.assetSyncHints)
          ? body.assetSyncHints
          : [],
      });
      setNow(Date.now());
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const nextAt = snapshot.nextSyncAt
      ? new Date(snapshot.nextSyncAt).getTime()
      : Number.NaN;
    const syncing = snapshot.status === "syncing";
    const dueSoon =
      Number.isFinite(nextAt) && nextAt - now <= 90_000;
    const overdue =
      Number.isFinite(nextAt) && nextAt <= now;

    if (!syncing && !dueSoon && !overdue) {
      return;
    }

    const intervalMs = syncing ? 8_000 : 20_000;
    const timer = window.setInterval(() => {
      void refreshSnapshot();
    }, intervalMs);
    // Immediate refresh when overdue so past "Nächster Abruf" clears quickly.
    if (overdue || syncing) {
      void refreshSnapshot();
    }
    return () => window.clearInterval(timer);
  }, [
    now,
    refreshSnapshot,
    snapshot.nextSyncAt,
    snapshot.status,
  ]);

  const pendingBoostCandidateCount = useMemo(() => {
    const ids = new Set(boost.pendingBoostCandidateIds);
    return snapshot.candidates.filter((candidate) => ids.has(candidate.id))
      .length;
  }, [boost.pendingBoostCandidateIds, snapshot.candidates]);

  const visibleCandidates = useMemo(
    () =>
      snapshot.candidates.filter((candidate) =>
        shouldListAsContentCandidate({
          heldPlan: boost.heldPlanByCandidate[candidate.id] ?? null,
        }),
      ),
    [boost.heldPlanByCandidate, snapshot.candidates],
  );

  const historyItems = useMemo(() => {
    const clock = new Date(now);
    return snapshot.detectionHistory.filter((item) =>
      isDetectionInWindow(item.firstSeenAt, historyWindow, clock),
    );
  }, [historyWindow, now, snapshot.detectionHistory]);

  const historySummary =
    historyWindow === "today"
      ? snapshot.detectionSummary.today
      : snapshot.detectionSummary.week;

  const facebookSyncHint = snapshot.assetSyncHints.find(
    (hint) => hint.assetType === "facebook_page",
  );
  const instagramSyncHint = snapshot.assetSyncHints.find(
    (hint) => hint.assetType === "instagram_account",
  );

  return (
    <>
      <section className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                Meta Content Sync
              </p>
              <h2 className="mt-2 text-xl font-extrabold tracking-tight">
                Beiträge sicher abrufen
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Adbot liest veröffentlichte Beiträge deiner in Meta ausgewählten
                Facebook-Seiten und Instagram-Konten. Dieser Sync-Pfad führt keine
                Mutation aus; Meta-Änderungen laufen ausschließlich über die
                getrennte, policy-gedeckte Control Plane.
              </p>
            </div>
            <span
              className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${syncInfo.className}`}
            >
              {syncInfo.label}
            </span>
          </div>
        </div>

        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{syncInfo.description}</p>
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <div className="min-w-0 rounded-xl bg-slate-50 p-4">
                <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                  <Clock3 className="size-4 shrink-0" />
                  <span className="min-w-0 break-words">Letzter Abruf</span>
                </dt>
                <dd className="mt-2 break-words text-sm font-bold text-slate-900">
                  {formatDateTime(snapshot.lastSyncedAt)}
                </dd>
              </div>
              <div className="min-w-0 rounded-xl bg-slate-50 p-4">
                <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                  <CalendarClock className="size-4 shrink-0" />
                  <span className="min-w-0 break-words">Nächster Abruf</span>
                </dt>
                <dd className="mt-2 break-words text-sm font-bold text-slate-900">
                  {formatDateTime(displayNextSyncAt)}
                </dd>
              </div>
              <div className="min-w-0 rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                  Gesehen
                </dt>
                <dd className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900">
                  {snapshot.seenCount}
                </dd>
              </div>
              <div className="min-w-0 rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                  Neu erkannt
                </dt>
                <dd className="mt-2 text-2xl font-extrabold tabular-nums text-blue-700">
                  {snapshot.newCount}
                </dd>
              </div>
              <div className="min-w-0 rounded-xl bg-slate-50 p-4">
                <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                  Gespeichert
                </dt>
                <dd className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900">
                  {snapshot.storedCandidateCount}
                </dd>
              </div>
            </dl>

            <MetaConnectedAssets
              assets={connectedAssets}
              extendHref="/api/connectors/meta/start?intent=extend"
              showExtraHint={showExtraAssetHint}
            />
          </div>

          <div className="lg:min-w-60">
            {reconnectRequired ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-bold text-red-950">
                  {writeScopeGranted
                    ? "Die Meta-Verbindung muss erneuert werden."
                    : "Der minimale Schreibscope muss bestätigt werden."}
                </p>
                <p className="mt-2 text-xs leading-5 text-red-800">
                  {writeScopeGranted
                    ? "Der Lesezugriff ist abgelaufen oder wurde von Meta widerrufen."
                    : "Bitte Meta erneut verbinden und ads_management freigeben."}
                </p>
                <form action="/api/connectors/meta/start" method="post">
                  <button
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                    type="submit"
                  >
                    Meta neu verbinden
                    <ArrowUpRight className="size-4" />
                  </button>
                </form>
              </div>
            ) : needsContentAssetSetup ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-950">
                  Meta ist verbunden — für den Beitragsabruf fehlen noch Assets.
                </p>
                <p className="mt-2 text-xs leading-5 text-amber-900">
                  Es braucht mindestens eine Facebook-Seite und ein verknüpftes
                  Instagram-Konto. Werbekonten steuern nur Ads und blockieren den
                  Beitragsabruf nicht. Über „Assets erweitern“ nachziehen, dann Abruf
                  starten. Neu verbinden ist dafür nicht nötig.
                </p>
                <MetaSyncButton
                  lastSyncStartedAt={snapshot.lastSyncStartedAt}
                  onSyncSettled={() => {
                    void refreshSnapshot();
                  }}
                  refreshOnComplete={false}
                />
              </div>
            ) : (
              <MetaSyncButton
                lastSyncStartedAt={snapshot.lastSyncStartedAt}
                onSyncSettled={() => {
                  void refreshSnapshot();
                }}
                refreshOnComplete={false}
              />
            )}
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Automatisch einmal pro Stunde. Der manuelle Abruf ist nach 60 Sekunden
              erneut verfügbar. Dieser Bereich aktualisiert sich von selbst.
            </p>
          </div>
        </div>

        {!snapshot.baselineCompleted ? (
          <div className="mx-5 mb-6 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 sm:mx-6">
            <span className="font-bold">Sicherer Ausgangsbestand:</span> Beim ersten
            Abruf werden vorhandene Beiträge eingelesen, aber nicht als neu markiert.
            Erst später veröffentlichte Inhalte erscheinen als neue Kandidaten.
          </div>
        ) : null}
      </section>

      <section className="mt-10 scroll-mt-24" id="beitragskandidaten">
        <OrganicBoostAutoPlanner
          enabled={boost.autoPlanEnabled}
          pendingCandidateCount={pendingBoostCandidateCount}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              Beitragskandidaten
            </p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">
              Neu seit dem Ausgangsbestand
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-500">
            Offene neue Beiträge seit dem Ausgangsbestand. Sobald ein Beitrag-Push
            gestartet ist (oder die Freigabe erteilt wurde), verschwindet er hier und
            erscheint unter Kampagnen.
          </p>
        </div>

        {visibleCandidates.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {visibleCandidates.map((candidate) => (
              <article
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                key={candidate.id}
              >
                <ContentCandidatePreview
                  contentType={normalizePreviewContentType(candidate.contentType)}
                  previewUrl={candidate.previewUrl}
                  source={
                    candidate.source === "instagram" ? "instagram" : "facebook"
                  }
                />
                <div className="flex min-h-52 flex-col p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {candidate.source === "instagram" ? (
                        <Camera className="size-3.5" />
                      ) : (
                        <Megaphone className="size-3.5" />
                      )}
                      {candidate.source === "instagram" ? "Instagram" : "Facebook"}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {formatDateTime(
                        candidate.publishedAt ?? candidate.firstSeenAt,
                      )}
                    </span>
                  </div>
                  <p className="mt-5 line-clamp-4 text-sm leading-6 text-slate-700">
                    {candidate.captionExcerpt ?? "Beitrag ohne verfügbaren Text"}
                  </p>
                  <div className="mt-auto pt-5">
                    {candidate.permalinkUrl ? (
                      <a
                        className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 transition hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                        href={candidate.permalinkUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Originalbeitrag ansehen
                        <ExternalLink className="size-4" />
                      </a>
                    ) : (
                      <span className="text-sm font-semibold text-slate-400">
                        Kein öffentlicher Link verfügbar
                      </span>
                    )}
                    <ContentCandidateBoostControls
                      boostMode={boost.boostMode}
                      canApprove={boost.canApprove}
                      canPrepare={boost.canPrepare}
                      candidateId={candidate.id}
                      heldPlan={boost.heldPlanByCandidate[candidate.id] ?? null}
                      killSwitchMode={boost.killSwitchMode}
                      organicPlannerLastError={boost.organicPlannerLastError}
                      organicPlannerStatus={boost.organicPlannerStatus}
                      override={boost.overrideByCandidate[candidate.id] ?? null}
                      policyActive={boost.policyActive}
                      source={
                        candidate.source === "instagram" ? "instagram" : "facebook"
                      }
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <RefreshCw className="mx-auto size-6 text-slate-400" />
            <p className="mt-3 font-bold text-slate-900">
              Noch keine neuen Beitragskandidaten
            </p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Nach dem ersten Ausgangsbestand erscheinen hier Beiträge, die bei einem
              späteren manuellen oder stündlichen Abruf neu erkannt werden.
            </p>
          </div>
        )}
      </section>

      <section className="mt-8 scroll-mt-24" id="erkannte-beitraege">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Erkennungsrückschau
            </p>
            <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-800">
              Was Adbot erkannt hat
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["today", "Heute", snapshot.detectionSummary.today],
                ["week", "Diese Woche", snapshot.detectionSummary.week],
              ] as const
            ).map(([key, label, counts]) => {
              const active = historyWindow === key;
              return (
                <button
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${
                    active
                      ? "bg-slate-800 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  key={key}
                  onClick={() => setHistoryWindow(key)}
                  type="button"
                >
                  {label}
                  <span
                    className={`tabular-nums ${active ? "text-slate-200" : "text-slate-500"}`}
                  >
                    {counts.total}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Übersicht der zuletzt beim Abruf gespeicherten Beiträge — unabhängig davon,
          ob sie noch als offene Kandidaten gelten. Hilft zu sehen, ob Facebook und
          Instagram überhaupt ankommen.
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              {historyWindow === "today" ? "Heute erkannt" : "Diese Woche erkannt"}
            </dt>
            <dd className="mt-1 text-sm font-bold text-slate-800">
              {formatSourceCounts(historySummary)}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Facebook-Seite zuletzt
            </dt>
            <dd className="mt-1 text-sm font-bold text-slate-800">
              {formatDateTime(facebookSyncHint?.lastSyncedAt)}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Instagram zuletzt
            </dt>
            <dd className="mt-1 text-sm font-bold text-slate-800">
              {formatDateTime(instagramSyncHint?.lastSyncedAt)}
            </dd>
          </div>
        </dl>

        {historyWindow === "today" &&
        historySummary.instagram > 0 &&
        historySummary.facebook === 0 ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            Heute wurden Instagram-Beiträge erkannt, aber keine Facebook-Beiträge.
            Wenn auf der Seite neue Posts liegen, prüfe den Asset-Abruf oben
            (Status „Teilweise aktualisiert“ oder fehlendes Facebook-Datum).
          </p>
        ) : null}

        {historyItems.length ? (
          <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {historyItems.map((item) => (
              <li
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                key={item.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                      {item.source === "instagram" ? (
                        <Camera className="size-3" />
                      ) : (
                        <Megaphone className="size-3" />
                      )}
                      {item.source === "instagram" ? "Instagram" : "Facebook"}
                    </span>
                    {item.isNew ? (
                      <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        Offen
                      </span>
                    ) : (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                        Archiviert
                      </span>
                    )}
                    <span className="text-[11px] font-semibold text-slate-500">
                      Erkannt {formatDateTime(item.firstSeenAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-slate-700">
                    {item.captionExcerpt ?? "Beitrag ohne verfügbaren Text"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  <span>
                    Veröffentlicht{" "}
                    {formatDateTime(item.publishedAt ?? item.firstSeenAt)}
                  </span>
                  {item.permalinkUrl ? (
                    <a
                      className="inline-flex items-center gap-1 font-bold text-slate-700 transition hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600"
                      href={item.permalinkUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Link
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
            <p className="text-sm font-bold text-slate-800">
              {historyWindow === "today"
                ? "Heute noch keine Erkennungen gespeichert"
                : "Diese Woche noch keine Erkennungen gespeichert"}
            </p>
            <p className="mx-auto mt-1.5 max-w-lg text-xs leading-5 text-slate-500">
              Hier erscheinen Beiträge, sobald ein Abruf sie erstmals in Adbot
              abgelegt hat — auch wenn sie später nicht mehr unter den offenen
              Kandidaten stehen.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
