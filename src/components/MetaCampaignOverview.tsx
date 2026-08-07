import {
  AlertCircle,
  BarChart3,
  Clock3,
  Lightbulb,
  LockKeyhole,
  Megaphone,
  ShieldCheck,
} from "lucide-react";

import { OrganicBoostLiveRefresh } from "@/components/OrganicBoostLiveRefresh";
import { OrganicBoostPlanButton } from "@/components/OrganicBoostPlanButton";

type CampaignPerformance = {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  spend: number | null;
  impressions: number | null;
  linkClicks: number | null;
  linkCtr: number | null;
  linkCpc: number | null;
  leads: number | null;
  purchases: number | null;
  currency: string;
};

type CampaignRecommendation = {
  id: string;
  campaignName: string;
  ruleKey: string;
  ruleVersion: number;
  severity: string;
  priority: number;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  windowStart: string;
  windowEnd: string;
};

export type OrganicBoostCampaignView = {
  planId: string;
  planStatus: string;
  campaignName: string;
  status: string | null;
  effectiveStatus: string | null;
  /** Customer-facing delivery state for traffic-light UI */
  deliveryState:
    | "active"
    | "waiting_meta"
    | "starting"
    | "paused"
    | "failed"
    | "unknown";
  deliveryLabel: string;
  failureDetail: string | null;
  budgetMode: "DAILY" | "LIFETIME";
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  budgetRemainingMinor: number | null;
  durationDays: number | null;
  startTime: string | null;
  endTime: string | null;
  spend: number | null;
  impressions: number | null;
  postEngagements: number | null;
  currency: string;
  createdAt: string;
};

export function formatOrganicBoostFailureDetail(input: {
  planErrorClass?: string | null;
  planBlockedReason?: string | null;
  failedStepKey?: string | null;
  failedStepErrorCode?: string | null;
}): string | null {
  const stepCode = input.failedStepErrorCode?.trim() || null;
  const stepKey = input.failedStepKey?.trim() || null;
  if (stepCode) {
    if (stepCode === "meta_graph_adset_budget_sharing") {
      return stepKey
        ? `Meta verlangt is_adset_budget_sharing_enabled bei „${stepKey}“`
        : "Meta verlangt is_adset_budget_sharing_enabled für die Kampagne";
    }
    if (stepCode === "meta_graph_special_ad_categories") {
      return "Meta verlangt special_ad_categories an der Kampagne";
    }
    if (stepCode.startsWith("meta_graph_")) {
      return stepKey
        ? `Meta hat „${stepKey}“ abgelehnt (${stepCode.replace("meta_graph_", "#")})`
        : `Meta hat den Schreibschritt abgelehnt (${stepCode.replace("meta_graph_", "#")})`;
    }
    return stepKey ? `${stepKey}: ${stepCode}` : stepCode;
  }

  const reason = input.planBlockedReason?.trim() || null;
  if (reason === "organic_preflight_kill_switch" || reason === "writes_frozen") {
    return "Sicherheitsschranke blockiert Meta-Schreiben — unter Autonomie „Freigeben“ wählen und „Freigabe speichern“";
  }
  if (reason === "superseded_by_marketing_snapshot") {
    return "Wird nach Marketing-Abruf automatisch neu angestoßen";
  }
  if (reason === "organic_preflight_marketing_sync_stale") {
    return "Marketing-Abruf zu alt — Meta-Versand wartet";
  }
  if (reason === "organic_preflight_not_ready") {
    return "Voraussetzungen für Meta-Versand noch nicht erfüllt";
  }
  if (reason) {
    return reason;
  }

  const errorClass = input.planErrorClass?.trim() || null;
  return errorClass || null;
}

