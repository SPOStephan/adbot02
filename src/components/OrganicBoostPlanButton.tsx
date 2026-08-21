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

type CandidateDiagnosis = {
  isNewCount?: number;
  alreadyLinkedCount?: number;
  sourceFilteredOut?: number;
  assetFilteredOut?: number;
  skipOverrideCount?: number;
  eligibleCount?: number;
  sourceFilter?: string | null;
  assetScope?: string | null;
  boostEnabled?: boolean | null;
  autoBoostNewCandidates?: boolean | null;
  boostMode?: string | null;
};

function noPlanReason(input: {
  status: string;
  error: string | null;
  considered: number;
  failed: number;
  skipped: number;
  diagnosis: CandidateDiagnosis | null;
}): string {
  const d = input.diagnosis;
  const bits: string[] = [];
  if (d) {
    bits.push(`is_new=${d.isNewCount ?? "?"}`);
    bits.push(`bereits_verknüpft=${d.alreadyLinkedCount ?? "?"}`);
    bits.push(`passend=${d.eligibleCount ?? "?"}`);
    if ((d.sourceFilteredOut ?? 0) > 0) {
      bits.push(`quellenfilter_raus=${d.sourceFilteredOut}`);
    }
    if ((d.assetFilteredOut ?? 0) > 0) {
      bits.push(`asset_raus=${d.assetFilteredOut}`);
    }
    if ((d.skipOverrideCount ?? 0) > 0) {
      bits.push(`skip=${d.skipOverrideCount}`);
    }
    if (d.sourceFilter) bits.push(`quellenfilter=${d.sourceFilter}`);
    if (d.assetScope) bits.push(`assets=${d.assetScope}`);
    if (d.boostMode) bits.push(`modus=${d.boostMode}`);
    if (d.boostEnabled === false) bits.push("boost=aus");
    if (d.autoBoostNewCandidates === false) bits.push("auto_boost=aus");
  }
  bits.push(`geprüft=${input.considered}`);
  bits.push(`fehlgeschlagen=${input.failed}`);
  bits.push(`übersprungen=${input.skipped}`);

  const detail = bits.join(", ");
  if (input.status === "DISABLED" || d?.boostEnabled === false) {
    return `Kein Plan angelegt: Beitrag-Push nicht aktiv [${detail}]`;
  }
  if (d?.autoBoostNewCandidates === false) {
    return `Kein Plan angelegt: Auto-Boost für neue Beiträge ist aus [${detail}]`;
  }
  if (input.error) {
    return `Kein Plan angelegt (${input.status}): ${input.error} [${detail}]`;
  }
  if ((d?.eligibleCount ?? 0) === 0 || input.status === "NO_ELIGIBLE_CANDIDATES") {
    if ((d?.sourceFilteredOut ?? 0) > 0) {
      return `Kein Plan angelegt: Quellenfilter schließt die neuen Beiträge aus [${detail}]`;
    }
    if ((d?.assetFilteredOut ?? 0) > 0) {
      return `Kein Plan angelegt: Asset-Auswahl schließt die neuen Beiträge aus [${detail}]`;
    }
    if ((d?.alreadyLinkedCount ?? 0) > 0 && (d?.isNewCount ?? 0) > 0) {
      return `Kein Plan angelegt: neue Beiträge sind bereits mit einer Kampagne verknüpft [${detail}]`;
    }
    return `Kein Plan angelegt: keine passenden Beitragskandidaten für die aktuellen Filter/Einstellungen [${detail}]`;
  }
  if (input.status === "MATERIALIZE_FAILED" || input.failed > 0) {
    return `Kein Plan angelegt: Materialize fehlgeschlagen (${input.status}) [${detail}]`;
  }
  if (input.considered === 0) {
    return `Kein Plan angelegt: Planner hat keine Kandidaten geprüft (${input.status}) [${detail}]`;
  }
  return `Kein Plan angelegt (Status ${input.status}) [${detail}]`;
}

