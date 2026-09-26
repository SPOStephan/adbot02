import { describe, expect, it } from "vitest";
import { hyphenateGermanHtml, hyphenateGermanText, stripSoftHyphens } from "@shared/hyphenateGerman";

describe("deutsche Worttrennung", () => {
  it("trennt Immobilienfinanzierung nach der reformierten Rechtschreibung", () => {
    expect(hyphenateGermanText("Immobilienfinanzierung")).toBe("Im\u00ADmo\u00ADbi\u00ADli\u00ADen\u00ADfi\u00ADnan\u00ADzie\u00ADrung");
    expect(hyphenateGermanText("Baufinanzierung")).toBe("Bau\u00ADfi\u00ADnan\u00ADzie\u00ADrung");
    expect(hyphenateGermanText("Immobilienfinanzierung").startsWith("I\u00AD")).toBe(false);
  });

  it("lässt HTML-Tags und Entities unangetastet", () => {
    expect(hyphenateGermanHtml("<b>Immobilienfinanzierung / Baufinanzierung</b>")).toBe(
      "<b>Im\u00ADmo\u00ADbi\u00ADli\u00ADen\u00ADfi\u00ADnan\u00ADzie\u00ADrung / Bau\u00ADfi\u00ADnan\u00ADzie\u00ADrung</b>",
    );
    expect(hyphenateGermanHtml("Bau &amp; Montagefinanzierung")).toContain("&amp;");
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
