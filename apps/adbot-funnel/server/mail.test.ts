import { describe, expect, it } from "vitest";
import type { ApplicationRecord } from "@shared/funnel";
import { defaultFunnel } from "@shared/defaultFunnel";
import { buildApplicationNotificationHtml, resolveApplicationMailFrom } from "./mail";

describe("Bewerbungs-E-Mail", () => {
  it("verwendet Seitennamen und sichtbare Antwort mit Umlauten statt technischer Werte", () => {
    const technicalQuestionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";
    const technicalAnswerValue = "noch-nicht-aber-in-vorbereitung";
    const config = structuredClone(defaultFunnel);
    const choicePage = config.pages.find(page => page.type === "choice-grid");
    if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    choicePage.name = "sachkunde-intern";
    choicePage.title = "Hast du einen Sachkundenachweis?";
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

    expect(html).toContain("Hast du einen Sachkundenachweis?");
    expect(html).not.toContain("sachkunde-intern");
    expect(html).toContain("Noch nicht, aber in Vorbereitung");
    expect(html).toContain("Erika Müster");
    expect(html).not.toContain(technicalQuestionKey);
    expect(html).not.toContain(technicalAnswerValue);
  });

  it("verwendet einen verifizierten Absender nur für den exakt zugeordneten Funnel-Host", () => {
    const application: ApplicationRecord = {
      id: "20000000-0000-4000-8000-000000000002",
      funnelId: defaultFunnel.id,
      funnelSlug: "vertrieb-immo02",
      status: "new",
      answers: {},
      contact: { name: "Erika Muster" },
      consentAt: "2026-09-28T08:00:00.000Z",
      sourceUrl: "https://jobs.boncred.info/f/vertrieb-immo02",
      utm: {},
      createdAt: "2026-09-28T08:00:00.000Z",
    };
    const fallback = "Adbot Funnel <funnel@send.adbot.one>";
    const custom = "Boncred Funnel <funnel@mail.boncred.info>";

    expect(resolveApplicationMailFrom(application, {
      MAIL_FROM: fallback,
      MAIL_FROM_BY_FUNNEL_HOST: JSON.stringify({ "jobs.boncred.info": custom }),
    })).toBe(custom);

    expect(resolveApplicationMailFrom({
      ...application,
      sourceUrl: "https://funnel.adbot.one/f/vertrieb-immo02",
    }, {
      MAIL_FROM: fallback,
      MAIL_FROM_BY_FUNNEL_HOST: JSON.stringify({ "jobs.boncred.info": custom }),
    })).toBe(fallback);

    expect(resolveApplicationMailFrom(application, {
      MAIL_FROM: fallback,
      MAIL_FROM_BY_FUNNEL_HOST: "not-json",
    })).toBe(fallback);
  });
});
