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
  adSetsActivated?: number;
  adsActivated?: number;
  campaignsMissingAds?: number;
  error?: string | null;
  statusRefresh?: {
    requested?: number;
    refreshed?: number;
    upserted?: number;
    paused?: number;
    childDeliveryIncomplete?: number;
    active?: number;
    completed?: number;
    missingAtMeta?: number;
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

function humanizeForceResumeError(error: string): string {
  if (error.startsWith("keine_werbeanzeige:")) {
    return (
      "Bei Meta fehlt die Werbeanzeige (Kampagne ohne Ad) — " +
      "Status-Aktualisierung allein reicht nicht; Anzeige muss neu angelegt werden"
    );
  }
  return error;
}

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
  const adsActivated = forceResume?.adsActivated ?? 0;
  const adSetsActivated = forceResume?.adSetsActivated ?? 0;
  const campaignsMissingAds = forceResume?.campaignsMissingAds ?? 0;
  const succeeded = drain?.succeeded ?? 0;
  const failed = drain?.failed ?? 0;
  const forceError = forceResume?.error?.trim();
  const drainError = drain?.lastError?.trim();
  const outcome = (forceResume?.outcome ?? "").toUpperCase();
  const reason = forceResume?.reason?.trim();
  const refresh = forceResume?.statusRefresh;

  if (refresh && (refresh.requested ?? 0) > 0) {
    const statusBits: string[] = [];
    if (typeof refresh.paused === "number" && refresh.paused > 0) {
      statusBits.push(`${refresh.paused} Kampagne(n) PAUSED`);
    }
    if ((refresh.childDeliveryIncomplete ?? 0) > 0) {
      statusBits.push(
        `${refresh.childDeliveryIncomplete} mit pausierter/unvollständiger Anzeige`,
      );
    }
    if ((refresh.completed ?? 0) > 0) {
      statusBits.push(`${refresh.completed} beendet`);
    }
    if ((refresh.missingAtMeta ?? 0) > 0) {
      statusBits.push(`${refresh.missingAtMeta} bei Meta nicht mehr lesbar`);
    }
    parts.push(
      `Meta-Status nachgeladen: ${refresh.refreshed ?? 0}/${refresh.requested} lokal geschrieben` +
        (statusBits.length > 0 ? ` (${statusBits.join(", ")})` : "") +
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
  } else if ((refresh?.childDeliveryIncomplete ?? 0) > 0) {
    parts.push(
      `Hinweis: ${refresh?.childDeliveryIncomplete} Beitrag-Push-Kampagne(n) sind an, aber Anzeige/AdSet noch nicht vollständig aktiv — Adbot versucht die Anzeigen direkt zu aktivieren (kein Kampagnen-ACTIVATE nötig).`,
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

  if (adsActivated + adSetsActivated > 0) {
    parts.push(
      `Anzeigen-Heal an Meta: ${adsActivated} Ad(s), ${adSetsActivated} AdSet(s) auf ACTIVE gesetzt`,
    );
  } else if (campaignsMissingAds > 0) {
    parts.push(
      `${campaignsMissingAds} Live-Kampagne(n) ohne Werbeanzeige bei Meta (Keine Werbeanzeige)`,
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
    // Child-delivery gaps are healed via ad/adset ACTIVATE — not campaign queue.
    if (
      forceError === "meta_paused_but_no_activate_queued" &&
      (refresh?.paused ?? 0) < 1
    ) {
      // Drop false FEHLER when only ads/ad sets were incomplete.
    } else {
      parts.push(`Reaktivierung-Fehler: ${humanizeForceResumeError(forceError)}`);
    }
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
  const childIncomplete =
    forceResume?.statusRefresh?.childDeliveryIncomplete ?? 0;
  const queued =
    (forceResume?.created ?? 0) +
    (forceResume?.existing ?? 0) +
    (forceResume?.candidates ?? 0) +
    (drain?.succeeded ?? 0);
  const healWrites =
    (forceResume?.adsActivated ?? 0) + (forceResume?.adSetsActivated ?? 0);
  const falsePausedError =
    forceResume?.error === "meta_paused_but_no_activate_queued" &&
    refreshPaused < 1;
  if (
    (forceResume?.error && !falsePausedError) ||
    (forceResume?.outcome ?? "").toUpperCase() === "BLOCKED" ||
    (drain?.failed ?? 0) > 0 ||
    (refreshPaused > 0 && queued < 1)
  ) {
    return "error";
  }
  if ((forceResume?.scheduleEnded ?? 0) > 0 || childIncomplete > 0) {
    return "info";
  }
  if (
    (forceResume?.created ?? 0) +
      (forceResume?.existing ?? 0) +
      (forceResume?.revived ?? 0) +
      (drain?.succeeded ?? 0) +
      healWrites >
    0
  ) {
    return "success";
  }
  return "info";
}
