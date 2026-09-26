import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StartStep } from "../client/src/components/funnel/StartStep";
import { defaultFunnel } from "../shared/defaultFunnel";
import { defaultStartBenefits } from "../shared/startLayout";
import type { StartPage } from "../shared/funnel";
import { stripSoftHyphens } from "../shared/hyphenateGerman";

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
      title: 'Bauleiter:in <small><span style="color: #607287">(m/w/d)</span></small>',
      subtitle: '<span style="color: #0165C3">Du verkaufst Versicherungen</span>',
      benefitsBandTitle: "Deine Vorteile bei uns",
      secondaryButtonLabel: "Jetzt bewerben",
      benefits: defaultStartBenefits(() => "tile"),
    };
    const html = renderToStaticMarkup(<StartStep page={page} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    const visible = stripSoftHyphens(html);
    expect(html).toContain("funnel-start-benefits");
    expect(html).toContain("funnel-start-benefits-tiles");
    expect(visible).toContain("Deine Vorteile bei uns");
    expect(visible).toContain("Wir suchen dich!");
    const kickerAt = html.indexOf("funnel-start-benefits-kicker");
    const subtitleAt = html.indexOf("funnel-start-benefits-subtitle");
    expect(kickerAt).toBeGreaterThan(-1);
    expect(subtitleAt).toBeGreaterThan(kickerAt);
    expect(html.slice(kickerAt, subtitleAt)).toMatch(/<h1\b/);
    expect(visible).toContain("Du verkaufst Versicherungen");
    expect(html).toContain("#0165C3");
    expect(html).toContain("Jetzt bewerben");
    expect(visible).toContain("30 Tage Urlaub");
    expect(html).not.toContain("funnel-start-benefits-hero-bg");
    expect(html).toContain("funnel-start-benefits-tiles");
    expect(html).toContain("is-two-column");
    expect(html).toContain("is-gap-medium");
    expect(html).toContain("funnel-start-benefits-copy");
    expect(html).not.toContain("funnel-start-benefits-portrait");
    expect(html).not.toContain("funnel-start-benefits-badges");
    expect(html).toContain("<small>");
    expect(html).toContain("(m/w/d)");
    expect(html).toContain("#607287");
  });

  it("blendet Überzeile und Beschreibung der Startseite aus", () => {
    const page: StartPage = {
      ...getStartPage(),
      layout: "benefits",
      eyebrow: "Wir suchen dich!",
      eyebrowVisible: false,
      descriptionVisible: false,
      benefits: defaultStartBenefits(() => "tile"),
    };
    const html = renderToStaticMarkup(<StartStep page={page} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).not.toContain("Wir suchen dich!");
    expect(html).not.toContain("funnel-start-benefits-lead");
    expect(stripSoftHyphens(html)).toContain(page.title);
  });

  it("setzt einspaltige Kacheln, Portrait und Badges als eigene Elemente", () => {
    const page: StartPage = {
      ...getStartPage(),
      layout: "benefits",
      heroImageUrl: "https://cdn.example.org/portrait.jpg",
      benefitsTileLayout: "one-column",
      badges: [
        { id: "badge-home", label: "Homeoffice", backgroundColor: "#E8F2FB", textColor: "#0165C3" },
        { id: "badge-fixum", label: "Fixum + Provision" },
      ],
      benefits: defaultStartBenefits(() => "tile"),
    };
    const html = renderToStaticMarkup(<StartStep page={page} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).toContain("funnel-start-benefits-portrait");
    expect(html).toContain("is-circle");
    expect(html).toContain("https://cdn.example.org/portrait.jpg");
    const wideImage = renderToStaticMarkup(<StartStep page={{ ...page, heroImageLayout: "wide", heroImageRadius: 0 }} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(wideImage).toContain("is-wide");
    expect(wideImage).toContain("--hero-image-radius:0px");
    expect(html).toContain("funnel-start-benefits-badges");
    expect(html).toContain("Homeoffice");
    expect(html).toContain("Fixum + Provision");
    expect(html).toContain("is-one-column");
    const wide = renderToStaticMarkup(<StartStep page={{ ...page, benefitsTileLayout: "two-column", benefitsTileGap: "large" }} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(wide).toContain("is-gap-large");
    const cards = renderToStaticMarkup(<StartStep page={{ ...page, benefitsTileLayout: "cards", benefitsSectionBackground: "#E8F2FB", benefitsCardBackground: "#FFFFFF" }} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(cards).toContain("is-cards");
    expect(cards).toContain("#E8F2FB");
    expect(cards).toContain("--benefits-card-bg:#FFFFFF");
    expect(html).not.toContain("has-image");
    expect(html).not.toContain("funnel-start-benefits-hero-photo");
  });

  it("legt das Hintergrundbild nur im Hero mit einstellbarer Deckkraft", () => {
    const page: StartPage = {
      ...getStartPage(),
      layout: "benefits",
      heroBackgroundDesktopUrl: "https://cdn.example.org/desktop.webp",
      heroBackgroundMobileUrl: "https://cdn.example.org/mobile.webp",
      heroBackgroundOpacity: 20,
      heroBackgroundFocusX: 20,
      benefits: [],
    };
    const html = renderToStaticMarkup(<StartStep page={page} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).toContain("funnel-start-benefits-hero-bg");
    expect(html).toContain("https://cdn.example.org/mobile.webp");
    expect(html).toContain("opacity:0.2");
    expect(html).toContain("--hero-bg-focus-x:20%");
  });
});
