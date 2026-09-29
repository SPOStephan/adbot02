import type { ApplicationRecord, FunnelConfig } from "@shared/funnel";
import { resolveApplicationAnswers } from "@shared/applicationAnswers";
import { funnelSubmissionLabel } from "@shared/funnelPurpose";

type MailEnvironment = {
  MAIL_FROM?: string;
  MAIL_FROM_BY_FUNNEL_HOST?: string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export function buildApplicationNotificationHtml(config: FunnelConfig, application: ApplicationRecord) {
  const submissionLabel = funnelSubmissionLabel(config.purpose);
  const contactRows = Object.entries(application.contact)
    .map(([key, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#5c6b7a">${escapeHtml(key)}</td><td style="padding:6px 0"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join("");
  const answerRows = resolveApplicationAnswers(
    config,
    application.answers,
    application.answerLabels,
    application.questionLabels,
  )
    .map(answer => `<tr><td style="padding:10px 0;border-top:1px solid #e3e8ee"><div style="color:#5c6b7a">${escapeHtml(answer.label)}</div><div style="margin-top:4px"><strong>${escapeHtml(answer.values.join(", "))}</strong></div></td></tr>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#10253f">
      <div style="height:8px;background:#0165c3;border-radius:8px 8px 0 0"></div>
      <h1 style="font-size:24px;margin:28px 0 8px">Neue ${escapeHtml(submissionLabel)} eingegangen</h1>
      <p style="color:#5c6b7a">Funnel: ${escapeHtml(config.title)} · ${escapeHtml(new Date(application.createdAt).toLocaleString("de-DE"))}</p>
      <h2 style="font-size:17px;margin-top:28px">Kontaktdaten</h2><table>${contactRows}</table>
      <h2 style="font-size:17px;margin-top:28px">Antworten</h2><table style="width:100%;border-collapse:collapse">${answerRows}</table>
      ${application.resume ? `<p style="margin-top:24px"><strong>Lebenslauf:</strong> ${escapeHtml(application.resume.fileName)}</p>` : ""}
      <p style="margin-top:32px;color:#5c6b7a;font-size:13px">Der vollständige Eintrag ist im geschützten Admin-Bereich verfügbar.</p>
    </div>`;
}

function sourceHostname(sourceUrl: string | undefined): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    return new URL(sourceUrl).hostname.trim().toLowerCase().replace(/\.$/, "") || undefined;
  } catch {
    return undefined;
  }
}

function hostSenderMap(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => (
          typeof entry[1] === "string" && Boolean(entry[0].trim() && entry[1].trim())
        ))
        .map(([host, sender]) => [host.trim().toLowerCase().replace(/\.$/, ""), sender.trim()]),
    );
  } catch {
    return {};
  }
}

/**
 * Custom senders are selected only for an exact public funnel hostname and
 * only after that hostname has been configured server-side. Unknown hosts,
 * preview URLs and malformed configuration always keep the verified fallback.
 */
export function resolveApplicationMailFrom(
  application: ApplicationRecord,
  environment: MailEnvironment = {
    MAIL_FROM: process.env.MAIL_FROM,
    MAIL_FROM_BY_FUNNEL_HOST: process.env.MAIL_FROM_BY_FUNNEL_HOST,
  },
): string | undefined {
  const fallback = environment.MAIL_FROM?.trim() || undefined;
  const hostname = sourceHostname(application.sourceUrl);
  if (!hostname) return fallback;
  return hostSenderMap(environment.MAIL_FROM_BY_FUNNEL_HOST)[hostname] || fallback;
}

export async function sendApplicationNotification(config: FunnelConfig, application: ApplicationRecord) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = resolveApplicationMailFrom(application);
  if (!apiKey || !from || !config.notificationEmail) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [config.notificationEmail],
      subject: `Neue ${funnelSubmissionLabel(config.purpose)}: ${application.contact.name ?? application.contact.email ?? application.id}`,
      html: buildApplicationNotificationHtml(config, application),
    }),
  });
  if (!response.ok) throw new Error(`E-Mail-Versand fehlgeschlagen (${response.status}).`);
  return true;
}
