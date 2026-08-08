import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "@shared/funnel";
import { defaultFunnel } from "@shared/defaultFunnel";
import { buildApplicationsCsv, buildApplicationsPdf } from "./exports";

const technicalQuestionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";
const config = structuredClone(defaultFunnel);
const choicePage = config.pages.find(page => page.type === "choice-grid");
if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
choicePage.name = "Sachkunde";
choicePage.questionKey = technicalQuestionKey;

const application: ApplicationRecord = {
  id: "20000000-0000-4000-8000-000000000001",
  funnelId: "10000000-0000-4000-8000-000000000001",
  funnelSlug: "karriere",
  status: "new",
  answers: { [technicalQuestionKey]: ["Vertrieb", "Office"], Erfahrung: ["3+ Jahre"] },
  contact: { name: "Muster; Erika", company: "Beispiel \"GmbH\"", email: "erika@example.org", phone: "+49 123", message: "Guten Tag" },
  consentAt: "2026-07-27T08:00:00.000Z",
  resume: { key: "applications/test.pdf", url: "/api/storage/applications/test.pdf", fileName: "CV Erika.pdf", mimeType: "application/pdf", size: 1024 },
  sourceUrl: "https://example.org/f/karriere?utm_source=linkedin",
  utm: { utm_source: "linkedin" },
  createdAt: "2026-07-27T08:00:00.000Z",
};

describe("Bewerbungsexporte", () => {
  it("erzeugt eine Excel-kompatible CSV mit dynamischen Antwortspalten und korrektem Escaping", () => {
    const csv = buildApplicationsCsv([application], [config]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Sachkunde"');
    expect(csv).not.toContain(technicalQuestionKey);
    expect(csv).toContain('"Muster; Erika"');
    expect(csv).toContain('"Beispiel ""GmbH"""');
    expect(csv).toContain("CV Erika.pdf");
  });

  it("erzeugt ein lesbares PDF sowohl mit als auch ohne Bewerbungen", async () => {
    const populated = await buildApplicationsPdf([application], [config]);
    const empty = await buildApplicationsPdf([]);
    expect(populated.subarray(0, 4).toString()).toBe("%PDF");
    expect(empty.subarray(0, 4).toString()).toBe("%PDF");
    expect(populated.byteLength).toBeGreaterThan(500);
  });
});
