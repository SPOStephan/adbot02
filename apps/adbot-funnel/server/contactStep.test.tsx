import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContactStep } from "../client/src/components/funnel/ContactStep";
import { defaultFunnel } from "../shared/defaultFunnel";
import type { ContactPage } from "../shared/funnel";

function getContactPage(): ContactPage {
  const page = defaultFunnel.pages.find((candidate): candidate is ContactPage => candidate.type === "contact");
  if (!page) throw new Error("Der Standard-Funnel benötigt eine Kontaktseite.");
  return page;
}

const contactPage = getContactPage();

function renderContactStep() {
  return renderToStaticMarkup(
    <ContactStep
      page={contactPage}
      contact={{}}
      consent={false}
      pending={false}
      onContactChange={vi.fn()}
      onConsentChange={vi.fn()}
      onResumeChange={vi.fn()}
      onFileError={vi.fn()}
      onBack={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

describe("ContactStep Einwilligungen", () => {
  it("zeigt die erforderliche Datenschutz-Einwilligung unverändert an", () => {
    const html = renderContactStep();
    const privacyInput = html.match(new RegExp(`<input id="${contactPage.id}-consent"[^>]*>`))?.[0];

    expect(privacyInput).toBeDefined();
    expect(privacyInput).toContain("required");
    expect(html).toContain(contactPage.consentLabel);
  });

  it("rendert keine separate Meta-Tracking-Einwilligung", () => {
    const html = renderContactStep();
    expect(html).not.toContain(`${contactPage.id}-tracking-consent`);
    expect(html).not.toContain("freiwillige Meta-Erfolgsmessung");
    expect(html).not.toContain("<small>Optional</small>");
  });
});
