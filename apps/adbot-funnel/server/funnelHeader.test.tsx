import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelChrome } from "../client/src/components/funnel/FunnelChrome";
import { defaultFunnel } from "@shared/defaultFunnel";
import type { FunnelConfig } from "@shared/funnel";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { logoTintFilter, resolveFunnelHeader } from "@shared/funnelHeader";
import { normalizeProgress, progressColorsForPage } from "@shared/progressLayout";
import { normalizeFunnelConfig } from "./funnelStore";

const WHITE = "#FFFFFF";

function blueStartFunnel(): FunnelConfig {
  return {
    ...defaultFunnel,
    brand: {
      ...defaultFunnel.brand,
      logoUrl: "https://cdn.example.com/logo.png",
      logoTint: "white",
      securityTextColor: WHITE,
      stepsHeader: { enabled: true, logoUrl: "", logoTint: "original", securityTextColor: "" },
    },
    progress: {
      ...defaultFunnel.progress,
      colors: { ...defaultFunnel.progress.colors, active: WHITE, text: WHITE },
      stepsColors: { enabled: true, active: "", completed: "", upcoming: "", text: "", muted: "", track: "" },
    },
  };
}

function renderChrome(config: FunnelConfig, step: number) {
  return renderToStaticMarkup(
    <FunnelChrome brand={config.brand} socialProof={config.socialProof} privacyUrl="/d" privacyLabel="Datenschutz" imprintUrl="/i" step={step} totalSteps={config.pages.length} showProgress pages={config.pages} progress={config.progress}>
      <p>Inhalt</p>
    </FunnelChrome>,
  );
}

describe("Logo und Fortschritt je Seite", () => {
  it("lässt bestehende Funnels ohne Folgeseiten-Einstellung überall gleich aussehen", () => {
    const config: FunnelConfig = { ...defaultFunnel, brand: { ...defaultFunnel.brand, logoUrl: "/logo.png", securityTextColor: WHITE } };
    expect(resolveFunnelHeader(config.brand, false)).toEqual(resolveFunnelHeader(config.brand, true));
    expect(progressColorsForPage(config.progress, false)).toBe(config.progress.colors);
    expect(normalizeProgress(config.progress)).not.toHaveProperty("stepsColors");
  });

  it("nutzt auf der Startseite die weißen und danach die eigenen Einstellungen", () => {
    const config = blueStartFunnel();
    expect(resolveFunnelHeader(config.brand, true)).toMatchObject({ logoTint: "white", securityTextColor: WHITE });
    expect(resolveFunnelHeader(config.brand, false)).toEqual({ logoUrl: "https://cdn.example.com/logo.png", logoTint: "original", securityTextColor: "" });
    expect(progressColorsForPage(config.progress, true).active).toBe(WHITE);
    expect(progressColorsForPage(config.progress, false).active).toBe("");

    const start = renderChrome(config, 0);
    expect(start).toContain("filter:brightness(0) invert(1)");
    expect(start).toContain(`--fp-active:${WHITE}`);
    const next = renderChrome(config, 1);
    expect(next).not.toContain("filter:");
    expect(next).toContain("--fp-active:#0165c3");
  });

  it("zeigt ab Seite 2 ein eigenes Logo, wenn eines hinterlegt ist", () => {
    const config = blueStartFunnel();
    config.brand.stepsHeader = { enabled: true, logoUrl: "https://cdn.example.com/logo-dunkel.png", logoTint: "original", securityTextColor: "" };
    expect(renderChrome(config, 1)).toContain("logo-dunkel.png");
    expect(renderChrome(config, 0)).not.toContain("logo-dunkel.png");
  });

  it("übersetzt Logo-Farben in CSS-Filter", () => {
    expect(logoTintFilter("original")).toBeUndefined();
    expect(logoTintFilter(undefined)).toBeUndefined();
    expect(logoTintFilter("white")).toBe("brightness(0) invert(1)");
    expect(logoTintFilter("dark")).toBe("brightness(0)");
  });

  it("speichert und normalisiert die neuen Felder", () => {
    const config = blueStartFunnel();
    const parsed = funnelConfigSchema.parse(config);
    expect(parsed.brand.stepsHeader).toEqual(config.brand.stepsHeader);
    expect(parsed.progress.stepsColors?.enabled).toBe(true);
    const normalized = normalizeFunnelConfig({ ...config, brand: { ...config.brand, logoTint: "bogus" as never, stepsHeader: { enabled: true } as never } } as never, true);
    expect(normalized.brand.logoTint).toBe("original");
    expect(normalized.brand.stepsHeader).toEqual({ enabled: true, logoUrl: "", logoTint: "original", securityTextColor: "" });
  });
});
