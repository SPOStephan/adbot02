import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { badgeEditorBackground, badgeFromTemplate, benefitsFromBullets, clampHeroImageRadius, contrastOnAccent, customHeroSectionBackground, customHeroSectionFill, defaultStartBenefits, DEFAULT_BENEFITS_CARD_BACKGROUND, DEFAULT_BENEFITS_SECTION_BACKGROUND, DEFAULT_HERO_IMAGE_LAYOUT, DEFAULT_HERO_IMAGE_RADIUS, moveStartBadge, normalizeBadgeBackground, patchStartBadge, resolveBadgeBorderColor, resolveBadgeBorderWidth, resolveBadgeColors, resolveBadgeIcon, resolveBadgeIconPosition, resolveBenefitsCardBackground, resolveBenefitsSectionBackground, resolveBenefitsTileGap, resolveBenefitsTileLayout, resolveButtonColors, buttonOverrideVars, resolveEyebrowBox, resolveHeroImageLayout, resolveHeroSectionBackground, resolveButtonRadius, resolveStartButtonAlign, resolveStartLayout, resolveStartTextAlign } from "@shared/startLayout";
import { normalizeFunnelConfig } from "./funnelStore";

describe("Startseiten-Layouts", () => {
  it("fällt ohne Angabe auf das klassische Layout zurück", () => {
    expect(resolveStartLayout({ layout: "classic" })).toBe("classic");
    expect(resolveStartLayout({ layout: "benefits" })).toBe("benefits");
    expect(resolveStartLayout({})).toBe("classic");
    expect(resolveBenefitsTileLayout("one-column")).toBe("one-column");
    expect(resolveBenefitsTileLayout("two-column")).toBe("two-column");
    expect(resolveBenefitsTileLayout("cards")).toBe("cards");
    expect(resolveBenefitsTileLayout(undefined)).toBe("two-column");
    expect(resolveBenefitsTileLayout("unknown")).toBe("two-column");
    expect(resolveBenefitsTileGap(undefined)).toBe("medium");
    expect(resolveBenefitsTileGap("medium")).toBe("medium");
    expect(resolveBenefitsTileGap("small")).toBe("small");
    expect(resolveBenefitsTileGap("large")).toBe("large");
    expect(resolveBenefitsTileGap("wide")).toBe("medium");
    expect(resolveHeroImageLayout("wide")).toBe("wide");
    expect(resolveHeroImageLayout(undefined)).toBe(DEFAULT_HERO_IMAGE_LAYOUT);
    expect(clampHeroImageRadius(0)).toBe(0);
    expect(clampHeroImageRadius(140)).toBe(80);
    expect(clampHeroImageRadius("x")).toBe(DEFAULT_HERO_IMAGE_RADIUS);
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

  it("akzeptiert die Karten-Vorlage mit Bereichs- und Kartenfarbe", () => {
    const pages = defaultFunnel.pages.map(page => page.type === "start"
      ? {
        ...page,
        layout: "benefits" as const,
        benefitsTileLayout: "cards" as const,
        benefitsSectionBackground: "#E8F2FB",
        benefitsCardBackground: "#FFFFFF",
        heroSectionBackground: "#FFF4E5",
      }
      : page);
    const parsed = funnelConfigSchema.parse({ ...defaultFunnel, pages });
    const start = parsed.pages[0];
    expect(start?.type).toBe("start");
    if (start?.type !== "start") throw new Error("Startseite fehlt");
    expect(start.benefitsTileLayout).toBe("cards");
    expect(start.benefitsSectionBackground).toBe("#E8F2FB");
    expect(start.benefitsCardBackground).toBe("#FFFFFF");
    expect(start.heroSectionBackground).toBe("#FFF4E5");
    const withWide = funnelConfigSchema.parse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => page.type === "start"
        ? { ...page, heroImageLayout: "wide" as const, heroImageRadius: 0 }
        : page),
    });
    const wideStart = withWide.pages[0];
    expect(wideStart?.type).toBe("start");
    if (wideStart?.type === "start") {
      expect(wideStart.heroImageLayout).toBe("wide");
      expect(wideStart.heroImageRadius).toBe(0);
    }
  });

  it("speichert transparente Badges, Randfarbe/-breite und Hinweis-Textfarbe", () => {
    const withBadges = (badges: unknown[]) => defaultFunnel.pages.map(page => page.type === "start" ? { ...page, badges, trustNoteColor: "#c8102e" } : page);
    const parsed = funnelConfigSchema.parse({
      ...defaultFunnel,
      pages: withBadges([
        { id: "badge-1", label: "Homeoffice", backgroundColor: "#0165c3" },
        { id: "badge-2", label: "Remote", backgroundColor: "transparent", borderColor: "#ffffff", borderWidth: 3 },
      ]),
    });
    const start = normalizeFunnelConfig(parsed).pages[0];
    if (start?.type !== "start") throw new Error("Startseite fehlt");
    expect(start.trustNoteColor).toBe("#C8102E");
    expect(start.badges[0]).toMatchObject({ backgroundColor: "#0165C3" });
    expect(start.badges[0]?.borderWidth).toBeUndefined();
    expect(start.badges[1]).toMatchObject({ backgroundColor: "transparent", borderColor: "#FFFFFF", borderWidth: 3 });
    expect(() => funnelConfigSchema.parse({ ...defaultFunnel, pages: withBadges([{ id: "b", label: "X", borderWidth: 9 }]) })).toThrow();
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
    expect(resolveBenefitsSectionBackground("")).toBe(DEFAULT_BENEFITS_SECTION_BACKGROUND);
    expect(resolveBenefitsCardBackground("#EEF7FF")).toBe("#EEF7FF");
    expect(resolveHeroSectionBackground("", "#F4F8FC")).toBe("#F4F8FC");
    expect(resolveHeroSectionBackground("#FFF4E5", "#F4F8FC")).toBe("#FFF4E5");
    expect(customHeroSectionBackground("")).toBeUndefined();
    expect(customHeroSectionBackground("#fff4e5")).toBe("#FFF4E5");
    expect(customHeroSectionFill("", "")).toEqual({});
    expect(customHeroSectionFill("#fff4e5", "")).toEqual({ solid: "#FFF4E5" });
    expect(customHeroSectionFill("#fff4e5", "", "#0165C3")).toEqual({ solid: "#FFF4E5" });
    expect(customHeroSectionFill("", "#0165C3")).toEqual({});
    expect(customHeroSectionFill("#fff4e5", "#0165c3")).toEqual({ gradient: "linear-gradient(170deg, #FFF4E5 0%, #0165C3 100%)" });
    expect(resolveEyebrowBox("", "#0B2A4A")).toBeUndefined();
    expect(resolveEyebrowBox("#ffcb2e", "")).toEqual({ background: "#FFCB2E", color: "#10253f" });
    expect(resolveEyebrowBox("#0165c3", "")).toEqual({ background: "#0165C3", color: "#ffffff" });
    expect(resolveEyebrowBox("#ffcb2e", "#0b2a4a")).toEqual({ background: "#FFCB2E", color: "#0B2A4A" });
    expect(start.eyebrowBoxBackground).toBe("");
    expect(start.eyebrowBoxColor).toBe("");
    expect(customHeroSectionFill("#e8f3ff", "#003d75", "#0165c3")).toEqual({ gradient: "linear-gradient(170deg, #E8F3FF 0%, #0165C3 40%, #003D75 100%)" });
    expect(start.benefitsTileGap).toBe("medium");
    expect(start.badges.map(badge => badge.label)).toEqual(["Homeoffice", "10.000 €"]);
    expect(start.badges[0]).toMatchObject({ icon: "", iconPosition: "left" });
    expect(resolveBadgeIcon("home")).toBe("home");
    expect(resolveBadgeIcon("kein-icon")).toBe("");
    expect(resolveBadgeIconPosition(undefined)).toBe("left");
    expect(resolveBadgeIconPosition("right")).toBe("right");
    const withIcon = funnelConfigSchema.parse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => page.type === "start"
        ? { ...page, badges: [{ id: "badge-icon", label: "Team", icon: "users", iconPosition: "right" as const }] }
        : page),
    }).pages[0];
    if (withIcon?.type === "start") {
      expect(withIcon.badges[0]).toMatchObject({ icon: "users", iconPosition: "right" });
    }
    expect(resolveBadgeColors({ backgroundColor: "#0165C3" }, "#10253f")).toEqual({ background: "#0165C3", text: "#ffffff" });
    expect(resolveBadgeColors({ backgroundColor: "#0165C3" }, "#10253f", "#0165C3")).toEqual({ background: "#0165C3", text: "#ffffff" });
    expect(resolveBadgeColors({ backgroundColor: "#E8F2FB" }, "#10253f", "#0165C3")).toEqual({ background: "#E8F2FB", text: "#0165C3" });
    expect(resolveBadgeColors({ backgroundColor: "#E8F2FB", textColor: "#C8102E" }, "#10253f", "#0165C3")).toEqual({ background: "#E8F2FB", text: "#C8102E" });
    expect(resolveBadgeColors({ backgroundColor: "#e8f2fb", textColor: "#0165c3" }, "#10253f")).toEqual({ background: "#E8F2FB", text: "#0165C3" });
    expect(resolveBadgeColors({ backgroundColor: "transparent" }, "#10253f", "#0165C3")).toEqual({ background: "transparent", text: "#10253F" });
    expect(resolveBadgeColors({ backgroundColor: "transparent", textColor: "#ffffff" }, "#10253f")).toEqual({ background: "transparent", text: "#FFFFFF" });
    expect(resolveBadgeBorderColor({ backgroundColor: "transparent" }, "#FFFFFF", "fallback")).toBe("color-mix(in srgb, #FFFFFF 35%, transparent)");
    expect(resolveBadgeBorderColor({ backgroundColor: "#0165c3" }, "#FFFFFF", "fallback")).toBe("#0165C3");
    expect(resolveBadgeBorderColor({}, "#FFFFFF", "fallback")).toBe("fallback");
    expect(resolveBadgeBorderColor({ backgroundColor: "transparent", borderColor: "#c8102e" }, "#FFFFFF", "fallback")).toBe("#C8102E");
    expect(resolveBadgeBorderWidth(undefined)).toBe(1);
    expect(resolveBadgeBorderWidth(0)).toBe(0);
    expect(resolveBadgeBorderWidth(12)).toBe(8);
    expect(resolveBadgeBorderWidth(2.6)).toBe(3);
    expect(normalizeBadgeBackground("Transparent")).toBe("transparent");
    expect(badgeEditorBackground({ backgroundColor: "transparent" }, "#FFFFFF", "transparent")).toBe("#334155");
    expect(badgeEditorBackground({ backgroundColor: "transparent" }, "#10253F", "transparent")).toBe("transparent");
    expect(badgeEditorBackground({ backgroundColor: "#0165C3" }, "#FFFFFF", "#0165C3")).toBe("#0165C3");
    expect(resolveStartTextAlign("left")).toBe("left");
    expect(resolveStartTextAlign(undefined)).toBe("center");
    expect(resolveStartButtonAlign("full")).toBe("full");
    expect(resolveStartButtonAlign("rechts")).toBe("center");
    expect(resolveButtonRadius(80)).toBe(60);
    expect(resolveButtonRadius("8")).toBeUndefined();
    expect(buttonOverrideVars(undefined, undefined, 8)).toEqual({ borderRadius: "8px" });
    expect(buttonOverrideVars()).toBeUndefined();
    expect(normalizeBadgeBackground("#0165c3")).toBe("#0165C3");
    expect(normalizeBadgeBackground("rgba(0,0,0,0)")).toBe("");
    expect(moveStartBadge(start.badges, "badge-2", "badge-1").map(badge => badge.id)).toEqual(["badge-2", "badge-1"]);
    expect(moveStartBadge(start.badges, "badge-1", "badge-1")).toBe(start.badges);
    expect(moveStartBadge(start.badges, "fehlt", "badge-1")).toBe(start.badges);
    const colored = patchStartBadge(
      patchStartBadge(start.badges, "badge-1", { backgroundColor: "#0165C3" }),
      "badge-1",
      { textColor: "#FFFFFF" },
    );
    expect(colored[0]).toMatchObject({ backgroundColor: "#0165C3", textColor: "#FFFFFF" });
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
      Reflect.deleteProperty(start, "heroBackgroundFocusX");
      Reflect.deleteProperty(start, "heroImageLayout");
      Reflect.deleteProperty(start, "heroImageRadius");
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
      expect(page.benefitsSectionBackground).toBe("");
      expect(page.benefitsCardBackground).toBe("");
      expect(page.heroSectionBackground).toBe("");
      expect(page.badges).toEqual([]);
      expect(page.heroBackgroundOpacity).toBe(15);
      expect(page.heroBackgroundFocusX).toBe(50);
      expect(page.heroBackgroundDesktopUrl).toBe("");
      expect(page.heroImageLayout).toBe("circle");
      expect(page.heroImageRadius).toBe(28);
    }
  });
});

