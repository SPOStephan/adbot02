import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ApplicationRecord, FunnelConfig } from "@shared/funnel";
import { resolveApplicationAnswers } from "@shared/applicationAnswers";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function configForApplication(configs: FunnelConfig[], application: ApplicationRecord) {
  return configs.find(config => config.id === application.funnelId)
    ?? configs.find(config => config.slug === application.funnelSlug);
}

export function buildApplicationsCsv(applications: ApplicationRecord[], configs: FunnelConfig[] = []) {
  const resolvedAnswers = new Map(applications.map(application => [
    application.id,
    resolveApplicationAnswers(configForApplication(configs, application), application.answers),
  ]));
  const answerLabels = Array.from(new Set(Array.from(resolvedAnswers.values()).flatMap(answers => answers.map(answer => answer.label))));
  const headers = ["ID", "Eingang", "Status", "Name", "Firma", "E-Mail", "Telefon", "Nachricht", ...answerLabels, "Lebenslauf"];
  const rows = applications.map(application => [
    application.id,
    application.createdAt,
    application.status,
    application.contact.name ?? "",
    application.contact.company ?? "",
    application.contact.email ?? "",
    application.contact.phone ?? "",
    application.contact.message ?? "",
    ...answerLabels.map(label => resolvedAnswers.get(application.id)?.filter(answer => answer.label === label).flatMap(answer => answer.values).join(" | ") ?? ""),
    application.resume?.fileName ?? "",
  ]);
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n")}`;
}

function wrap(text: string, maxLength = 92) {
  const words = text.replaceAll("\n", " ").split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > maxLength && current) {
      lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildApplicationsPdf(applications: ApplicationRecord[], configs: FunnelConfig[] = []) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  for (let index = 0; index < applications.length; index += 1) {
    const application = applications[index]!;
    let page = document.addPage([595, 842]);
    let y = 792;
    const drawLine = (text: string, options: { bold?: boolean; color?: ReturnType<typeof rgb>; size?: number } = {}) => {
      const size = options.size ?? 10;
      for (const line of wrap(text)) {
        if (y < 52) {
          page = document.addPage([595, 842]);
          y = 792;
        }
        page.drawText(line, { x: 48, y, size, font: options.bold ? bold : regular, color: options.color ?? rgb(0.06, 0.15, 0.25) });
        y -= size + 7;
      }
    };
    page.drawRectangle({ x: 0, y: 834, width: 595, height: 8, color: rgb(0.004, 0.396, 0.765) });
    drawLine(`Bewerbung ${index + 1} von ${applications.length}`, { bold: true, size: 18 });
    drawLine(`${new Date(application.createdAt).toLocaleString("de-DE")} · Status: ${application.status}`, { color: rgb(0.36, 0.42, 0.48) });
    y -= 8;
    drawLine("Kontaktdaten", { bold: true, size: 13 });
    for (const [key, value] of Object.entries(application.contact)) drawLine(`${key}: ${value}`);
    y -= 8;
    drawLine("Antworten", { bold: true, size: 13 });
    for (const answer of resolveApplicationAnswers(configForApplication(configs, application), application.answers)) drawLine(`${answer.label}: ${answer.values.join(", ")}`);
    if (application.resume) {
      y -= 8;
      drawLine(`Lebenslauf: ${application.resume.fileName}`);
    }
    drawLine(`ID: ${application.id}`, { color: rgb(0.5, 0.55, 0.6), size: 8 });
  }
  if (applications.length === 0) {
    const page = document.addPage([595, 842]);
    page.drawText("Noch keine Bewerbungen vorhanden.", { x: 48, y: 780, size: 15, font: bold });
  }
  return Buffer.from(await document.save());
}
