import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelProgress } from "../client/src/components/funnel/FunnelProgress";
import { defaultFunnel } from "../shared/defaultFunnel";
import type { ProgressLayout } from "../shared/funnel";
import { PROGRESS_LAYOUTS } from "../shared/funnel";

describe("FunnelProgress Markup", () => {
  it("zählt ausgeblendete Ideenseiten nicht in der Fortschrittsanzeige", () => {
    const pages = defaultFunnel.pages.map(page => page.id === "page-role" ? { ...page, hidden: true } : page);
    const html = renderToStaticMarkup(
      <FunnelProgress brand={defaultFunnel.brand} progress={defaultFunnel.progress} pages={pages} step={2} />,
    );
    expect(html).toContain("Schritt 2 von 3");
    expect(html).not.toContain("Kurzprofil");
  });

  it("behält die bisherige Prozentanzeige als Default", () => {
    const html = renderToStaticMarkup(
      <FunnelProgress brand={defaultFunnel.brand} progress={defaultFunnel.progress} pages={defaultFunnel.pages} step={0} />,
    );
    expect(html).toContain("funnel-progress-percent");
    expect(html).toContain("Schritt 1 von 4");
    expect(html).toContain("0%");
    expect(html).toContain("funnel-progress-track");
    expect(html).not.toContain("Job-Check");
  });

  it.each(PROGRESS_LAYOUTS.filter(layout => layout !== "percent" && layout !== "reduced"))("rendert Variante %s mit Stufentexten", (layout: ProgressLayout) => {
    const html = renderToStaticMarkup(
      <FunnelProgress
        brand={defaultFunnel.brand}
        progress={{ ...defaultFunnel.progress, layout }}
        pages={defaultFunnel.pages}
        step={1}
      />,
    );
    expect(html).toContain(`funnel-progress-${layout}`);
    expect(html).toContain("Kurzprofil");
    expect(html).toContain('aria-valuenow="33"');
  });

  it("zeigt beschriftete Balken und hält die zweite Stufe über die Frageseiten", () => {
    const stages = [
      { id: "s1", label: "Bewerbung", startPageId: "page-start" },
      { id: "s2", label: "Matching", startPageId: "page-role" },
      { id: "s3", label: "Kennenlernen", startPageId: "page-contact" },
    ];
    const html = renderToStaticMarkup(
      <FunnelProgress
        brand={defaultFunnel.brand}
        progress={{ ...defaultFunnel.progress, layout: "segments", stages }}
        pages={defaultFunnel.pages}
        step={2}
      />,
    );
    expect(html).toContain("funnel-progress-segments");
    expect(html).toContain("Bewerbung");
    expect(html).toContain("Matching");
    expect(html).toContain("Kennenlernen");
    expect(html).toContain('data-state="current"');
    expect(html).toContain('aria-valuenow="50"');
  });

  it("hält den Kompakt-Balken oben und wiederholt die Seitenüberschrift nicht", () => {
    const html = renderToStaticMarkup(
      <FunnelProgress
        brand={defaultFunnel.brand}
        progress={{ ...defaultFunnel.progress, layout: "reduced" }}
        pages={defaultFunnel.pages}
        step={0}
      />,
    );
    expect(html).toContain("funnel-progress-reduced");
    expect(html).toContain("Schritt 1 von 4");
    expect(html).toContain("funnel-progress-track");
    expect(html).not.toContain("funnel-progress-reduced-copy");
    expect(html).not.toContain("Job-Check");
    expect(html.indexOf("funnel-progress-reduced-head")).toBeLessThan(html.indexOf("funnel-progress-track"));
  });

  it("zeigt bei Icon-Varianten den aktuellen Stufennamen als eine Zeile", () => {
    const html = renderToStaticMarkup(
      <FunnelProgress
        brand={defaultFunnel.brand}
        progress={{ ...defaultFunnel.progress, layout: "icons" }}
        pages={defaultFunnel.pages}
        step={0}
      />,
    );
    expect(html).toContain("funnel-progress-current-label");
    expect(html).toContain("Job-Check");
  });

  it("färbt aktive Elemente mit Override statt Branding", () => {
    const html = renderToStaticMarkup(
      <FunnelProgress
        brand={defaultFunnel.brand}
        progress={{ ...defaultFunnel.progress, layout: "minimal", colors: { ...defaultFunnel.progress.colors, active: "#C8102E" } }}
        pages={defaultFunnel.pages}
        step={0}
      />,
    );
    expect(html).toContain("#C8102E");
  });
});
