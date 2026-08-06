"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Save } from "lucide-react";

export type BoostMode = "OFF" | "REVIEW" | "AUTO";
export type BoostAssetScope = "ALL" | "SELECTED";

export type BoostAssetSettingView = {
  metaAssetId: string;
  included: boolean;
  dailyBudgetMinor: number | null;
  durationDays: number | null;
};

export type BoostEligibleAssetView = {
  id: string;
  label: string;
  assetType: "facebook_page" | "instagram_account";
};

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
  assetScope: BoostAssetScope;
  assetSettings: BoostAssetSettingView[];
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

type AssetDraft = {
  included: boolean;
  dailyBudget: string;
  durationDays: string;
};

type Props = {
  settings: BoostSettingsView | null;
  eligibleAssets: BoostEligibleAssetView[];
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
      "Jeder neue Beitrag (laut Quellenfilter und Asset-Auswahl) wird mit dem festgelegten Tagesbudget und Zeitraum automatisch beworben.",
  },
];

const SOURCE_OPTIONS: Array<{
  value: BoostSettingsView["sourceFilter"];
  title: string;
}> = [
  { value: "facebook", title: "Nur Facebook" },
  { value: "instagram", title: "Nur Instagram" },
  { value: "both", title: "Facebook und Instagram" },
];

const SCOPE_OPTIONS: Array<{
  value: BoostAssetScope;
  title: string;
  description: string;
}> = [
  {
    value: "ALL",
    title: "Alle verbundenen Assets",
    description:
      "Neue Beiträge aller verbundenen Facebook-Seiten und Instagram-Konten werden berücksichtigt.",
  },
  {
    value: "SELECTED",
    title: "Nur ausgewählte Assets",
    description:
      "Nur Beiträge der unten markierten Seiten und Konten werden vorbereitet oder automatisch beworben.",
  },
];

function initialAssetDrafts(
  assets: BoostEligibleAssetView[],
  settings: BoostSettingsView | null,
): Record<string, AssetDraft> {
  const byId = new Map(
    (settings?.assetSettings ?? []).map((row) => [row.metaAssetId, row]),
  );
  const drafts: Record<string, AssetDraft> = {};
  for (const asset of assets) {
    const row = byId.get(asset.id);
    drafts[asset.id] = {
      included: row?.included ?? (settings?.assetScope !== "SELECTED"),
      dailyBudget:
        row?.dailyBudgetMinor != null
          ? minorToEuroInput(row.dailyBudgetMinor, "")
          : "",
      durationDays: row?.durationDays != null ? String(row.durationDays) : "",
    };
  }
  return drafts;
}

