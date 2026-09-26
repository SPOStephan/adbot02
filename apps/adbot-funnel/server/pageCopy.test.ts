import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { choiceAdvancesOnSelect, isCopyFieldVisible, isPageDescriptionShown, isPageEyebrowShown, isPageTitleShown } from "@shared/funnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { normalizeFunnelConfig } from "./funnelStore";

describe("Sichtbarkeit von Seitentexten", () => {
  it("zeigt Überzeile, Überschrift und Beschreibung standardmäßig", () => {
    const start = defaultFunnel.pages[0];
    if (start?.type !== "start") throw new Error("Startseite fehlt");
    expect(isCopyFieldVisible(undefined)).toBe(true);
    expect(isPageEyebrowShown(start)).toBe(true);
    expect(isPageTitleShown(start)).toBe(true);
    expect(isPageDescriptionShown(start)).toBe(true);
    expect(isPageEyebrowShown({ ...start, eyebrowVisible: false })).toBe(false);
    expect(isPageTitleShown({ ...start, titleVisible: false })).toBe(false);
    expect(isPageDescriptionShown({ ...start, descriptionVisible: false })).toBe(false);
    expect(isPageEyebrowShown({ ...start, eyebrow: "" })).toBe(false);
  });

  it("normalisiert fehlende Sichtbarkeitsfelder auf sichtbar", () => {
    const legacy = structuredClone(defaultFunnel);
    for (const page of legacy.pages) {
      Reflect.deleteProperty(page, "eyebrowVisible");
      Reflect.deleteProperty(page, "titleVisible");
      Reflect.deleteProperty(page, "descriptionVisible");
    }
    const normalized = normalizeFunnelConfig(legacy, true);
    expect(normalized.pages.every(page => page.eyebrowVisible && page.titleVisible && page.descriptionVisible)).toBe(true);
    expect(funnelConfigSchema.parse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => ({ ...page, eyebrowVisible: false, titleVisible: false, descriptionVisible: false })),
    }).pages[0]).toMatchObject({ eyebrowVisible: false, titleVisible: false, descriptionVisible: false });
  });

  it("geht bei Einfachauswahl direkt weiter, bei Mehrfachauswahl nicht", () => {
    expect(choiceAdvancesOnSelect(false)).toBe(true);
    expect(choiceAdvancesOnSelect(true)).toBe(false);
  });
});
