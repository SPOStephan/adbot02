import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StartStep } from "../client/src/components/funnel/StartStep";
import { defaultFunnel } from "../shared/defaultFunnel";
import { defaultStartBenefits } from "../shared/startLayout";
import type { StartPage } from "../shared/funnel";

function getStartPage(): StartPage {
  const page = defaultFunnel.pages.find((candidate): candidate is StartPage => candidate.type === "start");
  if (!page) throw new Error("Der Standard-Funnel benötigt eine Startseite.");
  return page;
}

describe("StartStep Layouts", () => {
  it("behält das klassische Startlayout als Default", () => {
    const html = renderToStaticMarkup(<StartStep page={getStartPage()} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).toContain("funnel-start-step");
    expect(html).not.toContain("funnel-start-benefits");
    expect(html).toContain(getStartPage().buttonLabel);
  });

  it("rendert die Vorteile-Variante mit zwei-Spalten-Kacheln und Branding-Trenner", () => {
    const page: StartPage = {
      ...getStartPage(),
      layout: "benefits",
      eyebrow: "Wir suchen dich!",
      title: "Bauleiter:in (m/w/d)",
      benefitsBandTitle: "Deine Vorteile bei uns",
      secondaryButtonLabel: "Jetzt bewerben",
      benefits: defaultStartBenefits(() => "tile"),
    };
    const html = renderToStaticMarkup(<StartStep page={page} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).toContain("funnel-start-benefits");
    expect(html).toContain("funnel-start-benefits-tiles");
    expect(html).toContain("Deine Vorteile bei uns");
    expect(html).toContain("Wir suchen dich!");
    expect(html).toContain("Jetzt bewerben");
    expect(html).toContain("30 Tage Urlaub");
    expect(html).not.toContain("funnel-start-benefits-hero-bg");
    expect(html).toContain('class="funnel-start-benefits-tiles"');
  });

  it("legt das Hintergrundbild nur im Hero mit einstellbarer Deckkraft", () => {
    const page: StartPage = {
      ...getStartPage(),
      layout: "benefits",
      heroBackgroundDesktopUrl: "https://cdn.example.org/desktop.webp",
      heroBackgroundMobileUrl: "https://cdn.example.org/mobile.webp",
      heroBackgroundOpacity: 20,
      benefits: [],
    };
    const html = renderToStaticMarkup(<StartStep page={page} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).toContain("funnel-start-benefits-hero-bg");
    expect(html).toContain("https://cdn.example.org/mobile.webp");
    expect(html).toContain("opacity:0.2");
  });
});