export function AutomationBoostSettings({
  settings,
  eligibleAssets,
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
  const [sourceFilter, setSourceFilter] = useState<BoostSettingsView["sourceFilter"]>(
    settings?.sourceFilter ?? "both",
  );
  const [assetScope, setAssetScope] = useState<BoostAssetScope>(
    settings?.assetScope ?? "ALL",
  );
  const [assetDrafts, setAssetDrafts] = useState<Record<string, AssetDraft>>(() =>
    initialAssetDrafts(eligibleAssets, settings),
  );

  const effectiveBudgetMode = boostMode === "AUTO" ? "DAILY" : budgetMode;
  const autoNeedsAllow = boostMode === "AUTO" && killSwitchMode !== "ALLOW";

  const modeHint = useMemo(() => {
    if (boostMode === "AUTO") {
      return "Werbeziel: Interaktionen/Likes. Erkannte Beiträge werden ohne weiteren Abruf beworben, sobald die Sicherheitsschranke oben auf „Freigeben“ steht und gespeichert ist.";
    }
    if (boostMode === "REVIEW") {
      return "Neue Beiträge erscheinen zur Freigabe. Erst nach „BEITRAG BEWERBEN“ schreibt Adbot zu Meta.";
    }
    return "Kein Boost-Plan wird erzeugt.";
  }, [boostMode]);

  function updateAssetDraft(assetId: string, patch: Partial<AssetDraft>) {
    setAssetDrafts((current) => ({
      ...current,
      [assetId]: {
        ...(current[assetId] ?? { included: false, dailyBudget: "", durationDays: "" }),
        ...patch,
      },
    }));
  }

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
          sourceFilter,
          defaultCountries: ["DE"],
          defaultCtaType: ctaType.trim() ? ctaType.trim().toUpperCase() : null,
          defaultDestinationUrl: destinationUrl.trim() || null,
          assetScope,
          assetSettings: eligibleAssets.map((asset) => {
            const draft = assetDrafts[asset.id] ?? {
              included: assetScope === "ALL",
              dailyBudget: "",
              durationDays: "",
            };
            return {
              metaAssetId: asset.id,
              included: assetScope === "ALL" ? true : draft.included,
              dailyBudgetMinor: draft.dailyBudget.trim() || null,
              durationDays: draft.durationDays.trim()
                ? Number(draft.durationDays)
                : null,
            };
          }),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        organicBoost?: {
          status?: string;
          plansCreated?: number;
          plansExisting?: number;
          candidatesConsidered?: number;
          lastError?: string | null;
        } | null;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.message ?? "Die Beitrag-Push-Einstellungen konnten nicht gespeichert werden.",
        );
      }
      const boost = result.organicBoost;
      const ready =
        (boost?.plansCreated ?? 0) + (boost?.plansExisting ?? 0);
      const boostFollowUp =
        boostMode === "AUTO" && killSwitchMode === "ALLOW"
          ? ready > 0
            ? ` ${ready} Boost-Plan/Pläne angelegt — Bewerbung startet ohne Extra-Klick.`
            : boost?.lastError
              ? ` Planner: ${boost.status ?? "Fehler"} · ${boost.lastError}`
              : boost?.status
                ? ` Planner-Status: ${boost.status}.`
                : " Erkannte Beiträge werden jetzt ohne Extra-Klick beworben."
          : "";
      setNotice({
        tone: "success",
        message:
          boostMode === "AUTO"
            ? killSwitchMode === "ALLOW"
              ? `Vollautomatik gespeichert.${boostFollowUp}`
              : "Vollautomatik gespeichert. Noch kein automatischer Boost: Oben bei der Sicherheitsschranke „Freigeben“ wählen und auf „Freigabe speichern“ klicken."
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
          <h3 className="font-extrabold">Beitrag-Push</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Neue organische Beiträge erkennen und mit Fixed Budget bewerben. Standard-Werbeziel:
            Interaktionen/Likes. Keine neuen Werbemittel nötig — der organische Beitrag selbst wird
            beworben.
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
                if (option.mode === "AUTO") {
                  setBudgetMode("DAILY");
                  // Vollautomatik bewirbt FB + IG, sofern nicht bewusst eingeschränkt.
                  if (sourceFilter === "facebook") {
                    setSourceFilter("both");
                  }
                }
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
        <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-950">
          Fast fertig: Vollautomatik kannst du schon speichern. Automatische Werbung startet
          aber erst, wenn du oben bei der Sicherheitsschranke{" "}
          <strong>Freigeben</strong> auswählst und auf{" "}
          <strong>Freigabe speichern</strong> klickst. Nur auswählen reicht nicht.
        </p>
      ) : null}

      {boostMode !== "OFF" ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-bold text-slate-800">Quellen</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {SOURCE_OPTIONS.map((option) => (
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    sourceFilter === option.value
                      ? "border-blue-300 bg-blue-50 text-slate-900"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                  key={option.value}
                >
                  <input
                    checked={sourceFilter === option.value}
                    name="sourceFilter"
                    onChange={() => setSourceFilter(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  {option.title}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-bold text-slate-800">Welche Assets?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {SCOPE_OPTIONS.map((option) => (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                    assetScope === option.value
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                  key={option.value}
                >
                  <input
                    checked={assetScope === option.value}
                    className="mt-1"
                    name="assetScope"
                    onChange={() => setAssetScope(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span>
                    <span className="block text-sm font-bold text-slate-900">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {eligibleAssets.length ? (
            <div className="sm:col-span-2 space-y-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {assetScope === "SELECTED"
                    ? "Assets auswählen"
                    : "Optionale Werte je Asset"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {assetScope === "SELECTED"
                    ? "Markiere die Seiten und Konten, deren Beiträge gepusht werden sollen. Tagesbudget und Laufzeit je Asset sind optional und ersetzen dann die globalen Werte."
                    : "Leer lassen = globale Werte unten. Nur ausfüllen, wenn eine Seite oder ein Konto abweichend laufen soll."}
                </p>
              </div>
              {eligibleAssets.map((asset) => {
                const draft = assetDrafts[asset.id] ?? {
                  included: assetScope === "ALL",
                  dailyBudget: "",
                  durationDays: "",
                };
                return (
                  <div
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                    key={asset.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {assetScope === "SELECTED" ? (
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-900">
                          <input
                            checked={draft.included}
                            onChange={(event) =>
                              updateAssetDraft(asset.id, {
                                included: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          {asset.label}
                        </label>
                      ) : (
                        <p className="text-sm font-bold text-slate-900">{asset.label}</p>
                      )}
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                        {asset.assetType === "facebook_page" ? "Facebook" : "Instagram"}
                      </span>
                    </div>
                    {(assetScope === "ALL" || draft.included) &&
                    effectiveBudgetMode === "DAILY" ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-bold text-slate-700">
                          Tagesbudget (optional)
                          <span className="relative mt-1.5 block">
                            <input
                              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 pr-12 text-sm font-semibold"
                              inputMode="decimal"
                              onChange={(event) =>
                                updateAssetDraft(asset.id, {
                                  dailyBudget: event.target.value,
                                })
                              }
                              placeholder={dailyBudget || "wie global"}
                              value={draft.dailyBudget}
                            />
                            <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                              EUR
                            </span>
                          </span>
                        </label>
                        <label className="text-xs font-bold text-slate-700">
                          Laufzeit in Tagen (optional)
                          <input
                            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold"
                            max={90}
                            min={1}
                            onChange={(event) =>
                              updateAssetDraft(asset.id, {
                                durationDays: event.target.value,
                              })
                            }
                            placeholder={durationDays || "wie global"}
                            type="number"
                            value={draft.durationDays}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="sm:col-span-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Noch keine Facebook-Seiten oder Instagram-Konten verbunden. Verbinde zuerst Meta-
              Assets, dann kannst du den Umfang festlegen.
            </p>
          )}

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
            Laufzeit (Tage) — global
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
              Tagesbudget — global
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
              Laufzeitbudget — global
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
