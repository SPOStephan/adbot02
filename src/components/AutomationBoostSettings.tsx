"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Save } from "lucide-react";

export type BoostMode = "OFF" | "REVIEW" | "AUTO";

export type BoostSettingsView = {
  id: string;
  version: number;
  boostMode: BoostMode;
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

function deriveBoostMode(settings: BoostSettingsView | null): BoostMode {
  if (!settings || !settings.enabled) return "OFF";
  if (settings.boostMode === "AUTO" || settings.boostMode === "REVIEW") {
    return settings.boostMode;
  }
  return settings.requireManualApproval ? "REVIEW" : "AUTO";
}

type Props = {
  settings: BoostSettingsView | null;
  writeScopeGranted: boolean;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED" | null;
};

const MODE_OPTIONS: Array<{
  mode: BoostMode;
  title: string;
  description: string;
}> = [
  {
    mode: "OFF",
    title: "Aus",
    description: "Beiträge werden nur erkannt, aber nicht beworben.",
  },
  {
    mode: "REVIEW",
    title: "Einzeln freigeben",
    description:
      "Neue Beiträge werden automatisch als Boost vorbereitet. Du gibst jeden Beitrag einzeln frei.",
  },
  {
    mode: "AUTO",
    title: "Vollautomatisch",
    description:
      "Jeder neue Facebook-Beitrag wird mit dem festgelegten Tagesbudget und Zeitraum automatisch beworben.",
  },
];

export function AutomationBoostSettings({
  settings,
  writeScopeGranted,
  killSwitchMode,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );
  const [boostMode, setBoostMode] = useState<BoostMode>(deriveBoostMode(settings));
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
  const [ctaType, setCtaType] = useState(settings?.defaultCtaType ?? "");
  const [destinationUrl, setDestinationUrl] = useState(
    settings?.defaultDestinationUrl ?? "",
  );

  const effectiveBudgetMode = boostMode === "AUTO" ? "DAILY" : budgetMode;
  const autoNeedsAllow = boostMode === "AUTO" && killSwitchMode !== "ALLOW";

  const modeHint = useMemo(() => {
    if (boostMode === "AUTO") {
      return "Werbeziel ist Interaktionen/Likes (POST_ENGAGEMENT). Für den Live-Write muss der Kill-Switch auf ALLOW stehen.";
    }
    if (boostMode === "REVIEW") {
      return "Neue Beiträge erscheinen zur Freigabe. Erst nach „BEITRAG BEWERBEN“ schreibt Adbot zu Meta.";
    }
    return "Kein Boost-Plan wird erzeugt.";
  }, [boostMode]);

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
          boostMode,
          budgetMode: effectiveBudgetMode,
          dailyBudgetMinor: effectiveBudgetMode === "DAILY" ? dailyBudget : null,
          lifetimeBudgetMinor: effectiveBudgetMode === "LIFETIME" ? lifetimeBudget : null,
          durationDays: days,
          budgetOwnerType: effectiveBudgetMode === "LIFETIME" ? "CAMPAIGN" : "AD_SET",
          objective: "OUTCOME_ENGAGEMENT",
          sourceFilter: "facebook",
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
        message:
          boostMode === "AUTO"
            ? "Vollautomatik gespeichert: Neue Facebook-Beiträge werden mit Interaktionsziel geplant und ausgeführt."
            : boostMode === "REVIEW"
              ? "Freigabe-Modus gespeichert: Neue Beiträge werden zur einzelnen Freigabe vorbereitet."
              : "Beitrag-Push ist ausgeschaltet.",
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
          <h3 className="font-extrabold">Beitrag-Push (Facebook)</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Neue organische Beiträge erkennen und mit Fixed Budget bewerben. Standard-Werbeziel:
            Interaktionen/Likes. Keine neuen Werbemittel nötig.
          </p>
        </div>
      </div>

      <fieldset className="mt-6 space-y-3">
        <legend className="text-sm font-extrabold text-slate-900">Modus</legend>
        {MODE_OPTIONS.map((option) => (
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
              boostMode === option.mode
                ? "border-blue-300 bg-blue-50"
                : "border-slate-200 bg-slate-50"
            }`}
            key={option.mode}
          >
            <input
              checked={boostMode === option.mode}
              className="mt-1"
              name="boostMode"
              onChange={() => {
                setBoostMode(option.mode);
                if (option.mode === "AUTO") setBudgetMode("DAILY");
              }}
              type="radio"
              value={option.mode}
            />
            <span>
              <span className="block text-sm font-bold text-slate-900">{option.title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="mt-3 text-xs leading-5 text-slate-500">{modeHint}</p>
      {autoNeedsAllow ? (
        <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          Vollautomatik speichern ist möglich, Meta-Writes starten aber erst, wenn der Kill-Switch
          auf „Freigeben / ALLOW“ steht.
        </p>
      ) : null}

      {boostMode !== "OFF" ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {boostMode === "REVIEW" ? (
            <label className="text-sm font-bold text-slate-800">
              Budgetart
              <select
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold"
                onChange={(event) =>
                  setBudgetMode(event.target.value as "DAILY" | "LIFETIME")
                }
                value={effectiveBudgetMode}
              >
                <option value="DAILY">Tagesbudget × Laufzeit</option>
                <option value="LIFETIME">Laufzeitbudget gesamt</option>
              </select>
            </label>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <p className="font-bold text-slate-800">Budgetart</p>
              <p className="mt-1 text-slate-500">Tagesbudget × Laufzeit (für Automatik fest)</p>
            </div>
          )}

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

          {effectiveBudgetMode === "DAILY" ? (
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

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
            <p className="font-bold">Werbeziel</p>
            <p className="mt-1 text-emerald-900/80">
              Interaktionen / Likes (`OUTCOME_ENGAGEMENT` → `POST_ENGAGEMENT`)
            </p>
          </div>

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
      ) : null}

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
        {pending ? "Wird gespeichert …" : "Beitrag-Push-Modus speichern"}
      </button>
    </form>
  );
}
