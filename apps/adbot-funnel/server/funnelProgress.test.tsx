import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelProgress } from "../client/src/components/funnel/FunnelProgress";
import { defaultFunnel } from "../shared/defaultFunnel";
import type { ProgressLayout } from "../shared/funnel";
import { PROGRESS_LAYOUTS } from "../shared/funnel";

describe("FunnelProgress Markup", () => {
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

  it.each(PROGRESS_LAYOUTS.filter(layout => layout !== "percent"))("rendert Variante %s mit Stufentexten", (layout: ProgressLayout) => {
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

  it("färbt aktive Elemente mit Override statt Branding", () => {
    const html = renderToStaticMarkup(
      <FunnelProgress
        brand={defaultFunnel.brand}
        progress={{ layout: "minimal", colors: { ...defaultFunnel.progress.colors, active: "#C8102E" } }}
        pages={defaultFunnel.pages}
        step={0}
      />,
    );
    expect(html).toContain("#C8102E");
  });
});
