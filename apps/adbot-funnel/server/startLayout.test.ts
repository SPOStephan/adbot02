import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { badgeFromTemplate, benefitsFromBullets, contrastOnAccent, defaultStartBenefits, resolveBadgeColors, resolveBenefitsTileGap, resolveBenefitsTileLayout, resolveStartLayout } from "@shared/startLayout";
import { normalizeFunnelConfig } from "./funnelStore";

describe("Startseiten-Layouts", () => {
  it("fällt ohne Angabe auf das klassische Layout zurück", () => {
    expect(resolveStartLayout({ layout: "classic" })).toBe("classic");
    expect(resolveStartLayout({ layout: "benefits" })).toBe("benefits");
    expect(resolveStartLayout({})).toBe("classic");
    expect(resolveBenefitsTileLayout("one-column")).toBe("one-column");
    expect(resolveBenefitsTileLayout("two-column")).toBe("two-column");
    expect(resolveBenefitsTileLayout(undefined)).toBe("two-column");
    expect(resolveBenefitsTileGap(undefined)).toBe("medium");
    expect(resolveBenefitsTileGap("medium")).toBe("medium");
    expect(resolveBenefitsTileGap("small")).toBe("small");
    expect(resolveBenefitsTileGap("large")).toBe("large");
    expect(resolveBenefitsTileGap("wide")).toBe("medium");
  });

  it("erzeugt Icon-Kacheln aus bestehenden Bullet-Zeilen", () => {
    const tiles = benefitsFromBullets(["30 Tage Urlaub", "Homeoffice"], () => "fixed-id");
    expect(tiles).toEqual([
      expect.objectContaining({ id: "fixed-id", title: "30 Tage Urlaub" }),
      expect.objectContaining({ id: "fixed-id", title: "Homeoffice" }),
    ]);
    expect(defaultStartBenefits(() => "seed").length).toBeGreaterThanOrEqual(4);
  });

  it("wählt kontrastreiche Schrift auf der Branding-Fläche", () => {
    expect(contrastOnAccent("#0165c3")).toBe("#ffffff");
    expect(contrastOnAccent("#f4f8fc")).toBe("#10253f");
  });

  it("akzeptiert das Vorteile-Layout mit Adbot-Icon und Farb-Override", () => {
    const pages = defaultFunnel.pages.map(page => page.type === "start"
      ? {
        ...page,
        layout: "benefits" as const,
        benefitsBandTitle: "Deine Vorteile bei uns",
        secondaryButtonLabel: "Jetzt bewerben",
        benefits: [{
          id: "benefit-1",
          icon: "adbot-vacation-days" as const,
          title: "30 Tage Urlaub",
          text: "Zeit für Erholung.",
          color: "#C8102E",
        }],
      }
      : page);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, pages }).success).toBe(true);
  });

  it("nimmt einspaltige Kacheln, Badges und Vorlagen an", () => {
    const pages = defaultFunnel.pages.map(page => page.type === "start"
      ? {
        ...page,
        layout: "benefits" as const,
        benefitsTileLayout: "one-column" as const,
        badges: [
          { id: "badge-1", label: "Homeoffice", backgroundColor: "#0165C3", textColor: "#FFFFFF" },
          badgeFromTemplate("10.000 €", () => "badge-2"),
        ],
      }
      : page);
    const parsed = funnelConfigSchema.parse({ ...defaultFunnel, pages });
    const start = parsed.pages[0];
    expect(start?.type).toBe("start");
    if (start?.type !== "start") throw new Error("Startseite fehlt");
    expect(start.benefitsTileLayout).toBe("one-column");
    expect(start.benefitsTileGap).toBe("medium");
    expect(start.badges.map(badge => badge.label)).toEqual(["Homeoffice", "10.000 €"]);
    expect(resolveBadgeColors({ backgroundColor: "#0165C3" }, "#10253f")).toEqual({ background: "#0165C3", text: "#ffffff" });
  });

  it("normalisiert Bestands-Startseiten ohne Layout-Felder", () => {
    const legacy = structuredClone(defaultFunnel);
    const start = legacy.pages[0];
    if (start?.type === "start") {
      Reflect.deleteProperty(start, "layout");
      Reflect.deleteProperty(start, "benefits");
      Reflect.deleteProperty(start, "benefitsTileLayout");
      Reflect.deleteProperty(start, "benefitsTileGap");
      Reflect.deleteProperty(start, "badges");
      Reflect.deleteProperty(start, "benefitsBandTitle");
      Reflect.deleteProperty(start, "secondaryButtonLabel");
    }
    const normalized = normalizeFunnelConfig(legacy, true);
    const page = normalized.pages[0];
    expect(page?.type).toBe("start");
    if (page?.type === "start") {
      expect(page.layout).toBe("classic");
      expect(page.benefits).toEqual([]);
      expect(page.benefitsBandTitle).toBe("");
      expect(page.secondaryButtonLabel).toBe("");
      expect(page.benefitsTileLayout).toBe("two-column");
      expect(page.benefitsTileGap).toBe("medium");
      expect(page.badges).toEqual([]);
      expect(page.heroBackgroundOpacity).toBe(15);
      expect(page.heroBackgroundDesktopUrl).toBe("");
    }
  });
});
