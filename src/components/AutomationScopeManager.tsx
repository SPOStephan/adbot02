"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Search,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type AutomationBudgetOwnerView = {
  id: string;
  label: string;
  targetType: "CAMPAIGN" | "AD_SET";
  status: "MANAGED" | "SUSPENDED";
};

export type AutomationScopeCampaignView = {
  id: string;
  name: string;
  objective: string | null;
  effectiveStatus: string;
  budgetOwners: AutomationBudgetOwnerView[];
};

type AutomationScopeManagerProps = {
  campaigns: AutomationScopeCampaignView[];
  canEnable: boolean;
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

type ScopeResponse = {
  ok?: boolean;
  message?: string;
  affectedTargetCount?: number;
  managedBudgetOwnerCount?: number;
};

async function postScope(body: {
  selectionType: "CAMPAIGN" | "TARGET";
  selectionId: string;
  status: "MANAGED" | "SUSPENDED";
  reason: string;
}): Promise<ScopeResponse> {
  const response = await fetch("/api/meta/automation/scope", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as ScopeResponse | null;
  if (!response.ok) {
    throw new Error(result?.message ?? "Der Automationsbereich konnte nicht geändert werden.");
  }
  return result ?? {};
}

function objectiveLabel(value: string | null) {
  return value?.replace(/^OUTCOME_/, "").replaceAll("_", " ") ?? "Ohne Zielangabe";
}

export function AutomationScopeManager({
  campaigns,
  canEnable,
}: AutomationScopeManagerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const filteredCampaigns = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("de");
    if (!normalized) return campaigns;
    return campaigns.filter((campaign) =>
      `${campaign.name} ${campaign.objective ?? ""}`
        .toLocaleLowerCase("de")
        .includes(normalized),
    );
  }, [campaigns, query]);

  const managedBudgetOwnerCount = campaigns.reduce(
    (sum, campaign) =>
      sum + campaign.budgetOwners.filter((owner) => owner.status === "MANAGED").length,
    0,
  );

  async function changeScope(
    selectionType: "CAMPAIGN" | "TARGET",
    selectionId: string,
    status: "MANAGED" | "SUSPENDED",
    label: string,
  ) {
    if (status === "MANAGED") {
      const confirmed = window.confirm(
        `„${label}“ wirklich für die Budgetautomatisierung auswählen? ` +
          "Meta-Schreibvorgänge bleiben zusätzlich durch Policy, Hard Caps und Kill-Switch geschützt.",
      );
      if (!confirmed) return;
    }

    const key = `${selectionType}:${selectionId}:${status}`;
    setPendingKey(key);
    setNotice(null);
    try {
      const result = await postScope({
        selectionType,
        selectionId,
        status,
        reason:
          status === "MANAGED"
            ? `Kundenseitig im Control Center für Budgetautomatisierung ausgewählt: ${label}`
            : `Kundenseitig im Control Center aus der Budgetautomatisierung entfernt: ${label}`,
      });
      setNotice({
        tone: "success",
        message:
          status === "MANAGED"
            ? `${label} wurde ausgewählt. ${result.managedBudgetOwnerCount ?? 0} Budgetowner dieser Kampagne sind jetzt verwaltbar.`
            : `${label} wurde suspendiert. Es werden dafür keine neuen Budgetpläne erzeugt.`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Automationsbereich konnte nicht geändert werden.",
      });
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-white px-5 py-6 sm:px-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
            <SlidersHorizontal className="size-5" />
          </span>
          <div>
            <h3 className="font-extrabold">Verwaltete Kampagnen</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Bestehende Kampagnen sind standardmäßig suspendiert. Nur hier ausdrücklich ausgewählte Budgetowner dürfen neue Budgetpläne erhalten.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">
            {campaigns.length} Kampagnen
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">
            {managedBudgetOwnerCount} verwaltete Budgetowner
          </span>
        </div>
      </div>

      {!canEnable ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
          <p className="text-xs leading-5">
            Neue Auswahlen bleiben gesperrt, bis eine aktive EUR-Policy mit Budgetfreigabe und der Meta-Scope <strong>ads_management</strong> vorhanden sind. Bereits ausgewählte Bereiche kannst du weiterhin sicher suspendieren.
          </p>
        </div>
      ) : null}

      <label className="relative mt-5 block max-w-xl">
        <span className="sr-only">Kampagnen durchsuchen</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Kampagne nach Name oder Ziel suchen"
          value={query}
        />
      </label>

      {notice ? (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3">
        {filteredCampaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            Keine passende aktuelle Meta-Kampagne gefunden.
          </div>
        ) : (
          filteredCampaigns.map((campaign) => {
            const allManaged =
              campaign.budgetOwners.length > 0 &&
              campaign.budgetOwners.every((owner) => owner.status === "MANAGED");
            const expanded = expandedCampaignId === campaign.id;
            const campaignPending = pendingKey?.startsWith(`CAMPAIGN:${campaign.id}:`);

            return (
              <article className="rounded-2xl border border-slate-200 bg-slate-50" key={campaign.id}>
                <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <button
                    className="flex min-w-0 items-start gap-3 text-left"
                    onClick={() =>
                      setExpandedCampaignId(expanded ? null : campaign.id)
                    }
                    type="button"
                  >
                    <span
                      className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${
                        allManaged
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {allManaged ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-extrabold text-slate-900">
                        {campaign.name}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-slate-500">
                        {objectiveLabel(campaign.objective)} · {campaign.effectiveStatus} · {campaign.budgetOwners.length} Budgetowner
                      </span>
                    </span>
                    {expanded ? (
                      <ChevronUp className="mt-2 size-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="mt-2 size-4 shrink-0 text-slate-400" />
                    )}
                  </button>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {allManaged ? (
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={Boolean(campaignPending)}
                        onClick={() =>
                          changeScope("CAMPAIGN", campaign.id, "SUSPENDED", campaign.name)
                        }
                        type="button"
                      >
                        {campaignPending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
                        Suspendieren
                      </button>
                    ) : (
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!canEnable || Boolean(campaignPending) || campaign.budgetOwners.length === 0}
                        onClick={() =>
                          changeScope("CAMPAIGN", campaign.id, "MANAGED", campaign.name)
                        }
                        type="button"
                      >
                        {campaignPending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                        Alle Budgets auswählen
                      </button>
                    )}
                  </div>
                </div>

                {expanded ? (
                  <div className="grid gap-2 border-t border-slate-200 bg-white p-4">
                    {campaign.budgetOwners.length === 0 ? (
                      <p className="text-xs leading-5 text-slate-500">
                        Für diese Kampagne wurde noch kein aktueller Budgetowner materialisiert. Der Budgetplanner ergänzt ihn nach dem nächsten erfolgreichen Meta-Sync.
                      </p>
                    ) : (
                      campaign.budgetOwners.map((owner) => {
                        const ownerPending = pendingKey?.startsWith(`TARGET:${owner.id}:`);
                        return (
                          <div
                            className="flex flex-col gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                            key={owner.id}
                          >
                            <div>
                              <p className="text-sm font-bold text-slate-800">{owner.label}</p>
                              <p className={`mt-1 text-xs font-semibold ${owner.status === "MANAGED" ? "text-emerald-700" : "text-slate-500"}`}>
                                {owner.status === "MANAGED" ? "Verwaltet" : "Suspendiert"}
                              </p>
                            </div>
                            <button
                              className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                owner.status === "MANAGED"
                                  ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                  : "bg-cyan-700 text-white hover:bg-cyan-800"
                              }`}
                              disabled={
                                Boolean(ownerPending) ||
                                (owner.status === "SUSPENDED" && !canEnable)
                              }
                              onClick={() =>
                                changeScope(
                                  "TARGET",
                                  owner.id,
                                  owner.status === "MANAGED" ? "SUSPENDED" : "MANAGED",
                                  `${campaign.name} · ${owner.label}`,
                                )
                              }
                              type="button"
                            >
                              {ownerPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                              {owner.status === "MANAGED" ? "Suspendieren" : "Auswählen"}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
