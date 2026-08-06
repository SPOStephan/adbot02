"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

type MetaSyncButtonProps = {
  lastSyncStartedAt: string | null;
  reconnectRequired?: boolean;
};

type OrganicBoostResponse = {
  status?: string | null;
  plansCreated?: number;
  plansExisting?: number;
  candidatesFailed?: number;
  candidatesSkipped?: number;
  candidatesConsidered?: number;
  lastError?: string | null;
};

type SyncResponse = {
  ok?: boolean;
  error?: string;
  status?: string;
  newCount?: number;
  retryAt?: string | null;
  organicBoost?: OrganicBoostResponse | null;
};

const MANUAL_COOLDOWN_SECONDS = 60;

function safeJson(response: Response): Promise<SyncResponse> {
  return response.json().catch(() => ({})) as Promise<SyncResponse>;
}

function initialRetryAt(lastSyncStartedAt: string | null): string | null {
  if (!lastSyncStartedAt) {
    return null;
  }

  const startedAt = new Date(lastSyncStartedAt).getTime();

  if (!Number.isFinite(startedAt)) {
    return null;
  }

  return new Date(startedAt + MANUAL_COOLDOWN_SECONDS * 1000).toISOString();
}

function organicBoostNotice(boost: OrganicBoostResponse | null | undefined): string | null {
  if (!boost || !boost.status) {
    return "Beitrag-Push: beim Abruf nicht gelaufen (Lease/SQL prüfen).";
  }

  const created = boost.plansCreated ?? 0;
  const existing = boost.plansExisting ?? 0;
  const failed = boost.candidatesFailed ?? 0;
  const skipped = boost.candidatesSkipped ?? 0;
  const considered = boost.candidatesConsidered ?? 0;
  const error = boost.lastError?.trim();

  if (created + existing > 0) {
    return `Beitrag-Push: ${created + existing} Bewerbung(en) angelegt/übernommen.`;
  }

  if (boost.status === "MATERIALIZE_FAILED" || failed > 0) {
    return error
      ? `Beitrag-Push fehlgeschlagen: ${error}`
      : "Beitrag-Push fehlgeschlagen beim Anlegen der Meta-Kampagne.";
  }

  if (boost.status === "STALE_OR_INVALID_SNAPSHOT") {
    return "Beitrag-Push: kein gültiger Budget-Snapshot — SQL-Migration 20260806150000 prüfen.";
  }

  if (boost.status === "NO_ACTIVE_POLICY") {
    return "Beitrag-Push: Autonomie nicht aktiv (Launches + Statusänderungen).";
  }

  if (boost.status === "ACCOUNT_UNAVAILABLE") {
    return "Beitrag-Push: Konto/Scope nicht bereit (EUR + ads_management).";
  }

  if (boost.status === "DISABLED") {
    return "Beitrag-Push: Einstellungen nicht auf Vollautomatisch aktiv.";
  }

  if (boost.status === "NO_ELIGIBLE_CANDIDATES" || considered === 0) {
    return "Beitrag-Push: keine passenden neuen Beiträge (Filter/Assets).";
  }

  if (skipped > 0) {
    return error
      ? `Beitrag-Push übersprungen: ${error}`
      : `Beitrag-Push: ${skipped} Beitrag(e) übersprungen.`;
  }

  return `Beitrag-Push-Status: ${boost.status}`;
}

export function MetaSyncButton({
  lastSyncStartedAt,
  reconnectRequired = false,
}: MetaSyncButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(0);
  const [retryAt, setRetryAt] = useState<string | null>(() =>
    initialRetryAt(lastSyncStartedAt),
  );
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  const retryTimestamp = retryAt ? new Date(retryAt).getTime() : 0;
  const remainingSeconds =
    now > 0 && Number.isFinite(retryTimestamp)
      ? Math.max(0, Math.ceil((retryTimestamp - now) / 1000))
      : 0;
  const cooldownActive = remainingSeconds > 0;
  const disabled = loading || cooldownActive || reconnectRequired;

  async function handleSync() {
    setLoading(true);
    setNotice(null);

    try {
      const response = await fetch("/api/connectors/meta/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      });
      const body = await safeJson(response);

      if (!response.ok || !body.ok) {
        if (body.retryAt) {
          setRetryAt(body.retryAt);
        }

        const boostHint = organicBoostNotice(body.organicBoost);
        const message =
          body.error === "cooldown"
            ? "Der letzte Abruf ist noch zu frisch. Bitte kurz warten."
            : body.error === "locked"
              ? "Ein Abruf läuft bereits. Der Status wird gleich aktualisiert."
              : body.error === "backoff"
                ? "Meta bittet um eine kurze Pause. Der nächste Abruf ist bereits geplant."
                : body.status === "reconnect_required"
                  ? "Die Meta-Verbindung muss erneuert werden."
                  : body.status === "rate_limited"
                    ? `Meta-Nutzungslimit erreicht.${boostHint ? ` ${boostHint}` : ""}`
                    : "Neue Beiträge konnten gerade nicht abgerufen werden.";
        setNotice({ kind: "error", text: message });
        router.refresh();
        return;
      }

      const newCount = body.newCount ?? 0;
      setRetryAt(
        new Date(Date.now() + MANUAL_COOLDOWN_SECONDS * 1000).toISOString(),
      );
      const contentText =
        newCount === 1
          ? "1 neuer Beitrag wurde gefunden."
          : newCount > 1
            ? `${newCount} neue Beiträge wurden gefunden.`
            : "Abruf abgeschlossen. Es gibt aktuell keine neuen Beiträge.";
      const boostText = organicBoostNotice(body.organicBoost);
      const boostOk =
        (body.organicBoost?.plansCreated ?? 0) +
          (body.organicBoost?.plansExisting ?? 0) >
        0;
      setNotice({
        kind: boostOk || !body.organicBoost?.status ? "success" : "error",
        text: boostText ? `${contentText} ${boostText}` : contentText,
      });
      router.refresh();
    } catch {
      setNotice({
        kind: "error",
        text: "Der Abruf ist gerade nicht erreichbar. Bitte später erneut versuchen.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
        disabled={disabled}
        onClick={handleSync}
        type="button"
      >
        <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        {loading
          ? "Beiträge werden abgerufen …"
          : reconnectRequired
            ? "Verbindung erneuern"
            : cooldownActive
              ? `Erneut in ${remainingSeconds} s`
              : "Neue Beiträge abrufen"}
      </button>

      {notice ? (
        <p
          aria-live="polite"
          className={`flex items-start gap-1.5 text-sm ${
            notice.kind === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          )}
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
