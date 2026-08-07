"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

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

      const created =
        (planBody.organicBoost?.plansCreated ?? 0) +
        (planBody.organicBoost?.plansExisting ?? 0);
      const written = executeBody.drain?.succeeded ??
        planBody.organicBoost?.executorSucceeded ??
        0;
      const execFailed = executeBody.drain?.failed ??
        planBody.organicBoost?.executorFailed ??
        0;
      const drainError =
        executeBody.drain?.lastError?.trim() ||
        planBody.organicBoost?.executorLastError?.trim() ||
        null;
      const prepare = executeBody.drain?.prepareDetail?.trim();
      const status = planBody.organicBoost?.status ?? "unbekannt";
      const error = planBody.organicBoost?.lastError?.trim();

      setNotice(
        written > 0
          ? `Meta-Kontakt: ${written} Plan/Pläne gesendet.`
          : execFailed > 0
            ? `Meta hat abgelehnt (${executeBody.drain?.lastOutcome ?? "failed"}${drainError ? `: ${drainError}` : ""}).`
            : drainError
              ? `Kein Meta-Kontakt (${drainError}${prepare ? ` · ${prepare}` : ""}).`
              : created > 0
                ? `Pläne bereit, aber kein Meta-Kontakt${prepare ? ` (${prepare})` : ""}.`
                : error
                  ? `Kein Plan angelegt (${status}): ${error}`
                  : `Kein Plan angelegt (Status ${status}).`,
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
        {pending ? "Startet …" : label}
      </button>
      {notice ? (
        <p className="text-xs font-semibold leading-5 text-slate-700" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