export function deriveOrganicBoostDelivery(input: {
  planStatus: string | null | undefined;
  status: string | null | undefined;
  effectiveStatus: string | null | undefined;
}): Pick<OrganicBoostCampaignView, "deliveryState" | "deliveryLabel"> {
  const plan = (input.planStatus ?? "").toUpperCase();
  const effective = (input.effectiveStatus ?? input.status ?? "").toUpperCase();

  if (
    effective === "PENDING_REVIEW" ||
    effective === "IN_PROCESS" ||
    effective === "PREAPPROVED" ||
    effective === "PENDING"
  ) {
    return {
      deliveryState: "waiting_meta",
      deliveryLabel: "Wartet auf Freigabe durch Meta",
    };
  }

  if (effective === "ACTIVE") {
    return {
      deliveryState: "active",
      deliveryLabel: "Boost aktiv",
    };
  }

  if (effective === "PAUSED" || effective === "CAMPAIGN_PAUSED" || effective === "ADSET_PAUSED") {
    return {
      deliveryState: "paused",
      deliveryLabel: "Pausiert",
    };
  }

  if (
    plan === "FAILED" ||
    plan === "STALE" ||
    plan === "PREFLIGHT_FAILED" ||
    plan === "COMPENSATION_REQUIRED"
  ) {
    return {
      deliveryState: "failed",
      deliveryLabel: "Fehlgeschlagen",
    };
  }

  if (
    plan === "PENDING" ||
    plan === "RETRYABLE" ||
    plan === "CLAIMED" ||
    plan === "RUNNING" ||
    plan === "EXECUTING" ||
    plan === "RECONCILING"
  ) {
    return {
      deliveryState: "starting",
      deliveryLabel: "Boost wird gestartet",
    };
  }

  if (plan === "BLOCKED" || plan === "HELD") {
    return {
      deliveryState: "waiting_meta",
      deliveryLabel: "Wartet auf Freigabe",
    };
  }

  if (plan === "SUCCEEDED" && !effective) {
    return {
      deliveryState: "waiting_meta",
      deliveryLabel: "Wartet auf Freigabe durch Meta",
    };
  }

  return {
    deliveryState: "unknown",
    deliveryLabel: effective || plan || "Status offen",
  };
}

type MetaCampaignOverviewProps = {
  campaigns: CampaignPerformance[];
  organicBoostCampaigns: OrganicBoostCampaignView[];
  organicBoostConfigured: boolean;
  /** Effective ACCOUNT kill-switch; banner must not nag Freigeben when already ALLOW */
  killSwitchMode?: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED" | null;
  organicPlannerStatus?: string | null;
  organicPlannerLastError?: string | null;
  pendingBoostCandidateCount?: number;
  counts: {
    campaigns: number;
    adSets: number;
    ads: number;
    creatives: number;
    insights: number;
  };
  currency: string;
  errorCode: string | null;
  insightsSince: string | null;
  insightsUntil: string | null;
  lastSuccessAt: string | null;
  recommendations: CampaignRecommendation[];
  status: string;
};

function formatDate(value: string | null) {
  if (!value) {
    return "Noch kein vollständiger Abruf";
  }

  const date = new Date(`${value.length === 10 ? `${value}T12:00:00Z` : value}`);

  if (Number.isNaN(date.getTime())) {
    return "Datenstand nicht verfügbar";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeZone: value.length === 10 ? "UTC" : "Europe/Berlin",
  }).format(date);
}

function formatMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `${new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2,
  }).format(value)} %`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function formatDurationProgress(startTime: string | null, endTime: string | null) {
  if (!startTime || !endTime) {
    return { elapsedLabel: "—", remainingLabel: "—" };
  }
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { elapsedLabel: "—", remainingLabel: "—" };
  }

  const totalMs = end - start;
  const elapsedMs = Math.min(Math.max(now - start, 0), totalMs);
  const remainingMs = Math.max(end - now, 0);

  const toDaysHours = (ms: number) => {
    const totalHours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days <= 0) return `${hours} Std.`;
    if (hours <= 0) return `${days} Tg.`;
    return `${days} Tg. ${hours} Std.`;
  };

  return {
    elapsedLabel: now < start ? "Noch nicht gestartet" : toDaysHours(elapsedMs),
    remainingLabel: now >= end ? "Beendet" : toDaysHours(remainingMs),
  };
}

function formatMinorMoney(value: number | null, currency: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatMoney(value / 100, currency);
}

