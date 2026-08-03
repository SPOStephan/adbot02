"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Play, Save } from "lucide-react";

export type ContentBoostOverrideView = {
  mode: "INHERIT" | "SKIP" | "BOOST";
  budgetMode: "DAILY" | "LIFETIME" | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  durationDays: number | null;
  ctaType: string | null;
  destinationUrl: string | null;
  clearCta: boolean;
};

export type HeldOrganicBoostPlanView = {
  planId: string;
  payloadHash: string;
  objectStoryId: string;
  budgetMode: "DAILY" | "LIFETIME";
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  durationDays: number;
  destinationUrl: string | null;
  status: string;
};

type Props = {
  candidateId: string;
  source: "facebook" | "instagram";
  override: ContentBoostOverrideView | null;
  heldPlan: HeldOrganicBoostPlanView | null;
  canPrepare: boolean;
  canApprove: boolean;
};

function minorToEuro(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return (value / 100).toFixed(2);
}

export function ContentCandidateBoostControls({
  candidateId,
  source,
  override,
  heldPlan,
  canPrepare,
  canApprove,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"INHERIT" | "SKIP" | "BOOST">(
    override?.mode ?? "INHERIT",
  );
  const [budgetMode, setBudgetMode] = useState<"DAILY" | "LIFETIME" | "">(
    override?.budgetMode ?? "",
  );
  const [dailyBudget, setDailyBudget] = useState(
    minorToEuro(override?.dailyBudgetMinor),
  );
  const [lifetimeBudget, setLifetimeBudget] = useState(
    minorToEuro(override?.lifetimeBudgetMinor),
  );
  const [durationDays, setDurationDays] = useState(
    override?.durationDays ? String(override.durationDays) : "",
  );
  const [ctaType, setCtaType] = useState(override?.ctaType ?? "");
  const [destinationUrl, setDestinationUrl] = useState(
    override?.destinationUrl ?? "",
  );
  const [clearCta, setClearCta] = useState(override?.clearCta ?? false);
  const [approvalReason, setApprovalReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preparedPlan, setPreparedPlan] = useState<HeldOrganicBoostPlanView | null>(
    heldPlan,
  );

  async function saveOverride() {
    setPending("override");
    setNotice(null);
    try {
      const response = await fetch("/api/meta/automation/boost-override", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentCandidateId: candidateId,
          mode,
          budgetMode: budgetMode || null,
          dailyBudgetMinor: budgetMode === "DAILY" ? dailyBudget : null,
          lifetimeBudgetMinor: budgetMode === "LIFETIME" ? lifetimeBudget : null,
          durationDays: durationDays ? Number(durationDays) : null,
          ctaType: clearCta || !ctaType.trim() ? null : ctaType.trim().toUpperCase(),
          destinationUrl: clearCta || !destinationUrl.trim() ? null : destinationUrl.trim(),
          clearCta,
          notes: "",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Override konnte nicht gespeichert werden.");
      }
      setNotice("Override gespeichert.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Override fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  async function prepareBoost() {
    setPending("prepare");
    setNotice(null);
    try {
      const response = await fetch("/api/meta/automation/boost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentCandidateId: candidateId }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || result.ok !== true) {
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Beitrag-Push konnte nicht vorbereitet werden.",
        );
      }
      if (result.outcome === "SKIPPED") {
        setNotice(
          `Übersprungen: ${typeof result.reason === "string" ? result.reason : "nicht boostfähig"}`,
        );
      } else if (typeof result.planId === "string" && typeof result.payloadHash === "string") {
        setPreparedPlan({
          planId: result.planId,
          payloadHash: result.payloadHash,
          objectStoryId: String(result.objectStoryId ?? ""),
          budgetMode: (result.budgetMode as "DAILY" | "LIFETIME") ?? "DAILY",
          dailyBudgetMinor:
            result.dailyBudgetMinor === null || result.dailyBudgetMinor === undefined
              ? null
              : String(result.dailyBudgetMinor),
          lifetimeBudgetMinor:
            result.lifetimeBudgetMinor === null || result.lifetimeBudgetMinor === undefined
              ? null
              : String(result.lifetimeBudgetMinor),
          durationDays: Number(result.durationDays ?? 1),
          destinationUrl:
            result.destinationUrl === null || result.destinationUrl === undefined
              ? null
              : String(result.destinationUrl),
          status: String(result.status ?? "HELD"),
        });
        setNotice("Boost-Plan vorbereitet und wartet auf Freigabe.");
      } else {
        setNotice(`Ergebnis: ${String(result.outcome)}`);
      }
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Vorbereitung fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  async function approveBoost() {
    if (!preparedPlan) return;
    setPending("approve");
    setNotice(null);
    try {
      const response = await fetch("/api/meta/automation/boost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: preparedPlan.planId,
          payloadHash: preparedPlan.payloadHash,
          objectStoryId: preparedPlan.objectStoryId,
          budgetMode: preparedPlan.budgetMode,
          dailyBudgetMinor: preparedPlan.dailyBudgetMinor,
          lifetimeBudgetMinor: preparedPlan.lifetimeBudgetMinor,
          durationDays: preparedPlan.durationDays,
          destinationUrl: preparedPlan.destinationUrl,
          reason: approvalReason,
          confirmation,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Freigabe fehlgeschlagen.");
      }
      setNotice("Beitrag-Push freigegeben. Der Executor darf den Write ausführen.");
      setPreparedPlan(null);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Freigabe fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        Beitrag-Push {source === "instagram" ? "(Instagram erkannt)" : ""}
      </p>
      {source === "instagram" ? (
        <p className="text-xs leading-5 text-amber-800">
          Instagram-Beiträge werden erkannt und können mit Overrides vorbereitet werden.
          Automatisches Bewerben nutzt in Phase&nbsp;1 Facebook-`object_story_id`.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-700">
          Modus
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            onChange={(event) =>
              setMode(event.target.value as "INHERIT" | "SKIP" | "BOOST")
            }
            value={mode}
          >
            <option value="INHERIT">Standards übernehmen</option>
            <option value="BOOST">Mit Overrides bewerben</option>
            <option value="SKIP">Nicht bewerben</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          Budget-Override
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            onChange={(event) =>
              setBudgetMode(event.target.value as "DAILY" | "LIFETIME" | "")
            }
            value={budgetMode}
          >
            <option value="">Kein Override</option>
            <option value="DAILY">Tagesbudget</option>
            <option value="LIFETIME">Laufzeitbudget</option>
          </select>
        </label>
        {budgetMode === "DAILY" ? (
          <label className="text-xs font-bold text-slate-700">
            Tagesbudget (EUR)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              onChange={(event) => setDailyBudget(event.target.value)}
              value={dailyBudget}
            />
          </label>
        ) : null}
        {budgetMode === "LIFETIME" ? (
          <label className="text-xs font-bold text-slate-700">
            Laufzeitbudget (EUR)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              onChange={(event) => setLifetimeBudget(event.target.value)}
              value={lifetimeBudget}
            />
          </label>
        ) : null}
        <label className="text-xs font-bold text-slate-700">
          Laufzeit-Override (Tage)
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            max={90}
            min={1}
            onChange={(event) => setDurationDays(event.target.value)}
            placeholder="Standard"
            type="number"
            value={durationDays}
          />
        </label>
        <label className="text-xs font-bold text-slate-700">
          CTA-Typ
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            disabled={clearCta}
            onChange={(event) => setCtaType(event.target.value)}
            placeholder="LEARN_MORE"
            value={ctaType}
          />
        </label>
        <label className="text-xs font-bold text-slate-700 sm:col-span-2">
          CTA-Linkziel
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            disabled={clearCta}
            onChange={(event) => setDestinationUrl(event.target.value)}
            placeholder="https://…"
            value={destinationUrl}
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
          <input
            checked={clearCta}
            onChange={(event) => setClearCta(event.target.checked)}
            type="checkbox"
          />
          Standard-CTA für diesen Beitrag entfernen
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
          disabled={pending !== null}
          onClick={() => void saveOverride()}
          type="button"
        >
          <Save className="size-3.5" />
          Override speichern
        </button>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 disabled:opacity-50"
          disabled={pending !== null || !canPrepare || source !== "facebook"}
          onClick={() => void prepareBoost()}
          type="button"
        >
          <Play className="size-3.5" />
          Boost vorbereiten
        </button>
        {mode === "SKIP" ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
            <Ban className="size-3.5" /> Wird nicht beworben
          </span>
        ) : null}
      </div>

      {preparedPlan ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-950">
            Gehaltener Plan · {preparedPlan.objectStoryId}
          </p>
          <p className="mt-1 break-all text-[11px] text-amber-900/80">
            Fingerprint: {preparedPlan.payloadHash}
          </p>
          <label className="mt-3 block text-xs font-bold text-amber-950">
            Begründung
            <input
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
              onChange={(event) => setApprovalReason(event.target.value)}
              value={approvalReason}
            />
          </label>
          <label className="mt-2 block text-xs font-bold text-amber-950">
            Bestätigung: BEITRAG BEWERBEN
            <input
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>
          <button
            className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-amber-700 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
            disabled={
              pending !== null
              || !canApprove
              || approvalReason.trim().length < 12
              || confirmation !== "BEITRAG BEWERBEN"
            }
            onClick={() => void approveBoost()}
            type="button"
          >
            Beitrag-Push freigeben
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="text-xs font-semibold text-slate-700" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
