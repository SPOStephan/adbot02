import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "@shared/funnel";
import { defaultFunnel } from "@shared/defaultFunnel";
import { buildApplicationNotificationHtml } from "./mail";

describe("Bewerbungs-E-Mail", () => {
  it("verwendet den internen Seitennamen und enthält keine technische Question-ID", () => {
    const technicalQuestionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";
    const config = structuredClone(defaultFunnel);
    const choicePage = config.pages.find(page => page.type === "choice-grid");
    if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    choicePage.name = "Sachkunde";
    choicePage.questionKey = technicalQuestionKey;
    const application: ApplicationRecord = {
      id: "20000000-0000-4000-8000-000000000001",
      funnelId: config.id,
      funnelSlug: config.slug,
      status: "new",
      answers: { [technicalQuestionKey]: ["vorhanden"] },
      contact: { name: "Erika Muster", email: "erika@example.org" },
      consentAt: "2026-07-29T08:00:00.000Z",
      utm: {},
      createdAt: "2026-07-29T08:00:00.000Z",
    };

    const html = buildApplicationNotificationHtml(config, application);

    expect(html).toContain("Sachkunde");
    expect(html).toContain("vorhanden");
    expect(html).not.toContain(technicalQuestionKey);
  });
});
