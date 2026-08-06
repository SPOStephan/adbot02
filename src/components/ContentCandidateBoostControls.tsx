"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, ChevronUp, Play, Save } from "lucide-react";

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

type BoostMode = "OFF" | "REVIEW" | "AUTO";

type Props = {
  candidateId: string;
  source: "facebook" | "instagram";
  override: ContentBoostOverrideView | null;
  heldPlan: HeldOrganicBoostPlanView | null;
  canPrepare: boolean;
  canApprove: boolean;
  boostMode: BoostMode;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED" | null;
  policyActive: boolean;
};

function minorToEuro(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return (value / 100).toFixed(2);
}

function statusCopy(input: {
  boostMode: BoostMode;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED" | null;
  policyActive: boolean;
  heldPlan: HeldOrganicBoostPlanView | null;
  overrideMode: "INHERIT" | "SKIP" | "BOOST";
}) {
  if (input.overrideMode === "SKIP") {
    return {
      tone: "neutral" as const,
      title: "Wird nicht beworben",
      body: "Für diesen Beitrag ist eine Ausnahme gesetzt: kein Boost.",
    };
  }

  if (input.heldPlan) {
    const plan = input.heldPlan.status.toUpperCase();
    if (plan === "SUCCEEDED" || plan === "RECONCILED") {
      return {
        tone: "success" as const,
        title: "Boost aktiv",
        body: "Für diesen Beitrag läuft ein Beitrag-Push. Details siehst du unter Kampagnen.",
      };
    }
    if (plan === "PENDING" || plan === "RETRYABLE" || plan === "RUNNING" || plan === "CLAIMED") {
      return {
        tone: "amber" as const,
        title: "Boost wird gestartet",
        body: "Der Push-Plan ist angelegt. Adbot schreibt gerade an Meta bzw. wartet auf die Auslieferung.",
      };
    }
    return {
      tone: "amber" as const,
      title: "Boost vorbereitet",
      body: "Der Plan liegt bereit. Nach Freigabe schreibt Adbot die Kampagne an Meta.",
    };
  }

  if (input.boostMode === "OFF") {
    return {
      tone: "neutral" as const,
      title: "Nur erkannt",
      body: "Beitrag-Push ist aus. Beiträge werden gespeichert, aber nicht beworben.",
    };
  }

  if (!input.policyActive) {
    return {
      tone: "amber" as const,
      title: "Autonomie fehlt",
      body: "Aktiviere zuerst die Autonomie für dieses Werbekonto, damit Boosts starten können.",
    };
  }

  if (input.boostMode === "AUTO") {
    if (input.killSwitchMode !== "ALLOW") {
      return {
        tone: "amber" as const,
        title: "Automatischer Boost wartet",
        body: "Vollautomatik ist an. Noch blockiert: oben Sicherheitsschranke auf „Freigeben“ stellen und speichern.",
      };
    }
    return {
      tone: "amber" as const,
      title: "Boost noch nicht gestartet",
      body: "Einstellungen sind bereit. Für diesen Beitrag gibt es noch keinen Push-Plan — er erscheint unter Kampagnen, sobald der Boost wirklich gestartet wurde.",
    };
  }

  // REVIEW
  return {
    tone: "amber" as const,
    title: "Zur Freigabe",
    body: "Beitrag erkannt. Mit „Boost vorbereiten“ und anschließender Freigabe startet die Bewerbung.",
  };
}

export function ContentCandidateBoostControls({
  candidateId,
  source,
  override,
  heldPlan,
  canPrepare,
  canApprove,
  boostMode,
  killSwitchMode,
  policyActive,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
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

  const status = statusCopy({
    boostMode,
    killSwitchMode,
    policyActive,
    heldPlan: preparedPlan,
    overrideMode: mode,
  });

  const statusClass =
    status.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : status.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-slate-200 bg-white text-slate-800";

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
        throw new Error(result.message ?? "Anpassung konnte nicht gespeichert werden.");
      }
      setNotice("Anpassung gespeichert.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Anpassung fehlgeschlagen.",
      );
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
      <div className={`rounded-lg border px-3 py-3 ${statusClass}`}>
        <p className="text-sm font-extrabold">{status.title}</p>
        <p className="mt-1 text-xs leading-5 opacity-90">{status.body}</p>
      </div>

      {boostMode === "REVIEW" && !preparedPlan && mode !== "SKIP" ? (
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 disabled:opacity-50"
          disabled={pending !== null || !canPrepare}
          onClick={() => void prepareBoost()}
          type="button"
        >
          <Play className="size-3.5" />
          Boost vorbereiten
        </button>
      ) : null}

      {preparedPlan && boostMode !== "AUTO" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-950">
            Freigabe für diesen Beitrag
          </p>
          <label className="mt-3 block text-xs font-bold text-amber-950">
            Kurze Begründung
            <input
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
              onChange={(event) => setApprovalReason(event.target.value)}
              placeholder="Warum dieser Beitrag jetzt beworben wird"
              value={approvalReason}
            />
          </label>
          <label className="mt-2 block text-xs font-bold text-amber-950">
            Zur Bestätigung tippe: BEITRAG BEWERBEN
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

      <button
        className="inline-flex min-h-9 items-center gap-1.5 text-xs font-bold text-slate-600 underline-offset-2 hover:text-slate-950 hover:underline"
        onClick={() => setShowDetails((value) => !value)}
        type="button"
      >
        {showDetails ? (
          <ChevronUp className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
        {showDetails ? "Anpassungen ausblenden" : "Details anpassen"}
      </button>

      {showDetails ? (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <p className="text-xs leading-5 text-slate-500">
            Optional nur für diesen Beitrag: überspringen oder Budget/Laufzeit abweichend setzen.
            Leer lassen = Konto-Standards.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-700">
              Ausnahme für diesen Beitrag
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                onChange={(event) =>
                  setMode(event.target.value as "INHERIT" | "SKIP" | "BOOST")
                }
                value={mode}
              >
                <option value="INHERIT">Konto-Standards verwenden</option>
                <option value="BOOST">Mit eigenen Werten bewerben</option>
                <option value="SKIP">Nicht bewerben</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700">
              Budget abweichend
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                onChange={(event) =>
                  setBudgetMode(event.target.value as "DAILY" | "LIFETIME" | "")
                }
                value={budgetMode}
              >
                <option value="">Wie Konto-Standard</option>
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
              Laufzeit abweichend (Tage)
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
              Anpassung speichern
            </button>
            {boostMode === "REVIEW" ? (
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 disabled:opacity-50"
                disabled={pending !== null || !canPrepare}
                onClick={() => void prepareBoost()}
                type="button"
              >
                <Play className="size-3.5" />
                Boost vorbereiten
              </button>
            ) : null}
            {mode === "SKIP" ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                <Ban className="size-3.5" /> Wird nicht beworben
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="text-xs font-semibold text-slate-700" role="status">
          {notice}
        </p>
      ) : null}

      {source === "instagram" && boostMode === "REVIEW" ? (
        <p className="text-[11px] leading-5 text-slate-500">
          Instagram-Beiträge können wie Facebook-Beiträge beworben werden, sofern das Konto an eine
          Facebook-Seite gekoppelt ist.
        </p>
      ) : null}
    </div>
  );
}
