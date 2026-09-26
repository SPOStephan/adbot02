import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChoiceStep } from "../client/src/components/funnel/ChoiceStep";
import { defaultFunnel } from "../shared/defaultFunnel";
import type { ChoicePage } from "../shared/funnel";
import { stripSoftHyphens } from "../shared/hyphenateGerman";

function getChoicePage(): ChoicePage {
  const page = defaultFunnel.pages.find((candidate): candidate is ChoicePage => candidate.type === "choice-grid");
  if (!page) throw new Error("Der Standard-Funnel benötigt eine Auswahlseite.");
  return page;
}

describe("ChoiceStep Fortschritt", () => {
  it("blendet Weiter bei Einfachauswahl aus und behält es bei Mehrfachauswahl", () => {
    const page = getChoicePage();
    const single = renderToStaticMarkup(<ChoiceStep page={page} selected={[]} onSelect={vi.fn()} onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(single).toContain("Zurück");
    expect(single).not.toContain(page.buttonLabel);
    const multiple = renderToStaticMarkup(<ChoiceStep page={{ ...page, allowMultiple: true }} selected={[]} onSelect={vi.fn()} onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(multiple).toContain(page.buttonLabel);
  });

  it("blendet Überzeile und Beschreibung aus, behält die Überschrift für Screenreader", () => {
    const page: ChoicePage = {
      ...getChoicePage(),
      eyebrowVisible: false,
      titleVisible: false,
      descriptionVisible: false,
    };
    const html = renderToStaticMarkup(<ChoiceStep page={page} selected={[]} onSelect={vi.fn()} onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(html).not.toContain(page.eyebrow);
    expect(html).not.toContain(page.description);
    expect(html).toContain("funnel-sr-only");
    expect(stripSoftHyphens(html)).toContain(page.title);
    expect(html).not.toContain(`aria-describedby="${page.id}-description"`);
  });

  it("setzt in langen Optionstexten weiche Trennstriche", () => {
    const page: ChoicePage = {
      ...getChoicePage(),
      options: getChoicePage().options.map((option, index) => index === 0
        ? { ...option, label: "Immobilienfinanzierung / Baufinanzierung" }
        : option),
    };
    const html = renderToStaticMarkup(<ChoiceStep page={page} selected={[]} onSelect={vi.fn()} onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(html).toContain("funnel-choice-text");
    expect(html).toContain("\u00AD");
    expect(html.replaceAll("\u00AD", "")).toContain("Immobilienfinanzierung / Baufinanzierung");
    expect(html).toContain("Im\u00ADmo\u00ADbi\u00ADli\u00ADen\u00ADfi\u00ADnan\u00ADzie\u00ADrung");
  });
});
