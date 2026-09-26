import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { choiceAdvancesOnSelect, isCopyFieldVisible, isPageDescriptionShown, isPageEyebrowShown, isPageSubtitleShown, isPageTitleShown } from "@shared/funnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { normalizeFunnelConfig } from "./funnelStore";

describe("Sichtbarkeit von Seitentexten", () => {
  it("zeigt Überzeile, Überschrift und Beschreibung standardmäßig", () => {
    const start = defaultFunnel.pages[0];
    if (start?.type !== "start") throw new Error("Startseite fehlt");
    expect(isCopyFieldVisible(undefined)).toBe(true);
    expect(isPageEyebrowShown(start)).toBe(true);
    expect(isPageTitleShown(start)).toBe(true);
    expect(isPageSubtitleShown(start)).toBe(false);
    expect(isPageDescriptionShown(start)).toBe(true);
    expect(isPageEyebrowShown({ ...start, eyebrowVisible: false })).toBe(false);
    expect(isPageTitleShown({ ...start, titleVisible: false })).toBe(false);
    expect(isPageSubtitleShown({ ...start, subtitle: "Unter der Headline", subtitleVisible: false })).toBe(false);
    expect(isPageSubtitleShown({ ...start, subtitle: "Unter der Headline" })).toBe(true);
    expect(isPageDescriptionShown({ ...start, descriptionVisible: false })).toBe(false);
    expect(isPageEyebrowShown({ ...start, eyebrow: "" })).toBe(false);
  });

  it("normalisiert fehlende Sichtbarkeitsfelder auf sichtbar", () => {
    const legacy = structuredClone(defaultFunnel);
    for (const page of legacy.pages) {
      Reflect.deleteProperty(page, "eyebrowVisible");
      Reflect.deleteProperty(page, "titleVisible");
      Reflect.deleteProperty(page, "subtitleVisible");
      Reflect.deleteProperty(page, "descriptionVisible");
      Reflect.deleteProperty(page, "subtitle");
    }
    const normalized = normalizeFunnelConfig(legacy, true);
    expect(normalized.pages.every(page => page.eyebrowVisible && page.titleVisible && page.subtitleVisible && page.descriptionVisible)).toBe(true);
    expect(normalized.pages.every(page => page.subtitle === "")).toBe(true);
    expect(normalized.pages.every(page => page.eyebrowSizeStep === 0 && page.titleSizeStep === 0 && page.subtitleSizeStep === 0 && page.descriptionSizeStep === 0)).toBe(true);
    expect(funnelConfigSchema.parse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => ({ ...page, eyebrowVisible: false, titleVisible: false, subtitleVisible: false, descriptionVisible: false })),
    }).pages[0]).toMatchObject({ eyebrowVisible: false, titleVisible: false, subtitleVisible: false, descriptionVisible: false });
  });

  it("bewahrt eingestellte Schriftgrößen-Schritte und füllt fehlende mit Standard", () => {
    const legacy = structuredClone(defaultFunnel);
    for (const page of legacy.pages) {
      Reflect.deleteProperty(page, "eyebrowSizeStep");
      Reflect.deleteProperty(page, "titleSizeStep");
      Reflect.deleteProperty(page, "subtitleSizeStep");
      Reflect.deleteProperty(page, "descriptionSizeStep");
    }
    legacy.pages[0] = { ...legacy.pages[0]!, titleSizeStep: 3, eyebrowSizeStep: -2 };
    const normalized = normalizeFunnelConfig(legacy, true);
    expect(normalized.pages[0]).toMatchObject({ titleSizeStep: 3, eyebrowSizeStep: -2, subtitleSizeStep: 0, descriptionSizeStep: 0 });
    expect(normalized.pages.slice(1).every(page => page.titleSizeStep === 0)).toBe(true);
    expect(funnelConfigSchema.parse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => ({ ...page, titleSizeStep: 2 })),
    }).pages[0]).toMatchObject({ titleSizeStep: 2, eyebrowSizeStep: 0 });
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => ({ ...page, titleSizeStep: 20 })),
    }).success).toBe(false);
  });

  it("geht bei Einfachauswahl direkt weiter, bei Mehrfachauswahl nicht", () => {
    expect(choiceAdvancesOnSelect(false)).toBe(true);
    expect(choiceAdvancesOnSelect(true)).toBe(false);
  });
});
