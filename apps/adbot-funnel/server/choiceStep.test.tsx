import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChoiceStep } from "../client/src/components/funnel/ChoiceStep";
import { defaultFunnel } from "../shared/defaultFunnel";
import type { ChoicePage } from "../shared/funnel";

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
    expect(html).toContain(page.title);
    expect(html).not.toContain(`aria-describedby="${page.id}-description"`);
  });
});
