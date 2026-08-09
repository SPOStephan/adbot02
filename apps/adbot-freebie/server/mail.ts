import { ENV } from "./_core/env";

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendTransactionalMail(input: SendMailInput): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!ENV.resendApiKey) {
    console.warn("[mail] RESEND_API_KEY fehlt — Mail wird nur geloggt", {
      to: input.to,
      subject: input.subject,
    });
    return { ok: true, skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: ENV.mailFrom,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend-Fehler (${response.status}): ${body.slice(0, 200)}`);
  }

  return { ok: true };
}

export function buildDoiMail(opts: {
  offerTitle: string;
  confirmUrl: string;
}) {
  const subject = `Bitte bestätige: ${opts.offerTitle}`;
  const text = `Bitte bestätige deine E-Mail, um „${opts.offerTitle}“ zu erhalten:\n\n${opts.confirmUrl}\n`;
  const html = `
    <p>Hallo,</p>
    <p>bitte bestätige deine E-Mail, um <strong>${escapeHtml(opts.offerTitle)}</strong> zu erhalten.</p>
    <p><a href="${opts.confirmUrl}">E-Mail bestätigen &amp; Freebie laden</a></p>
  `;
  return { subject, text, html };
}

export function buildOtpMail(opts: {
  offerTitle: string;
  otp: string;
}) {
  const subject = `Dein Code für ${opts.offerTitle}`;
  const text = `Dein Bestätigungscode für „${opts.offerTitle}“ lautet: ${opts.otp}\n\nDer Code ist 15 Minuten gültig.\n`;
  const html = `
    <p>Hallo,</p>
    <p>dein Bestätigungscode für <strong>${escapeHtml(opts.offerTitle)}</strong> lautet:</p>
    <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${escapeHtml(opts.otp)}</p>
    <p>Der Code ist 15 Minuten gültig.</p>
  `;
  return { subject, text, html };
}

export function buildDeliveryMail(opts: {
  offerTitle: string;
  downloadUrl: string;
}) {
  const subject = `Dein Freebie: ${opts.offerTitle}`;
  const text = `Hier ist dein Freebie „${opts.offerTitle}“:\n\n${opts.downloadUrl}\n`;
  const html = `
    <p>Danke für deine Bestätigung.</p>
    <p>Hier ist <strong>${escapeHtml(opts.offerTitle)}</strong>:</p>
    <p><a href="${opts.downloadUrl}">Jetzt herunterladen</a></p>
  `;
  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
