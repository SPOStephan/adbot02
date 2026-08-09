"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";
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

type HardCapForceResumeResponse = {
  outcome?: string;
  created?: number;
  existing?: number;
  blocked?: number;
  revived?: number;
  exposuresCleared?: number;
  scheduleEnded?: number;
  candidates?: number;
  error?: string | null;
};

type HardCapStatusDrainResponse = {
  duePlans?: number;
  runs?: number;
  succeeded?: number;
  failed?: number;
  lastOutcome?: string | null;
  lastError?: string | null;
};

type SyncResponse = {
  ok?: boolean;
  error?: string;
  status?: string;
  newCount?: number;
  retryAt?: string | null;
  organicBoost?: OrganicBoostResponse | null;
  hardCapForceResume?: HardCapForceResumeResponse | null;
  hardCapStatus?: HardCapStatusDrainResponse | null;
};

type NoticeKind = "success" | "info" | "error";

const MANUAL_COOLDOWN_SECONDS = 60;
const SYNC_FETCH_TIMEOUT_MS = 110_000;

const BOOST_FAILURE_STATUSES = new Set([
  "MATERIALIZE_FAILED",
  "PLANNER_RPC_FAILED",
  "STALE_OR_INVALID_SNAPSHOT",
  "ACCOUNT_UNAVAILABLE",
  "LEASE_REQUIRED",
  "INVALID_INPUT",
  "ERROR",
]);

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
    return "Beitrag-Push: beim Abruf nicht gelaufen (läuft unabhängig nach, sobald Freigabe aktiv ist).";
  }

  const created = boost.plansCreated ?? 0;
  const existing = boost.plansExisting ?? 0;
  const failed = boost.candidatesFailed ?? 0;
  const skipped = boost.candidatesSkipped ?? 0;
  const considered =
    typeof boost.candidatesConsidered === "number"
      ? boost.candidatesConsidered
      : null;
  const error = boost.lastError?.trim();

  if (created + existing > 0) {
    return `Beitrag-Push: ${created + existing} Bewerbung(en) angelegt — Meta-Versand folgt automatisch.`;
  }

  if (boost.status === "MATERIALIZE_FAILED" || failed > 0) {
    if (error?.includes("hard cap would be exceeded")) {
      return `Beitrag-Push blockiert: Tageslimit (Autonomie) reicht nicht für die aktuelle Budget-Reserve — oft durch frühere Plan-Versuche oder pausierte Meta-Kampagnen mit Restbudget. Fehler: ${error}`;
    }
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
    if (boost.lastError === "marketing_sync_required") {
      return "Beitrag-Push: wartet auf letzten gültigen Marketing-Stand (startet automatisch).";
    }
    return "Beitrag-Push: Konto/Scope nicht bereit (EUR + ads_management).";
  }

  if (boost.status === "DISABLED") {
    return "Beitrag-Push: Einstellungen nicht auf Vollautomatisch aktiv.";
  }

  if (boost.status === "NO_ELIGIBLE_CANDIDATES") {
    return "Beitrag-Push: keine passenden Beiträge für die aktuellen Filter/Assets.";
  }

  if (considered === 0) {
    return "Beitrag-Push: keine passenden Beiträge für die aktuellen Filter/Assets.";
  }

  if (skipped > 0) {
    return error
      ? `Beitrag-Push übersprungen: ${error}`
      : `Beitrag-Push: ${skipped} Beitrag(e) übersprungen.`;
  }

  if (boost.status === "PLANNED" || boost.status === "OK") {
    return "Beitrag-Push geprüft — keine neue Bewerbung nötig.";
  }

  return `Beitrag-Push-Status: ${boost.status}`;
}

function organicBoostNoticeKind(boost: OrganicBoostResponse | null | undefined): NoticeKind {
  if (!boost?.status) {
    return "info";
  }

  const created = (boost.plansCreated ?? 0) + (boost.plansExisting ?? 0);
  if (created > 0) {
    return "success";
  }

  if (
    BOOST_FAILURE_STATUSES.has(boost.status) ||
    ((boost.candidatesFailed ?? 0) > 0 && created === 0)
  ) {
    return "error";
  }

  // DISABLED / NO_ELIGIBLE / NO_ACTIVE_POLICY / PLANNED with nothing to do
  return "info";
}