function evidenceNumber(evidence: Record<string, unknown>, key: string) {
  const value = evidence[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recommendationEvidence(
  recommendation: CampaignRecommendation,
  fallbackCurrency: string,
) {
  const evidence = recommendation.evidence;
  const currency =
    typeof evidence.currency === "string" ? evidence.currency : fallbackCurrency;

  if (recommendation.ruleKey === "active_without_delivery_3d") {
    return [
      `${formatNumber(evidenceNumber(evidence, "days_without_delivery"))} vollständige Tage ohne Auslieferung`,
      `Mindestalter ${formatNumber(evidenceNumber(evidence, "minimum_campaign_age_days"))} Tage`,
    ];
  }

  if (recommendation.ruleKey === "cost_per_result_up_30pct") {
    return [
      `Aktuell ${formatMoney(evidenceNumber(evidence, "current_cost_per_result"), currency)}`,
      `Zuvor ${formatMoney(evidenceNumber(evidence, "previous_cost_per_result"), currency)}`,
      `Anstieg ${formatPercent(evidenceNumber(evidence, "increase_percent"))}`,
    ];
  }

  if (recommendation.ruleKey === "spend_without_results_14d") {
    return [
      `Ausgaben ${formatMoney(evidenceNumber(evidence, "spend"), currency)}`,
      `${formatNumber(evidenceNumber(evidence, "impressions"))} Impressionen`,
      `${formatNumber(evidenceNumber(evidence, "results"))} Ergebnisse`,
    ];
  }

  if (recommendation.ruleKey === "low_link_ctr_7d") {
    return [
      `Link-CTR ${formatPercent(evidenceNumber(evidence, "link_ctr_percent"))}`,
      `Prüfwert ${formatPercent(evidenceNumber(evidence, "threshold_percent"))}`,
      `${formatNumber(evidenceNumber(evidence, "impressions"))} Impressionen`,
    ];
  }

  return ["Strukturierte Evidenz liegt vor"];
}

function formatObjective(value: string | null) {
  if (!value) {
    return "Ziel nicht verfügbar";
  }

  return value
    .replace(/^OUTCOME_/, "")
    .replaceAll("_", " ")
    .toLocaleLowerCase("de-DE")
    .replace(/^./, (character) => character.toLocaleUpperCase("de-DE"));
}

function statusStyle(status: string | null) {
  if (status === "ACTIVE") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "PAUSED") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }

  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function boostDeliveryStyle(state: OrganicBoostCampaignView["deliveryState"]) {
  if (state === "active") {
    return {
      badge: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      dot: "bg-emerald-500",
    };
  }
  if (state === "waiting_meta" || state === "starting") {
    return {
      badge: "bg-amber-50 text-amber-900 ring-amber-200",
      dot: "bg-amber-400",
    };
  }
  if (state === "failed") {
    return {
      badge: "bg-red-50 text-red-800 ring-red-200",
      dot: "bg-red-500",
    };
  }
  if (state === "paused") {
    return {
      badge: "bg-slate-100 text-slate-700 ring-slate-200",
      dot: "bg-slate-400",
    };
  }
  return {
    badge: "bg-slate-100 text-slate-600 ring-slate-200",
    dot: "bg-slate-300",
  };
}

function recommendationStyle(severity: string) {
  if (severity === "warning") {
    return {
      badge: "bg-amber-100 text-amber-900",
      border: "border-amber-200",
      label: "Prüfen",
    };
  }

  return {
    badge: "bg-blue-100 text-blue-800",
    border: "border-blue-200",
    label: "Chance",
  };
}

const countLabels = [
  ["Kampagnen", "campaigns"],
  ["Anzeigengruppen", "adSets"],
  ["Anzeigen", "ads"],
  ["Creatives", "creatives"],
  ["Tageswerte", "insights"],
] as const;

export function MetaCampaignOverview({
  campaigns,
  organicBoostCampaigns,
  organicBoostConfigured,
  killSwitchMode = null,
  organicPlannerStatus = null,
  organicPlannerLastError = null,
  pendingBoostCandidateCount = 0,
  counts,
  currency,
  errorCode,
  insightsSince,
  insightsUntil,
  lastSuccessAt,
  recommendations,
  status,
}: MetaCampaignOverviewProps) {
  const awaitingOrganicBoostProgress =
    organicBoostConfigured &&
    (pendingBoostCandidateCount > 0 ||
      organicBoostCampaigns.some(
        (campaign) => campaign.deliveryState === "starting",
      ));
  // Sticky plan blocked_reason must not contradict Autonomie when already ALLOW.
  const organicBoostKillSwitchBlocked =
    killSwitchMode !== "ALLOW" &&
    organicBoostCampaigns.some(
      (campaign) =>
        typeof campaign.failureDetail === "string" &&
        campaign.failureDetail.includes("Sicherheitsschranke"),
    );
  const statusLabel =
    status === "success"
      ? "Meta Live"
      : status === "error"
        ? "Abruf unvollständig"
        : status === "syncing"
          ? "Abruf läuft"
          : "Noch nicht abgerufen";
  const statusClass =
    status === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "error"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-blue-50 text-blue-700 ring-blue-200";

  return (
    <section className="mt-10 scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" id="kampagnen">
      <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              Meta Campaign Intelligence
            </p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">
              Kampagnen und Leistung
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Schreibgeschützte Meta-Hierarchie mit täglichen Insights — und die von Adbot gestarteten Beitrag-Push-Kampagnen mit Budget und Laufzeit.
            </p>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${statusClass}`}>
            <ShieldCheck className="size-3.5" />
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="px-5 py-6 sm:px-6">
        <section className="mb-8" aria-labelledby="organic-boost-campaigns-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                Beitrag-Push
              </p>
              <h3 className="mt-2 text-lg font-extrabold" id="organic-boost-campaigns-title">
                Von Adbot gestartete Push-Kampagnen
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Ausgaben, Restbudget und Laufzeit aus Plan und Meta-Abruf. Interaktionen erscheinen,
                sobald Meta sie in den Insights liefert.
              </p>
            </div>
          </div>

          {organicBoostCampaigns.length ? (
            <div className="mt-5 space-y-3">
              {organicBoostKillSwitchBlocked ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                  Meta-Schreiben ist über die{" "}
                  <strong>Sicherheitsschranke</strong> gestoppt. Öffne{" "}
                  <a
                    className="font-bold underline underline-offset-2"
                    href="#automation-control-center"
                  >
                    Autonomie
                  </a>
                  , wähle dort <strong>Freigeben</strong> und klicke{" "}
                  <strong>Freigabe speichern</strong>. Danach startet der
                  Beitrag-Push automatisch.
                </p>
              ) : null}
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-[1080px] divide-y divide-slate-200 text-left text-sm">
                    <caption className="sr-only">
                      Adbot Beitrag-Push-Kampagnen mit Budget, Laufzeit und Leistung
                    </caption>
                    <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3" scope="col">Kampagne</th>
                        <th className="px-4 py-3" scope="col">Status</th>
                        <th className="px-4 py-3 text-right" scope="col">Ausgegeben</th>
                        <th className="px-4 py-3 text-right" scope="col">Restbudget</th>
                        <th className="px-4 py-3 text-right" scope="col">Verstrichen</th>
                        <th className="px-4 py-3 text-right" scope="col">Restlaufzeit</th>
                        <th className="px-4 py-3 text-right" scope="col">Interaktionen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {organicBoostCampaigns.map((campaign) => {
                        const runtime = formatDurationProgress(
                          campaign.startTime,
                          campaign.endTime,
                        );
                        const plannedLifetime =
                          campaign.budgetMode === "LIFETIME"
                            ? campaign.lifetimeBudgetMinor
                            : campaign.dailyBudgetMinor != null &&
                                campaign.durationDays != null
                              ? campaign.dailyBudgetMinor * campaign.durationDays
                              : null;
                        const remaining =
                          campaign.budgetRemainingMinor ??
                          (plannedLifetime != null && campaign.spend != null
                            ? Math.max(plannedLifetime - Math.round(campaign.spend * 100), 0)
                            : null);

                        return (
                          <tr key={campaign.planId}>
                            <th className="max-w-xs px-4 py-4 font-semibold text-slate-900" scope="row">
                              <span className="block truncate">{campaign.campaignName}</span>
                              <span className="mt-1 block text-xs font-medium text-slate-500">
                                {campaign.budgetMode === "LIFETIME"
                                  ? `Laufzeitbudget ${formatMinorMoney(campaign.lifetimeBudgetMinor, campaign.currency)}`
                                  : `Tagesbudget ${formatMinorMoney(campaign.dailyBudgetMinor, campaign.currency)}${
                                      campaign.durationDays
                                        ? ` · ${campaign.durationDays} Tage`
                                        : ""
                                    }`}
                              </span>
                              <span className="mt-1 block text-xs font-medium text-slate-400">
                                {formatDateTime(campaign.startTime)} – {formatDateTime(campaign.endTime)}
                              </span>
                            </th>
                            <td className="px-4 py-4">
                              {(() => {
                                const style = boostDeliveryStyle(campaign.deliveryState);
                                return (
                                  <div className="min-w-0">
                                    <span
                                      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${style.badge}`}
                                    >
                                      <span
                                        aria-hidden
                                        className={`size-2.5 shrink-0 rounded-full ${style.dot}`}
                                      />
                                      {campaign.deliveryLabel}
                                    </span>
                                    {campaign.failureDetail ? (
                                      <span className="mt-1 block max-w-[16rem] text-xs font-medium leading-5 text-slate-500">
                                        {campaign.failureDetail}
                                      </span>
                                    ) : null}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-4 text-right font-semibold text-slate-900">
                              {formatMoney(campaign.spend, campaign.currency)}
                            </td>
                            <td className="px-4 py-4 text-right text-slate-700">
                              {formatMinorMoney(remaining, campaign.currency)}
                            </td>
                            <td className="px-4 py-4 text-right text-slate-700">
                              {runtime.elapsedLabel}
                            </td>
                            <td className="px-4 py-4 text-right text-slate-700">
                              {runtime.remainingLabel}
                            </td>
                            <td className="px-4 py-4 text-right text-slate-700">
                              {campaign.postEngagements != null && campaign.postEngagements > 0
                                ? formatNumber(campaign.postEngagements)
                                : campaign.impressions != null
                                  ? `${formatNumber(campaign.impressions)} Imp.`
                                  : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <OrganicBoostLiveRefresh active={awaitingOrganicBoostProgress} />
            </div>
          ) : (
            <div className="mt-5 flex gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <Megaphone className="mt-0.5 size-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900">
                  Noch keine Beitrag-Push-Kampagnen
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {organicBoostConfigured
                    ? pendingBoostCandidateCount > 0
                      ? `${pendingBoostCandidateCount} erkannte Beiträge werden automatisch beworben (Vollautomatik + Freigeben), unabhängig vom Abruf. Kein Extra-Klick nötig — sobald der Meta-Versand die Kampagnen geschrieben hat, erscheinen sie hier.`
                      : "Automatischer Beitrag-Push ist eingeschaltet, aber aktuell liegt kein Boost-Plan vor. Sobald Pläne angelegt und per Meta-Versand geschrieben sind, erscheinen sie hier mit Ampel-Status."
                    : "Sobald Adbot organische Beiträge bewirbt, erscheinen sie hier mit Ausgaben, Restbudget und Laufzeit."}
                </p>
                {organicBoostConfigured &&
                (organicPlannerStatus || organicPlannerLastError) ? (
                  <p
                    className={`mt-2 text-xs font-semibold leading-5 ${
                      organicPlannerLastError ||
                      organicPlannerStatus === "MATERIALIZE_FAILED" ||
                      organicPlannerStatus === "NO_ELIGIBLE_CANDIDATES"
                        ? "text-amber-800"
                        : "text-slate-600"
                    }`}
                  >
                    Letzter Planner-Status: {organicPlannerStatus ?? "—"}
                    {organicPlannerLastError
                      ? ` · ${organicPlannerLastError}`
                      : ""}
                  </p>
                ) : null}
                <OrganicBoostLiveRefresh active={awaitingOrganicBoostProgress} />
                {organicBoostConfigured ? (
                  <OrganicBoostPlanButton label="Manuell erneut prüfen" />
                ) : null}
              </div>
            </div>
          )}
        </section>

        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {countLabels.map(([label, key]) => (
            <div className="rounded-xl bg-slate-50 p-4" key={key}>
              <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                {label}
              </dt>
              <dd className="mt-2 text-2xl font-extrabold text-slate-900">
                {new Intl.NumberFormat("de-DE").format(counts[key])}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5">
            <Clock3 className="size-3.5" />
            Datenstand: {formatDate(lastSuccessAt)}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5">
            <BarChart3 className="size-3.5" />
            Insight-Fenster: {insightsSince ? formatDate(insightsSince) : "—"} bis {insightsUntil ? formatDate(insightsUntil) : "—"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            Kontowährung: {currency}
          </span>
        </div>

        {status === "error" ? (
          <div className="mt-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950" role="alert">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-bold">Der letzte Kampagnenabruf war unvollständig.</p>
              <p className="mt-1 text-sm leading-6 text-red-800">
                Die zuletzt vollständig gespeicherten Live-Daten bleiben unverändert erhalten. Fehlercode: {errorCode ?? "marketing_sync_failed"}.
              </p>
            </div>
          </div>
        ) : null}

        {status !== "error" &&
        (errorCode === "marketing_operation_locked" ||
          errorCode === "marketing_operation_lease_failed") ? (
          <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-bold">Kampagnenabruf kurz übersprungen</p>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Ein paralleler Vorgang (z.&nbsp;B. Beitrag-Push) hatte die Konto-Lease. Die letzten erfolgreichen Kampagnendaten bleiben gültig; Beitrag-Push läuft unabhängig weiter.
              </p>
            </div>
          </div>
        ) : null}

        <section className="mt-8" aria-labelledby="meta-recommendations-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                Deterministische Empfehlungen
              </p>
              <h3 className="mt-2 text-lg font-extrabold" id="meta-recommendations-title">
                Prüfhilfen aus festen Schwellenwerten
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Jede Empfehlung nennt Regel, Zeitraum und Evidenz. Sie kann weder Budgets noch Status oder Anzeigen verändern.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
              <LockKeyhole className="size-3.5" />
              Nur Analyse
            </span>
          </div>

          {recommendations.length ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {recommendations.map((recommendation) => {
                const style = recommendationStyle(recommendation.severity);

                return (
                  <article
                    className={`rounded-2xl border bg-white p-5 ${style.border}`}
                    key={recommendation.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${style.badge}`}>
                        {style.label} · Priorität {recommendation.priority}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        {recommendation.campaignName}
                      </span>
                    </div>
                    <h4 className="mt-4 font-extrabold text-slate-950">
                      {recommendation.title}
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {recommendation.summary}
                    </p>
                    <dl className="mt-4 flex flex-wrap gap-2">
                      {recommendationEvidence(recommendation, currency).map((item) => (
                        <div className="rounded-lg bg-slate-100 px-3 py-2" key={item}>
                          <dt className="sr-only">Evidenz</dt>
                          <dd className="text-xs font-bold text-slate-700">{item}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                      <span>
                        Prüfzeitraum: {formatDate(recommendation.windowStart)} bis {formatDate(recommendation.windowEnd)}
                      </span>
                      <span className="font-mono">
                        {recommendation.ruleKey} · v{recommendation.ruleVersion}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 flex gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <Lightbulb className="mt-0.5 size-5 shrink-0 text-slate-400" />
              <div>
                <p className="text-sm font-bold text-slate-900">Keine aktive Empfehlung</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Aktuell wurde kein konservativer Schwellenwert ausgelöst oder die verfügbare Datenmenge reicht noch nicht für einen belastbaren Hinweis.
                </p>
              </div>
            </div>
          )}
        </section>

        {campaigns.length ? (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] divide-y divide-slate-200 text-left text-sm">
                <caption className="sr-only">
                  Read-only Meta-Kampagnenleistung der letzten 30 vollständigen Insight-Tage
                </caption>
                <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3" scope="col">Kampagne</th>
                    <th className="px-4 py-3" scope="col">Status</th>
                    <th className="px-4 py-3 text-right" scope="col">Ausgaben</th>
                    <th className="px-4 py-3 text-right" scope="col">Impressionen</th>
                    <th className="px-4 py-3 text-right" scope="col">Link-Klicks</th>
                    <th className="px-4 py-3 text-right" scope="col">Link-CTR</th>
                    <th className="px-4 py-3 text-right" scope="col">Link-CPC</th>
                    <th className="px-4 py-3 text-right" scope="col">Ergebnisse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <th className="max-w-xs px-4 py-4 font-semibold text-slate-900" scope="row">
                        <span className="block truncate">{campaign.name}</span>
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          {formatObjective(campaign.objective)}
                        </span>
                      </th>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusStyle(campaign.effectiveStatus ?? campaign.status)}`}>
                          {campaign.effectiveStatus ?? campaign.status ?? "Unbekannt"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold text-slate-900">
                        {formatMoney(campaign.spend, campaign.currency)}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700">
                        {formatNumber(campaign.impressions)}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700">
                        {formatNumber(campaign.linkClicks)}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700">
                        {formatPercent(campaign.linkCtr)}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700">
                        {formatMoney(campaign.linkCpc, campaign.currency)}
                      </td>
                      <td className="px-4 py-4 text-right text-slate-700">
                        {campaign.leads !== null
                          ? `${formatNumber(campaign.leads)} Leads`
                          : campaign.purchases !== null
                            ? `${formatNumber(campaign.purchases)} Käufe`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid min-h-52 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
            <div>
              <Megaphone className="mx-auto size-7 text-slate-400" />
              <p className="mt-3 font-bold text-slate-900">Noch keine Kampagnendaten verfügbar</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Starte den bestehenden sicheren Abruf. Bei einem vollständigen Marketing-Snapshot erscheint hier die tatsächlich zugängliche Kampagnenhierarchie; ein leeres Werbekonto bleibt eindeutig als leer erkennbar.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