export function OrganicBoostPlanButton({
  label = "Manuell erneut prüfen",
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setNotice(null);
    // Execute (Meta heal) first — plan+full Abruf used to burn the whole 90s
    // budget before any ad ACTIVATE ran.
    const executeController = new AbortController();
    const planController = new AbortController();
    const executeTimeoutId = window.setTimeout(
      () => executeController.abort(),
      75_000,
    );
    const planTimeoutId = window.setTimeout(
      () => planController.abort(),
      60_000,
    );
    let completedExecute: {
      hardCapForceResume?: HardCapForceResumeNoticeInput | null;
      hardCapStatus?: HardCapStatusDrainNoticeInput | null;
    } | null = null;
    try {
      window.sessionStorage.removeItem("adbot.organicBoostAutoPlan.v1");
      window.sessionStorage.removeItem("adbot.organicBoostAutoPlan.v2");
      window.sessionStorage.removeItem("adbot.organicBoostAutoPlan.v3");

      const executeResponse = await fetch(
        "/api/meta/automation/organic-boost/execute",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            skipMarketingSync: true,
            skipDiagnose: true,
          }),
          signal: executeController.signal,
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
          marketingStatus?: string;
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
      completedExecute = {
        hardCapForceResume: executeBody.hardCapForceResume,
        hardCapStatus: executeBody.hardCapStatus,
      };

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
          signal: planController.signal,
        },
      );
      const planBody = (await planResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        marketingSync?: {
          outcome?: string;
          status?: string;
          blockedReason?: string | null;
          insightsCount?: number;
          spendTotal?: number;
          insightsUntil?: string | null;
          marketingStatus?: string;
          retryAt?: string | null;
        } | null;
        marketingSyncError?: string | null;
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
          prepareDetail?: string | null;
          duePlans?: number;
          candidateDiagnosis?: CandidateDiagnosis | null;
        };
      };
      if (!planResponse.ok || planBody.ok !== true) {
        throw new Error(
          planBody.message ?? "Beitrag-Push konnte nicht gestartet werden.",
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
      const duePlans =
        executeBody.drain?.duePlans ?? planBody.organicBoost?.duePlans ?? 0;
      const drainError =
        executeBody.drain?.lastError?.trim() ||
        planBody.organicBoost?.executorLastError?.trim() ||
        null;
      const status = planBody.organicBoost?.status ?? "unbekannt";
      const error = planBody.organicBoost?.lastError?.trim() || null;
      const considered = planBody.organicBoost?.candidatesConsidered ?? 0;
      const failed = planBody.organicBoost?.candidatesFailed ?? 0;
      const skipped = planBody.organicBoost?.candidatesSkipped ?? 0;
      const diagnosis = planBody.organicBoost?.candidateDiagnosis ?? null;

      const sync = planBody.marketingSync ?? executeBody.marketingSync;
      const syncError =
        planBody.marketingSyncError ?? executeBody.marketingSyncError ?? null;
      const marketingOk =
        sync?.marketingStatus === "success" ||
        (sync?.outcome === "completed" &&
          sync?.status === "success" &&
          !syncError);
      const syncBlocked =
        Boolean(syncError) ||
        sync?.outcome === "blocked" ||
        sync?.marketingStatus === "error";

      let syncNotice: string | null = null;
      if (marketingOk) {
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
            " Noch keine positive Spend-Zeile von Meta — Ampel nutzt zusätzlich Kampagnen-Insights und Budgetrest.";
        }
      } else if (
        sync?.blockedReason === "cooldown" ||
        sync?.blockedReason === "manual_cooldown" ||
        (sync?.outcome === "blocked" && Boolean(sync?.retryAt))
      ) {
        syncNotice =
          "Kampagnenstand: Abruf kurz im Cooldown — Reaktivierung läuft trotzdem mit dem letzten Stand.";
      } else if (syncBlocked) {
        syncNotice = `Kennzahlen-Abruf nicht erfolgreich (${syncError ?? sync?.blockedReason ?? sync?.marketingStatus ?? sync?.status ?? "unbekannt"}). Beitrag-Push braucht einen erfolgreichen Kampagnenabruf (EUR + marketing_sync_id).`;
      }

      const resumeNotice = formatHardCapResumeNotice(
        executeBody.hardCapForceResume,
        executeBody.hardCapStatus,
      );

      const idleOnly =
        drainError === "claim_idle_with_due_plans" ||
        drainError === "lease_busy_with_due_plans";

      let launchNotice: string | null = null;
      if (written > 0) {
        launchNotice = `Neue Bewerbung: ${written} Plan/Pläne an Meta gesendet.`;
      } else if (execFailed > 0) {
        launchNotice = `Meta hat neue Bewerbung abgelehnt (${executeBody.drain?.lastOutcome ?? "failed"}${drainError ? `: ${drainError}` : ""}).`;
      } else if (created === 0 && duePlans === 0) {
        // Autonomie/Lease OK but no plan exists — not a Meta contact failure.
        launchNotice = noPlanReason({
          status,
          error,
          considered,
          failed,
          skipped,
          diagnosis,
        });
      } else if (drainError && !idleOnly && duePlans > 0) {
        launchNotice = `Kein Meta-Kontakt trotz fälliger Pläne (${drainError}).`;
      } else if (created > 0 && duePlans === 0) {
        launchNotice =
          "Plan vorhanden, aber nicht fällig/bereits verarbeitet — kein neuer Meta-Versand nötig.";
      } else if (idleOnly) {
        launchNotice = null;
      }

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
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      if (completedExecute) {
        const resumeNotice = formatHardCapResumeNotice(
          completedExecute.hardCapForceResume,
          completedExecute.hardCapStatus,
        );
        const timeoutBit = aborted
          ? "Plan-Schritt Zeitlimit — Meta-Reaktivierung oben ist trotzdem gelaufen."
          : error instanceof Error
            ? error.message
            : "Plan-Schritt fehlgeschlagen.";
        setNotice(
          [resumeNotice, timeoutBit].filter(Boolean).join(" "),
        );
        router.refresh();
      } else {
        setNotice(
          aborted
            ? "Prüfung abgebrochen (Zeitlimit). Bitte erneut versuchen — der Server hat zu lange gebraucht."
            : error instanceof Error
              ? error.message
              : "Beitrag-Push konnte nicht gestartet werden.",
        );
      }
    } finally {
      window.clearTimeout(executeTimeoutId);
      window.clearTimeout(planTimeoutId);
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
