import type { ApplicationRecord, FunnelConfig } from "@shared/funnel";
import { resolveApplicationAnswers } from "@shared/applicationAnswers";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export function buildApplicationNotificationHtml(config: FunnelConfig, application: ApplicationRecord) {
  const contactRows = Object.entries(application.contact)
    .map(([key, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#5c6b7a">${escapeHtml(key)}</td><td style="padding:6px 0"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join("");
  const answerRows = resolveApplicationAnswers(config, application.answers)
    .map(answer => `<tr><td style="padding:6px 12px 6px 0;color:#5c6b7a">${escapeHtml(answer.label)}</td><td style="padding:6px 0">${escapeHtml(answer.values.join(", "))}</td></tr>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#10253f">
      <div style="height:8px;background:#0165c3;border-radius:8px 8px 0 0"></div>
      <h1 style="font-size:24px;margin:28px 0 8px">Neue Bewerbung eingegangen</h1>
      <p style="color:#5c6b7a">Funnel: ${escapeHtml(config.title)} · ${escapeHtml(new Date(application.createdAt).toLocaleString("de-DE"))}</p>
      <h2 style="font-size:17px;margin-top:28px">Kontaktdaten</h2><table>${contactRows}</table>
      <h2 style="font-size:17px;margin-top:28px">Antworten</h2><table>${answerRows}</table>
      ${application.resume ? `<p style="margin-top:24px"><strong>Lebenslauf:</strong> ${escapeHtml(application.resume.fileName)}</p>` : ""}
      <p style="margin-top:32px;color:#5c6b7a;font-size:13px">Die vollständige Bewerbung ist im geschützten Admin-Bereich verfügbar.</p>
    </div>`;
}

export async function sendApplicationNotification(config: FunnelConfig, application: ApplicationRecord) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from || !config.notificationEmail) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [config.notificationEmail],
      subject: `Neue Bewerbung: ${application.contact.name ?? application.contact.email ?? application.id}`,
      html: buildApplicationNotificationHtml(config, application),
    }),
  });
  if (!response.ok) throw new Error(`E-Mail-Versand fehlgeschlagen (${response.status}).`);
  return true;
}
