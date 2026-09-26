import { describe, expect, it } from "vitest";
import { HERO_IMAGE_MAX, scaleToMaxBox } from "@shared/heroBackground";
import { clampHeroBackgroundFocusX, clampHeroBackgroundOpacity } from "@shared/startLayout";
import { defaultFunnel } from "@shared/defaultFunnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { createFunnelMediaAsset, listFunnelMediaAssets, resetFunnelMediaStoreForTests } from "./funnelMediaStore";
import { buildFunnelBunnyPath, isBunnyConfigured } from "./bunny";

describe("Hintergrundbild Zuschnitt und Bibliothek", () => {
  it("skaliert in die Maximalbox und behält das volle Motiv", () => {
    expect(scaleToMaxBox(4000, 3000, 1920, 1200)).toEqual({ width: 1600, height: 1200 });
    expect(scaleToMaxBox(800, 600, 1920, 1200)).toEqual({ width: 800, height: 600 });
    expect(scaleToMaxBox(1000, 4000, 1920, 1200)).toEqual({ width: 300, height: 1200 });
    expect(scaleToMaxBox(2400, 1000, 1920, 1200)).toEqual({ width: 1920, height: 800 });
    expect(scaleToMaxBox(2400, 1800, HERO_IMAGE_MAX.maxWidth, HERO_IMAGE_MAX.maxHeight)).toEqual({ width: 1200, height: 900 });
  });

  it("begrenzt den Horizontal-Fokus auf 0–100 und fällt auf 50 zurück", () => {
    expect(clampHeroBackgroundFocusX(50)).toBe(50);
    expect(clampHeroBackgroundFocusX(-8)).toBe(0);
    expect(clampHeroBackgroundFocusX(140)).toBe(100);
    expect(clampHeroBackgroundFocusX("x")).toBe(50);
  });

  it("begrenzt die Deckkraft auf 0–100 und fällt auf 15 zurück", () => {
    expect(clampHeroBackgroundOpacity(15)).toBe(15);
    expect(clampHeroBackgroundOpacity(-4)).toBe(0);
    expect(clampHeroBackgroundOpacity(140)).toBe(100);
    expect(clampHeroBackgroundOpacity("x")).toBe(15);
  });

  it("akzeptiert das Vorteile-Layout mit Hintergrund-URLs", () => {
    const pages = defaultFunnel.pages.map(page => page.type === "start"
      ? {
        ...page,
        layout: "benefits" as const,
        heroBackgroundDesktopUrl: "https://cdn.example.org/desktop.webp",
        heroBackgroundMobileUrl: "https://cdn.example.org/mobile.webp",
        heroBackgroundOpacity: 18,
      }
      : page);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, pages }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => page.type === "start" ? { ...page, heroBackgroundDesktopUrl: "javascript:alert(1)" } : page),
    }).success).toBe(false);
  });

  it("legt Bunny-Pfade unter funnels/owner an und merkt fehlende Credentials", () => {
    expect(buildFunnelBunnyPath("11111111-1111-4111-8111-111111111111", "desktop.webp")).toMatch(/^funnels\/11111111-1111-4111-8111-111111111111\/backgrounds\//);
    expect(isBunnyConfigured()).toBe(false);
  });

  it("speichert die kundenspezifische Bibliothek im Speicher", async () => {
    resetFunnelMediaStoreForTests();
    const ownerUserId = "11111111-1111-4111-8111-111111111111";
    const created = await createFunnelMediaAsset({
      ownerUserId,
      funnelId: defaultFunnel.id,
      filename: "baustelle.jpg",
      desktopUrl: "https://cdn.example.org/d.webp",
      mobileUrl: "https://cdn.example.org/m.webp",
      bunnyPathDesktop: "funnels/owner/d.webp",
      bunnyPathMobile: "funnels/owner/m.webp",
    });
    const listed = await listFunnelMediaAssets({ ownerUserId, funnelId: defaultFunnel.id });
    expect(listed).toEqual([expect.objectContaining({ id: created.id, filename: "baustelle.jpg" })]);
  });
});
