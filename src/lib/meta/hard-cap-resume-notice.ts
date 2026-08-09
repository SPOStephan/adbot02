export type HardCapForceResumeNoticeInput = {
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

export function hardCapResumeNoticeKind(
  forceResume: HardCapForceResumeNoticeInput | null | undefined,
  drain: HardCapStatusDrainNoticeInput | null | undefined,
): HardCapResumeNoticeKind {
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
