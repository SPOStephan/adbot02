import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import {
  fillGateText,
  firstUnansweredStep,
  mergeHandoffAnswers,
  resolveKnockout,
} from "@shared/funnelGate";
import { pageShowsDescription, pageShowsEyebrow, pageShowsTitle } from "@shared/pageCopy";
import { normalizeFunnelConfig } from "./funnelStore";

describe("KO-Weiche und Sichtbarkeit", () => {
  it("erkennt eine KO-Antwort und fällt ohne Ziel-Funnel auf Exit zurück", () => {
    const page = defaultFunnel.pages.find(item => item.type === "choice-list");
    if (!page || page.type !== "choice-list") throw new Error("choice-list fehlt");
    const withKo = {
      ...page,
      options: page.options.map((option, index) => index === 0
        ? { ...option, knockout: true, knockoutAction: "handoff" as const, handoffFunnelId: "" }
        : option),
    };
    expect(resolveKnockout(withKo, ["einstieg"])?.action).toBe("exit");
    expect(resolveKnockout({
      ...withKo,
      options: withKo.options.map(option => option.value === "einstieg"
        ? { ...option, knockoutAction: "handoff" as const, handoffFunnelId: "20000000-0000-4000-8000-000000000002" }
        : option),
    }, ["einstieg"])).toMatchObject({ action: "handoff", handoffFunnelId: "20000000-0000-4000-8000-000000000002" });
    expect(resolveKnockout(withKo, ["1-3"])).toBeNull();
  });

  it("füllt den Ziel-Titel in den Übergabetext", () => {
    expect(fillGateText("Job xyz: {targetTitle}", { targetTitle: "Office Assistenz" })).toBe("Job xyz: Office Assistenz");
  });

  it("setzt übergebene Antworten ein und springt zur ersten offenen Frage", () => {
    expect(mergeHandoffAnswers({ berufserfahrung: ["1-3"] }, { arbeitsbereich: ["vertrieb"] })).toEqual({
      arbeitsbereich: ["vertrieb"],
      berufserfahrung: ["1-3"],
    });
    expect(firstUnansweredStep(defaultFunnel.pages, { arbeitsbereich: ["vertrieb"] })).toBe(2);
  });

  it("blendet Überzeile, Titel und Beschreibung nur bei aktivem Auge", () => {
    const start = defaultFunnel.pages[0]!;
    expect(pageShowsEyebrow(start)).toBe(true);
    expect(pageShowsTitle(start)).toBe(true);
    expect(pageShowsDescription({ ...start, showDescription: false })).toBe(false);
    expect(pageShowsEyebrow({ ...start, showEyebrow: false })).toBe(false);
    expect(pageShowsTitle({ ...start, showTitle: false })).toBe(false);
  });

  it("akzeptiert KO- und Anrede-Felder im Schema und normalisiert Altbestände", () => {
    expect(funnelConfigSchema.safeParse(defaultFunnel).success).toBe(true);
    const pages = defaultFunnel.pages.map(page => page.type === "choice-list"
      ? {
        ...page,
        options: page.options.map((option, index) => index === 0
          ? { ...option, knockout: true, knockoutAction: "exit" as const, handoffFunnelId: "" }
          : option),
      }
      : page);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, addressForm: "sie", pages }).success).toBe(true);

    const legacy = structuredClone(defaultFunnel) as Record<string, unknown>;
    delete legacy.addressForm;
    delete legacy.gate;
    for (const page of legacy.pages as Array<Record<string, unknown>>) {
      delete page.showEyebrow;
      delete page.showTitle;
      delete page.showDescription;
    }
    const normalized = normalizeFunnelConfig(legacy as typeof defaultFunnel, true);
    expect(normalized.addressForm).toBe("du");
    expect(normalized.gate.exitTitle.length).toBeGreaterThan(0);
    expect(normalized.pages[0]?.showTitle).toBe(true);
  });
});
