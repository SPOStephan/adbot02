import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "@shared/funnel";
import { defaultFunnel } from "@shared/defaultFunnel";
import { buildApplicationNotificationHtml } from "./mail";

describe("Bewerbungs-E-Mail", () => {
  it("verwendet Seitennamen und sichtbare Antwort mit Umlauten statt technischer Werte", () => {
    const technicalQuestionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";
    const technicalAnswerValue = "noch-nicht-aber-in-vorbereitung";
    const config = structuredClone(defaultFunnel);
    const choicePage = config.pages.find(page => page.type === "choice-grid");
    if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    choicePage.name = "Sachkundenachweis";
    choicePage.questionKey = technicalQuestionKey;
    choicePage.options[0] = {
      ...choicePage.options[0]!,
      value: technicalAnswerValue,
      label: "Noch nicht, aber in Vorbereitung",
    };
    const application: ApplicationRecord = {
      id: "20000000-0000-4000-8000-000000000001",
      funnelId: config.id,
      funnelSlug: config.slug,
      status: "new",
      answers: { [technicalQuestionKey]: [technicalAnswerValue] },
      contact: { name: "Erika Müster", email: "erika@example.org" },
      consentAt: "2026-07-29T08:00:00.000Z",
      utm: {},
      createdAt: "2026-07-29T08:00:00.000Z",
    };

    const html = buildApplicationNotificationHtml(config, application);

    expect(html).toContain("Sachkundenachweis");
    expect(html).toContain("Noch nicht, aber in Vorbereitung");
    expect(html).toContain("Erika Müster");
    expect(html).not.toContain(technicalQuestionKey);
    expect(html).not.toContain(technicalAnswerValue);
  });
});
