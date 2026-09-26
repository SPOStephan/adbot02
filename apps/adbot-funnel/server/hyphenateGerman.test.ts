import { describe, expect, it } from "vitest";
import { hyphenateGermanHtml, hyphenateGermanText, SOFT_HYPHEN, stripSoftHyphens } from "@shared/hyphenateGerman";

describe("deutsche Worttrennung", () => {
  it("trennt nur Wörter, die einen Kasten sprengen würden", () => {
    expect(hyphenateGermanText("Immobilienfinanzierung")).toBe("Im\u00ADmo\u00ADbi\u00ADli\u00ADen\u00ADfi\u00ADnan\u00ADzie\u00ADrung");
    expect(hyphenateGermanText("Immobilienfinanzierung").startsWith("I\u00AD")).toBe(false);
    expect(hyphenateGermanText("Baufinanzierung")).toBe("Baufinanzierung");
    expect(hyphenateGermanText("Flexibilität")).toBe("Flexibilität");
    expect(hyphenateGermanText("Prozesse")).toBe("Prozesse");
    expect(hyphenateGermanText("Homeoffice und Flexibilität")).toBe("Homeoffice und Flexibilität");
    expect(hyphenateGermanText("Eingespielte Prozesse")).toBe("Eingespielte Prozesse");
    expect(hyphenateGermanText("Beratungstermine")).toBe("Beratungstermine");
    expect(hyphenateGermanText("Homeoffice und Flexibilität")).not.toContain(SOFT_HYPHEN);
  });

  it("lässt HTML-Tags und Entities unangetastet", () => {
    expect(hyphenateGermanHtml("<b>Immobilienfinanzierung / Baufinanzierung</b>")).toBe(
      "<b>Im\u00ADmo\u00ADbi\u00ADli\u00ADen\u00ADfi\u00ADnan\u00ADzie\u00ADrung / Baufinanzierung</b>",
    );
    expect(hyphenateGermanHtml("Bau &amp; Montagefinanzierung")).toContain("&amp;");
    expect(hyphenateGermanHtml("<strong>Eingespielte Prozesse</strong>")).toBe("<strong>Eingespielte Prozesse</strong>");
    expect(stripSoftHyphens(hyphenateGermanHtml('<small><span style="color: #607287">(m/w/d)</span></small>'))).toBe(
      '<small><span style="color: #607287">(m/w/d)</span></small>',
    );
    expect(stripSoftHyphens(hyphenateGermanHtml("<i>Immobilienfinanzierung</i>"))).toBe("<i>Immobilienfinanzierung</i>");
  });

  it("verdoppelt vorhandene weiche Trennstriche nicht", () => {
    const once = hyphenateGermanText("Immobilienfinanzierung");
    expect(hyphenateGermanText(once)).toBe(once);
  });
});
