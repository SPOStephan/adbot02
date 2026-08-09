"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import {
  formatHardCapResumeNotice,
  type HardCapForceResumeNoticeInput,
  type HardCapStatusDrainNoticeInput,
} from "@/lib/meta/hard-cap-resume-notice";

type Props = {
  label?: string;
};

export function OrganicBoostPlanButton({
  label = "Manuell erneut prüfen",
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setNotice(null);
    try {
      window.sessionStorage.removeItem("adbot.organicBoostAutoPlan.v1");
      window.sessionStorage.removeItem("adbot.organicBoostAutoPlan.v2");
      const planResponse = await fetch(
        "/api/meta/automation/organic-boost/plan",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      const planBody = (await planResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        organicBoost?: {
          status?: string;
          plansCreated?: number;
          plansExisting?: number;
          candidatesConsidered?: number;
          candidatesFailed?: number;
          candidatesSkipped?: number;
          lastError?: string | null;
          executorRuns?: number;
          executorSucceeded?: number;
          executorFailed?: number;
          executorLastOutcome?: string | null;
          executorLastError?: string | null;
        };
      };
      if (!planResponse.ok || planBody.ok !== true) {
        throw new Error(
          planBody.message ?? "Beitrag-Push konnte nicht gestartet werden.",
        );
      }

      const executeResponse = await fetch(
        "/api/meta/automation/organic-boost/execute",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
      const executeBody = (await executeResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        marketingSync?: {
          outcome?: string;
          status?: string;
          blockedReason?: string | null;
          insightsCount?: number;
          campaignsCount?: number;
          spendTotal?: number;
          insightsUntil?: string | null;
          retryAt?: string | null;
        } | null;
        marketingSyncError?: string | null;
        hardCapForceResume?: HardCapForceResumeNoticeInput | null;
        hardCapStatus?: HardCapStatusDrainNoticeInput | null;
        drain?: {
          duePlans?: number;
          runs?: number;
          succeeded?: number;
          failed?: number;
          lastOutcome?: string | null;
          lastError?: string | null;
          prepareDetail?: string | null;
          preflightOkCount?: number | null;
        };
      };

      if (!executeResponse.ok || executeBody.ok !== true) {
        throw new Error(
          executeBody.message ?? "Beitrag-Push-Execute fehlgeschlagen.",
        );
      }

      const created =
        (planBody.organicBoost?.plansCreated ?? 0) +
        (planBody.organicBoost?.plansExisting ?? 0);
      const written =
        executeBody.drain?.succeeded ??
        planBody.organicBoost?.executorSucceeded ??
        0;
      const execFailed =
        executeBody.drain?.failed ??
        planBody.organicBoost?.executorFailed ??
        0;
      const drainError =
        executeBody.drain?.lastError?.trim() ||
        planBody.organicBoost?.executorLastError?.trim() ||
        null;
      const prepare = executeBody.drain?.prepareDetail?.trim();
      const status = planBody.organicBoost?.status ?? "unbekannt";
      const error = planBody.organicBoost?.lastError?.trim();

      const sync = executeBody.marketingSync;
      const syncOk =
        sync?.outcome === "completed" &&
        (sync.status === "success" || sync.status === "partial");
      const syncBlocked =
        sync?.outcome === "blocked" || executeBody.marketingSyncError;

      let syncNotice: string | null = null;
      if (syncOk) {
        const spend = Number(sync?.spendTotal);
        const spendLabel = Number.isFinite(spend)
          ? new Intl.NumberFormat("de-DE", {
              style: "currency",
              currency: "EUR",
              maximumFractionDigits: 2,
            }).format(spend)
          : "—";
        const untilLabel = sync?.insightsUntil
          ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(
              new Date(`${sync.insightsUntil}T12:00:00Z`),
            )
          : null;
        syncNotice = `Meta-Kennzahlen aktualisiert (Abruf: ${sync?.insightsCount ?? 0} Insights, Summe ${spendLabel}${untilLabel ? `, Fenster bis ${untilLabel}` : ""}).`;
        if (Number.isFinite(spend) && spend <= 0) {
          syncNotice +=
            " Noch keine positive Spend-Zeile von Meta — Ampel nutzt zusätzlich Kampagnen-Insights und Budgetrest. In 1–2 Min. erneut prüfen.";
        }
      } else if (sync?.blockedReason === "manual_cooldown" || sync?.retryAt) {
        syncNotice =
          "Kampagnenstand: Abruf kurz im Cooldown — Reaktivierung läuft trotzdem mit dem letzten Stand.";
      } else if (syncBlocked) {
        syncNotice = `Kennzahlen-Abruf blockiert (${executeBody.marketingSyncError ?? sync?.blockedReason ?? sync?.status ?? "unbekannt"}).`;
      }

      const resumeNotice = formatHardCapResumeNotice(
        executeBody.hardCapForceResume,
        executeBody.hardCapStatus,
      );

      const idleOnly =
        drainError === "claim_idle_with_due_plans" ||
        drainError === "lease_busy_with_due_plans";

      const launchNotice =
        written > 0
          ? `Neue Bewerbung: ${written} Plan/Pläne an Meta gesendet.`
          : execFailed > 0
            ? `Meta hat neue Bewerbung abgelehnt (${executeBody.drain?.lastOutcome ?? "failed"}${drainError ? `: ${drainError}` : ""}).`
            : idleOnly
              ? null
              : drainError && !idleOnly
                ? `Kein Meta-Kontakt für neue Bewerbung (${drainError}${prepare ? ` · ${prepare}` : ""}).`
                : created > 0
                  ? `Neue Bewerbung bereit — kein neuer Versand nötig.${prepare ? ` (${prepare})` : ""}`
                  : error
                    ? `Kein neuer Plan (${status}): ${error}`
                    : null;

      const parts = [resumeNotice, launchNotice, syncNotice].filter(
        (part): part is string => Boolean(part),
      );

      setNotice(
        parts.length > 0
          ? parts.join(" ")
          : `Geprüft (Status ${status}) — keine Aktion nötig.`,
      );
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Beitrag-Push konnte nicht gestartet werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50"
        disabled={pending}
        onClick={() => void onClick()}
        type="button"
      >
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Aktualisiert …" : label}
      </button>
      {notice ? (
        <p className="text-xs font-semibold leading-5 text-slate-700" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
