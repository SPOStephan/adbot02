export type HardCapForceResumeNoticeInput = {
  outcome?: string;
  reason?: string | null;
  created?: number;
  existing?: number;
  blocked?: number;
  revived?: number;
  exposuresCleared?: number;
  scheduleEnded?: number;
  candidates?: number;
  linked?: number;
  activeLocal?: number;
  adsetPausedOnly?: number;
  targetsRepaired?: number;
  remainingUnder24h?: number;
  missingCurrent?: number;
  error?: string | null;
  statusRefresh?: {
    requested?: number;
    refreshed?: number;
    upserted?: number;
    paused?: number;
    active?: number;
    targetsRepaired?: number;
    error?: string | null;
  } | null;
};

export type HardCapStatusDrainNoticeInput = {
  duePlans?: number;
  runs?: number;
  succeeded?: number;
  failed?: number;
  lastOutcome?: string | null;
  lastError?: string | null;
};

export type HardCapResumeNoticeKind = "success" | "info" | "error";

export function formatHardCapResumeNotice(
  forceResume: HardCapForceResumeNoticeInput | null | undefined,
  drain: HardCapStatusDrainNoticeInput | null | undefined,
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
  const linked = forceResume?.linked ?? 0;
  const activeLocal = forceResume?.activeLocal ?? 0;
  const adsetPausedOnly = forceResume?.adsetPausedOnly ?? 0;
  const targetsRepaired = forceResume?.targetsRepaired ?? 0;
  const remainingUnder24h = forceResume?.remainingUnder24h ?? 0;
  const missingCurrent = forceResume?.missingCurrent ?? 0;
  const succeeded = drain?.succeeded ?? 0;
  const failed = drain?.failed ?? 0;
  const forceError = forceResume?.error?.trim();
  const drainError = drain?.lastError?.trim();
  const outcome = (forceResume?.outcome ?? "").toUpperCase();
  const reason = forceResume?.reason?.trim();
  const refresh = forceResume?.statusRefresh;

  if (refresh && (refresh.requested ?? 0) > 0) {
    parts.push(
      `Meta-Status nachgeladen: ${refresh.refreshed ?? 0}/${refresh.requested} lokal geschrieben` +
        (typeof refresh.paused === "number"
          ? ` (${refresh.paused} PAUSED bei Meta)`
          : "") +
        ((refresh.targetsRepaired ?? 0) > 0
          ? `, ${refresh.targetsRepaired} Ziel(e) auf MANAGED`
          : ""),
    );
    if (refresh.error) {
      parts.push(`Status-Nachladen: ${refresh.error}`);
    }
  }

  if (outcome === "BLOCKED" && reason) {
    parts.push(`Reaktivierung blockiert (${reason})`);
  } else if (candidates > 0 || created + existing + revived > 0 || succeeded > 0) {
    parts.push(
      `Reaktivierung: ${candidates} pausierte Beitrag-Push-Kampagne(n)` +
        (created + existing > 0 ? `, ${created + existing} geplant` : "") +
        (revived > 0 ? `, ${revived} erneut versucht` : "") +
        (succeeded > 0 ? `, ${succeeded} an Meta geschrieben` : "") +
        (targetsRepaired > 0 ? `, ${targetsRepaired} Ziel(e) repariert` : ""),
    );
  } else if ((refresh?.paused ?? 0) > 0) {
    parts.push(
      `FEHLER: Meta meldet ${refresh?.paused} PAUSED Beitrag-Push, aber kein ACTIVATE-Plan wurde angelegt` +
        (forceError ? ` (${forceError})` : "") +
        " — SQL 20260809150000 prüfen",
    );
  } else if (linked > 0) {
    parts.push(
      `Reaktivierung: ${linked} Beitrag-Push gebunden, aber lokal keine PAUSED-Kampagne` +
        (activeLocal > 0 ? ` (${activeLocal} lokal ACTIVE/nicht pausiert)` : "") +
        (missingCurrent > 0
          ? `, ${missingCurrent} ohne aktuellen Kampagnen-Stand`
          : "") +
        (adsetPausedOnly > 0
          ? `, ${adsetPausedOnly} nur Ad-Set pausiert (Kampagne ACTIVE)`
          : ""),
    );
  } else if (!forceError) {
    parts.push(
      "Reaktivierung: lokal keine pausierten Beitrag-Push-Kampagnen gefunden",
    );
  }

  if (scheduleEnded > 0) {
    parts.push(
      `${scheduleEnded} nicht reaktiviert (Laufzeit bereits beendet)`,
    );
  } else if (
    blocked > 0 &&
    created + existing + revived === 0 &&
    succeeded === 0 &&
    candidates > 0
  ) {
    parts.push(`Reaktivierung: ${blocked} Kampagne(n) blockiert`);
  }

  if (remainingUnder24h > 0) {
    parts.push(
      `${remainingUnder24h} mit Restlaufzeit unter 24h — Adbot sperrt das nicht, Reaktivierung wird trotzdem versucht`,
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

export function hardCapResumeNoticeKind(
  forceResume: HardCapForceResumeNoticeInput | null | undefined,
  drain: HardCapStatusDrainNoticeInput | null | undefined,
): HardCapResumeNoticeKind {
  const refreshPaused = forceResume?.statusRefresh?.paused ?? 0;
  const queued =
    (forceResume?.created ?? 0) +
    (forceResume?.existing ?? 0) +
    (forceResume?.candidates ?? 0) +
    (drain?.succeeded ?? 0);
  if (
    forceResume?.error ||
    (forceResume?.outcome ?? "").toUpperCase() === "BLOCKED" ||
    (drain?.failed ?? 0) > 0 ||
    (refreshPaused > 0 && queued < 1)
  ) {
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
