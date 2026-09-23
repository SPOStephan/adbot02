import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExitStep } from "../client/src/components/funnel/ExitStep";
import { defaultFunnel } from "../shared/defaultFunnel";

describe("ExitStep", () => {
  it("zeigt den editierbaren Exit-Text ohne Weiter-Button", () => {
    const html = renderToStaticMarkup(
      <ExitStep gate={defaultFunnel.gate} mode="exit" continueLabel="Weiter" />,
    );
    expect(html).toContain(defaultFunnel.gate.exitTitle);
    expect(html).toContain(defaultFunnel.gate.exitText);
    expect(html).not.toContain("Jetzt Bewerbung");
  });

  it("ersetzt den Ziel-Funnel im Übergabetext und bietet den Button", () => {
    const html = renderToStaticMarkup(
      <ExitStep
        gate={defaultFunnel.gate}
        mode="handoff"
        targetTitle="Office Assistenz"
        continueLabel="Jetzt Bewerbung für diese Stelle fortsetzen"
        onContinue={vi.fn()}
      />,
    );
    expect(html).toContain("Office Assistenz");
    expect(html).toContain("Jetzt Bewerbung für diese Stelle fortsetzen");
  });
});
