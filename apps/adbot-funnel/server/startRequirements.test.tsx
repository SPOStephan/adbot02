import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StartStep } from "../client/src/components/funnel/StartStep";
import { defaultFunnel } from "../shared/defaultFunnel";
import type { StartPage } from "../shared/funnel";
import { funnelConfigSchema } from "../shared/funnelSchemas";
import { stripSoftHyphens } from "../shared/hyphenateGerman";
import { defaultStartRequirements, resolveStartRequirements, visibleStartRequirements } from "../shared/startRequirements";

function benefitsPage(extra: Partial<StartPage> = {}): StartPage {
  const page = defaultFunnel.pages.find((candidate): candidate is StartPage => candidate.type === "start");
  if (!page) throw new Error("Der Standard-Funnel benötigt eine Startseite.");
  return { ...page, layout: "benefits", benefitsBandTitle: "Deine Vorteile bei Boncred", ...extra };
}

describe("Checkliste „Das bringst Du mit“", () => {
  it("bleibt bei bestehenden Funnels ohne Einstellung unsichtbar", () => {
    const html = renderToStaticMarkup(<StartStep page={benefitsPage()} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    expect(html).not.toContain("funnel-start-requirements");
  });

  it("bleibt ausgeschaltet unsichtbar, auch mit Punkten", () => {
    const requirements = { ...defaultStartRequirements(() => "id"), enabled: false };
    expect(visibleStartRequirements({ requirements })).toBeNull();
  });

  it("rendert Überschrift und Punkte oberhalb des Vorteile-Trenners", () => {
    const requirements = {
      ...defaultStartRequirements(() => "req"),
      enabled: true,
      title: "Das bringst Du mit:",
      items: [{ id: "a", text: "Sachkundenachweis nach §34i GewO" }, { id: "b", text: "" }],
      iconColor: "#0165C3",
      textColor: "#112233",
      titleSizeStep: 2,
    };
    const html = renderToStaticMarkup(<StartStep page={benefitsPage({ requirements })} brand={defaultFunnel.brand} onContinue={vi.fn()} />);
    const visible = stripSoftHyphens(html);
    const listAt = html.indexOf("funnel-start-requirements");
    const bandAt = html.indexOf("funnel-start-benefits-band");
    expect(listAt).toBeGreaterThan(-1);
    expect(bandAt).toBeGreaterThan(listAt);
    expect(visible).toContain("Das bringst Du mit:");
    expect(visible).toContain("Sachkundenachweis nach §34i GewO");
    expect(html.match(/<li>/g)?.length).toBe(1);
    expect(html).toContain("background:#0165C3");
    expect(html).toContain("color:#112233");
    expect(html).toContain("--fs-req-title:1.12");
  });

  it("normalisiert fehlerhafte Werte und akzeptiert die Einstellung im Schema", () => {
    const resolved = resolveStartRequirements({ enabled: true, icon: "gibt-es-nicht", iconColor: "rot", iconStyle: "plain", titleSizeStep: 99, items: [{ id: "x", text: "Punkt" }] });
    expect(resolved.icon).toBe("check");
    expect(resolved.iconColor).toBe("");
    expect(resolved.iconStyle).toBe("plain");
    expect(resolved.titleSizeStep).toBe(8);
    expect(resolved.items).toEqual([{ id: "x", text: "Punkt" }]);

    const config = {
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => page.type === "start" ? { ...page, requirements: { ...defaultStartRequirements(() => "r"), enabled: true } } : page),
    };
    expect(funnelConfigSchema.safeParse(config).success).toBe(true);
  });
});
