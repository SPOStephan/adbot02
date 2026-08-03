"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Save } from "lucide-react";

export type BoostSettingsView = {
  id: string;
  version: number;
  enabled: boolean;
  autoBoostNewCandidates: boolean;
  requireManualApproval: boolean;
  budgetMode: "DAILY" | "LIFETIME";
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  durationDays: number;
  budgetOwnerType: "CAMPAIGN" | "AD_SET";
  objective: string;
  sourceFilter: "facebook" | "instagram" | "both";
  defaultCountries: string[];
  defaultCtaType: string | null;
  defaultDestinationUrl: string | null;
  customerConfirmedAt: string | null;
};

function minorToEuroInput(value: number | null | undefined, fallback: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return (value / 100).toFixed(2);
}

type Props = {
  settings: BoostSettingsView | null;
  writeScopeGranted: boolean;
};

export function AutomationBoostSettings({ settings, writeScopeGranted }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [autoBoost, setAutoBoost] = useState(settings?.autoBoostNewCandidates ?? false);
  const [requireApproval, setRequireApproval] = useState(
    settings?.requireManualApproval ?? true,
  );
  const [budgetMode, setBudgetMode] = useState<"DAILY" | "LIFETIME">(
    settings?.budgetMode ?? "DAILY",
  );
  const [dailyBudget, setDailyBudget] = useState(
    minorToEuroInput(settings?.dailyBudgetMinor, "10.00"),
  );
  const [lifetimeBudget, setLifetimeBudget] = useState(
    minorToEuroInput(settings?.lifetimeBudgetMinor, "50.00"),
  );
  const [durationDays, setDurationDays] = useState(String(settings?.durationDays ?? 3));
  const [budgetOwnerType, setBudgetOwnerType] = useState<"CAMPAIGN" | "AD_SET">(
    settings?.budgetOwnerType ?? "AD_SET",
  );
  const [objective, setObjective] = useState(settings?.objective ?? "OUTCOME_ENGAGEMENT");
  const [sourceFilter, setSourceFilter] = useState<"facebook" | "instagram" | "both">(
    settings?.sourceFilter ?? "facebook",
  );
  const [ctaType, setCtaType] = useState(settings?.defaultCtaType ?? "");
  const [destinationUrl, setDestinationUrl] = useState(
    settings?.defaultDestinationUrl ?? "",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const days = Number(durationDays);
      const response = await fetch("/api/meta/automation/boost-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          autoBoostNewCandidates: autoBoost,
          requireManualApproval: requireApproval,
          budgetMode,
          dailyBudgetMinor: budgetMode === "DAILY" ? dailyBudget : null,
          lifetimeBudgetMinor: budgetMode === "LIFETIME" ? lifetimeBudget : null,
          durationDays: days,
          budgetOwnerType: budgetMode === "LIFETIME" ? "CAMPAIGN" : budgetOwnerType,
          objective,
          sourceFilter,
          defaultCountries: ["DE"],
          defaultCtaType: ctaType.trim() ? ctaType.trim().toUpperCase() : null,
          defaultDestinationUrl: destinationUrl.trim() || null,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.message ?? "Die Beitrag-Push-Einstellungen konnten nicht gespeichert werden.",
        );
      }
      setNotice({
        tone: "success",
        message: "Beitrag-Push-Standards wurden bestätigt und versioniert gespeichert.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Beitrag-Push-Einstellungen konnten nicht gespeichert werden.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="border-t border-slate-200 p-5 sm:p-7" onSubmit={onSubmit}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
          <Megaphone className="size-5" />
        </span>
        <div>
          <h3 className="font-extrabold">Beitrag-Push (Facebook/Instagram)</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Standardwerte für das Bewerben neuer organischer Beiträge. Pro Beitrag können Budget,
            Laufzeit und CTA überschrieben werden. Phase&nbsp;1 bewirbt Facebook-Seitenbeiträge
            über die vorhandene Beitrags-ID – ohne neue Werbemittel.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            checked={enabled}
            className="mt-1"
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block text-sm font-bold text-slate-900">Beitrag-Push aktiv</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              Erlaubt Vorbereitung und Planung von Boost-Kampagnen für dieses Werbekonto.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            checked={autoBoost}
            className="mt-1"
            onChange={(event) => setAutoBoost(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block text-sm font-bold text-slate-900">
              Neue Beiträge automatisch planen
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              Nach dem stündlichen Sync werden neue Facebook-Beiträge als Boost-Pläne angelegt.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            checked={requireApproval}
            className="mt-1"
            onChange={(event) => setRequireApproval(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="block text-sm font-bold text-slate-900">
              Manuelle Freigabe vor Meta-Write
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              Empfohlen für den Livetest. Ohne Freigabe nur mit Auto-Boost und Kill-Switch ALLOW.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-800">
          Budgetmodus
          <select
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
            onChange={(event) =>
              setBudgetMode(event.target.value as "DAILY" | "LIFETIME")
            }
            value={budgetMode}
          >
            <option value="DAILY">Tagesbudget</option>
            <option value="LIFETIME">Laufzeitbudget</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-800">
          Laufzeit (Tage)
          <input
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
            max={90}
            min={1}
            onChange={(event) => setDurationDays(event.target.value)}
            required
            type="number"
            value={durationDays}
          />
        </label>
        {budgetMode === "DAILY" ? (
          <label className="text-sm font-bold text-slate-800">
            Tagesbudget
            <span className="relative mt-2 block">
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-14 font-semibold"
                inputMode="decimal"
                onChange={(event) => setDailyBudget(event.target.value)}
                required
                value={dailyBudget}
              />
              <span className="absolute inset-y-0 right-4 flex items-center text-sm text-slate-400">
                EUR
              </span>
            </span>
          </label>
        ) : (
          <label className="text-sm font-bold text-slate-800">
            Laufzeitbudget
            <span className="relative mt-2 block">
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-14 font-semibold"
                inputMode="decimal"
                onChange={(event) => setLifetimeBudget(event.target.value)}
                required
                value={lifetimeBudget}
              />
              <span className="absolute inset-y-0 right-4 flex items-center text-sm text-slate-400">
                EUR
              </span>
            </span>
          </label>
        )}
        <label className="text-sm font-bold text-slate-800">
          Werbeziel
          <select
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
            onChange={(event) => setObjective(event.target.value)}
            value={objective}
          >
            <option value="OUTCOME_ENGAGEMENT">Interaktion (OUTCOME_ENGAGEMENT)</option>
            <option value="POST_ENGAGEMENT">Beitragsinteraktion (POST_ENGAGEMENT)</option>
          </select>
        </label>
        {budgetMode === "DAILY" ? (
          <label className="text-sm font-bold text-slate-800">
            Budgetträger
            <select
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
              onChange={(event) =>
                setBudgetOwnerType(event.target.value as "CAMPAIGN" | "AD_SET")
              }
              value={budgetOwnerType}
            >
              <option value="AD_SET">Ad Set</option>
              <option value="CAMPAIGN">Kampagne</option>
            </select>
          </label>
        ) : null}
        <label className="text-sm font-bold text-slate-800">
          Quellen
          <select
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
            onChange={(event) =>
              setSourceFilter(event.target.value as "facebook" | "instagram" | "both")
            }
            value={sourceFilter}
          >
            <option value="facebook">Nur Facebook (empfohlen, Phase 1)</option>
            <option value="both">Facebook + Instagram erkennen</option>
            <option value="instagram">Nur Instagram erkennen</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-800">
          Optionaler CTA-Typ
          <input
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
            onChange={(event) => setCtaType(event.target.value)}
            placeholder="LEARN_MORE"
            value={ctaType}
          />
        </label>
        <label className="text-sm font-bold text-slate-800 sm:col-span-2">
          Optionales CTA-Linkziel (HTTPS)
          <input
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
            onChange={(event) => setDestinationUrl(event.target.value)}
            placeholder="https://www.beispiel.de/landing"
            value={destinationUrl}
          />
        </label>
      </div>

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

      <button
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || !writeScopeGranted}
        type="submit"
      >
        <Save className="size-4" />
        {pending ? "Wird gespeichert …" : "Beitrag-Push-Standards speichern"}
      </button>
    </form>
  );
}
