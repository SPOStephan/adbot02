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
      const response = await fetch("/api/meta/automation/organic-boost/plan", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const body = (await response.json().catch(() => ({}))) as {
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
      if (!response.ok || body.ok !== true) {
        throw new Error(
          body.message ?? "Beitrag-Push konnte nicht gestartet werden.",
        );
      }
      const created =
        (body.organicBoost?.plansCreated ?? 0) +
        (body.organicBoost?.plansExisting ?? 0);
      const status = body.organicBoost?.status ?? "unbekannt";
      const error = body.organicBoost?.lastError?.trim();
      const written = body.organicBoost?.executorSucceeded ?? 0;
      const execFailed = body.organicBoost?.executorFailed ?? 0;
      const drainError = body.organicBoost?.executorLastError?.trim();
      setNotice(
        created > 0
          ? written > 0
            ? `${created} Plan/Pläne bereit, ${written} bereits an Meta gesendet.`
            : execFailed > 0
              ? `${created} Plan/Pläne bereit, Meta-Versand fehlgeschlagen (${body.organicBoost?.executorLastOutcome ?? "Fehler"}${drainError ? `: ${drainError}` : ""}).`
              : drainError
                ? `${created} Plan/Pläne bereit, Meta-Versand blockiert (${drainError}).`
                : `${created} Boost-Plan/Pläne angelegt (Status ${status}). Meta-Versand folgt automatisch.`
          : error
            ? `Kein Plan angelegt (${status}): ${error}`
            : `Kein Plan angelegt (Status ${status}, geprüft: ${body.organicBoost?.candidatesConsidered ?? 0}, übersprungen: ${body.organicBoost?.candidatesSkipped ?? 0}, fehlgeschlagen: ${body.organicBoost?.candidatesFailed ?? 0}).`,
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
