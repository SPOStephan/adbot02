/**
 * Pure helpers for the customer Pause/Fortsetzen button on Adbot-launched
 * campaigns. No runtime imports: scripts/test-meta-campaign-status-change.mjs
 * loads this file directly with --experimental-strip-types.
 */

export type CampaignStatusTarget = "PAUSED" | "ACTIVE";

export type CampaignStatusChangeRequest = {
  platformCampaignId: string;
  status: CampaignStatusTarget;
};

const TERMINAL_PLAN_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "STALE",
  "BLOCKED",
  "PREFLIGHT_FAILED",
  "CANCELLED",
  "COMPENSATION_REQUIRED",
]);

const BLOCKED_MESSAGES: Record<string, string> = {
  invalid_status: "Dieser Status kann nicht gesetzt werden.",
  invalid_campaign_id: "Die Kampagnen-ID ist ungültig.",
  invalid_account: "Das Meta-Konto ist nicht mehr verbunden.",
  not_adbot_launch:
    "Nur Kampagnen, die Adbot selbst gestartet hat, lassen sich hier pausieren. Beitrag-Push steuerst du in den Beitrag-Push-Einstellungen.",
  target_not_managed:
    "Adbot findet für diese Kampagne keine Zuordnung. Bitte einmal Meta-Daten abrufen und erneut versuchen.",
  policy_inactive:
    "Es gibt keine aktive Automatik-Freigabe für dieses Konto. Bitte die Freigabe unter Autonomie bestätigen.",
  status_changes_not_allowed:
    "Statusänderungen sind in deiner Automatik-Freigabe ausgeschaltet. Schalte unter Autonomie „Status ändern“ ein.",
  campaign_not_found:
    "Die Kampagne ist noch nicht abgerufen. Bitte einmal Meta-Daten abrufen und erneut versuchen.",
  campaign_archived: "Die Kampagne ist archiviert oder gelöscht.",
  campaign_not_paused: "Die Kampagne ist nicht pausiert.",
  campaign_not_active: "Die Kampagne läuft gerade nicht.",
  campaign_schedule_ended:
    "Die Laufzeit der Kampagne ist abgelaufen. Lege mit „Als Vorlage duplizieren“ eine neue an.",
  writes_frozen:
    "Meta-Änderungen sind für dieses Konto gerade gesperrt (Not-Aus oder laufender Start). Bitte gleich noch einmal versuchen.",
};

export function parseCampaignStatusChangeRequest(
  value: unknown,
): CampaignStatusChangeRequest | null {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body || Object.keys(body).length !== 2) return null;
  const platformCampaignId =
    typeof body.platformCampaignId === "string" ? body.platformCampaignId.trim() : "";
  const status = body.status;
  if (!/^[1-9]\d{0,39}$/.test(platformCampaignId)) return null;
  if (status !== "PAUSED" && status !== "ACTIVE") return null;
  return { platformCampaignId, status };
}

export function campaignStatusBlockedMessage(reason: string | null | undefined): string {
  return (
    (reason && BLOCKED_MESSAGES[reason]) ||
    "Die Statusänderung konnte nicht vorbereitet werden."
  );
}

export function isTerminalPlanStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_PLAN_STATUSES.has(status);
}

/** Which button the overview shows, or null when none applies. */
export function campaignStatusAction(input: {
  launchedByAdbot: boolean;
  kind: string;
  lifecycle: string;
  statusLabel: string;
}): CampaignStatusTarget | null {
  if (!input.launchedByAdbot) return null;
  if (input.kind !== "lead" && input.kind !== "traffic") return null;
  if (input.lifecycle === "active") return "PAUSED";
  if (input.statusLabel === "Pausiert") return "ACTIVE";
  return null;
}