describe("Button-Farbe", () => {
  it("nutzt ohne eigene Farbe die Akzentfarbe wie bisher", () => {
    expect(resolveButtonColors(defaultFunnel.brand)).toEqual({ background: "#0165c3", text: "#ffffff", hover: undefined });
  });

  it("trennt die Button-Farbe vom Fortschritt und wählt passenden Text", () => {
    expect(resolveButtonColors({ ...defaultFunnel.brand, buttonColor: "#ffd400" })).toMatchObject({ background: "#ffd400", text: "#10253f" });
    expect(resolveButtonColors({ ...defaultFunnel.brand, buttonColor: "#c0392b", buttonTextColor: "#fff000" })).toMatchObject({ background: "#c0392b", text: "#fff000" });
    expect(resolveButtonColors({ ...defaultFunnel.brand, buttonColor: "#c0392b" }).hover).toContain("#c0392b");
  });

  it("akzeptiert leere oder gültige Hexwerte im Schema", () => {
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, brand: { ...defaultFunnel.brand, buttonColor: "#ff6600", buttonTextColor: "" } }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, brand: { ...defaultFunnel.brand, buttonColor: "orange" } }).success).toBe(false);
  });

  it("überschreibt die Farbe pro Button, leer erbt die globale Einstellung", () => {
    expect(buttonOverrideVars("", "")).toBeUndefined();
    expect(buttonOverrideVars(undefined, undefined)).toBeUndefined();
    expect(buttonOverrideVars("#ffd400", "")).toMatchObject({ "--funnel-button": "#ffd400", "--funnel-button-text": "#10253f" });
    expect(buttonOverrideVars("", "#000000")).toEqual({ "--funnel-button-text": "#000000" });
  });

  it("normalisiert Button-Farben pro Seite verlustfrei", () => {
    const config = structuredClone(defaultFunnel);
    const start = config.pages.find(page => page.type === "start");
    if (!start || start.type !== "start") throw new Error("start page missing");
    Object.assign(start, { buttonColor: "#ffd400", secondaryButtonColor: "kaputt" });
    const normalized = normalizeFunnelConfig(config, true);
    const normalizedStart = normalized.pages.find(page => page.type === "start");
    expect(normalizedStart).toMatchObject({ buttonColor: "#ffd400", buttonTextColor: "", secondaryButtonColor: "", secondaryButtonTextColor: "" });
    expect(funnelConfigSchema.safeParse(normalized).success).toBe(true);
    expect(normalized.pages.filter(page => page.type !== "start").every(page => page.buttonColor === "")).toBe(true);
  });
});