function hardCapResumeNotice(
  forceResume: HardCapForceResumeResponse | null | undefined,
  drain: HardCapStatusDrainResponse | null | undefined,
): string | null {
  if (!forceResume && !drain) {
    return null;
  }

  const parts: string[] = [];
  const created = forceResume?.created ?? 0;
  const existing = forceResume?.existing ?? 0;
  const revived = forceResume?.revived ?? 0;
  const scheduleEnded = forceResume?.scheduleEnded ?? 0;
  const blocked = forceResume?.blocked ?? 0;
  const candidates = forceResume?.candidates ?? 0;
  const succeeded = drain?.succeeded ?? 0;
  const failed = drain?.failed ?? 0;
  const forceError = forceResume?.error?.trim();
  const drainError = drain?.lastError?.trim();

  if (candidates > 0 || created + existing + revived > 0 || succeeded > 0) {
    parts.push(
      `Reaktivierung: ${candidates} pausierte Beitrag-Push-Kampagne(n)` +
        (created + existing > 0 ? `, ${created + existing} geplant` : "") +
        (revived > 0 ? `, ${revived} erneut versucht` : "") +
        (succeeded > 0 ? `, ${succeeded} an Meta geschrieben` : ""),
    );
  }

  if (scheduleEnded > 0) {
    parts.push(
      `${scheduleEnded} nicht reaktiviert (Laufzeit bereits beendet)`,
    );
  } else if (
    blocked > 0 &&
    created + existing + revived === 0 &&
    succeeded === 0
  ) {
    parts.push(`Reaktivierung: ${blocked} Kampagne(n) blockiert`);
  } else if (candidates === 0 && !forceError) {
    parts.push(
      "Reaktivierung: lokal keine pausierten Beitrag-Push-Kampagnen gefunden",
    );
  }

  if (failed > 0) {
    parts.push(`${failed} Meta-Schreibfehler`);
  }

  if (forceError) {
    parts.push(`Reaktivierung-Fehler: ${forceError}`);
  } else if (drainError && succeeded === 0 && created + existing + revived > 0) {
    parts.push(`Executor: ${drainError}`);
  }

  return parts.length > 0 ? parts.join(". ") + "." : null;
}

function hardCapResumeNoticeKind(
  forceResume: HardCapForceResumeResponse | null | undefined,
  drain: HardCapStatusDrainResponse | null | undefined,
): NoticeKind {
  if (forceResume?.error || (drain?.failed ?? 0) > 0) {
    return "error";
  }
  if ((forceResume?.scheduleEnded ?? 0) > 0) {
    return "info";
  }
  if (
    (forceResume?.created ?? 0) +
      (forceResume?.existing ?? 0) +
      (forceResume?.revived ?? 0) +
      (drain?.succeeded ?? 0) >
    0
  ) {
    return "success";
  }
  return "info";
}

function combineNoticeKind(
  contentOk: boolean,
  ...kinds: NoticeKind[]
): NoticeKind {
  if (!contentOk || kinds.includes("error")) {
    return "error";
  }
  if (kinds.includes("success")) {
    return "success";
  }
  // Abruf ohne neue Beiträge ist Erfolg — auch wenn Boost nur informiert
  // (keine Treffer / noch nicht aktiv), nicht rot.
  return "success";
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
    kind: NoticeKind;
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
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      SYNC_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch("/api/connectors/meta/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
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
                    : response.status >= 500
                      ? `Abruf-Serverfehler (${response.status}). Bitte kurz warten und erneut versuchen.`
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
      const boostKind = organicBoostNoticeKind(body.organicBoost);
      const hardCapText = hardCapResumeNotice(
        body.hardCapForceResume,
        body.hardCapStatus,
      );
      const hardCapKind = hardCapResumeNoticeKind(
        body.hardCapForceResume,
        body.hardCapStatus,
      );
      const text = [contentText, boostText, hardCapText]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      setNotice({
        kind: combineNoticeKind(true, boostKind, hardCapKind),
        text,
      });
      router.refresh();
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      setNotice({
        kind: "error",
        text: aborted
          ? "Der Abruf hat zu lange gedauert und wurde abgebrochen. Bitte in einer Minute erneut versuchen."
          : "Der Abruf ist gerade nicht erreichbar. Bitte später erneut versuchen.",
      });
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  const noticeClass =
    notice?.kind === "success"
      ? "text-emerald-700"
      : notice?.kind === "info"
        ? "text-slate-600"
        : "text-rose-700";

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
          className={`flex items-start gap-1.5 text-sm ${noticeClass}`}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : notice.kind === "info" ? (
            <Info className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          )}
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
