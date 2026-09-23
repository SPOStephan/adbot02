import { describe, expect, it } from "vitest";
import { applyAddressFormToConfig, rewriteAddressText } from "@shared/addressForm";
import { defaultFunnel } from "@shared/defaultFunnel";

describe("Sie/Du-Anrede", () => {
  it("wandelt typische Bewerbertexte von Du auf Sie", () => {
    expect(rewriteAddressText("Welcher Bereich passt am besten zu dir?", "du", "sie")).toBe("Welcher Bereich passt am besten zu Ihnen?");
    expect(rewriteAddressText("Wie viel Berufserfahrung bringst du mit?", "du", "sie")).toBe("Wie viel Berufserfahrung bringen Sie mit?");
    expect(rewriteAddressText("Vielen Dank für deine Bewerbung!", "du", "sie")).toBe("Vielen Dank für Ihre Bewerbung!");
    expect(rewriteAddressText("Hinterlasse deine Kontaktdaten. Wir melden uns persönlich und vertraulich bei dir.", "du", "sie")).toBe("Hinterlassen Sie Ihre Kontaktdaten. Wir melden uns persönlich und vertraulich bei Ihnen.");
    expect(rewriteAddressText("Beantworte wenige kurze Fragen.", "du", "sie")).toBe("Beantworten Sie wenige kurze Fragen.");
  });

  it("dreht die Standardtexte wieder auf Du zurück", () => {
    const sie = rewriteAddressText("Finde heraus, ob wir zueinander passen.", "du", "sie");
    expect(sie).toBe("Finden Sie heraus, ob wir zueinander passen.");
    expect(rewriteAddressText(sie, "sie", "du")).toBe("Finde heraus, ob wir zueinander passen.");
  });

  it("schreibt den gesamten Funnel um und merkt sich die Weiche", () => {
    const sie = applyAddressFormToConfig(defaultFunnel, "sie");
    expect(sie.addressForm).toBe("sie");
    expect(sie.title).toContain("Ihre Karriere");
    expect(sie.pages[0]?.title).toContain("Finden Sie heraus");
    expect(sie.gate.exitTitle).toContain("Ihr Interesse");
    const back = applyAddressFormToConfig(sie, "du");
    expect(back.addressForm).toBe("du");
    expect(back.title).toBe(defaultFunnel.title);
    expect(back.pages[0]?.title).toBe(defaultFunnel.pages[0]?.title);
  });
});
