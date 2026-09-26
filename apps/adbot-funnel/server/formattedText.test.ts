import { describe, expect, it } from "vitest";
import { isBlankFormattedText, sanitizeFormattedText, stripFormattedText } from "@shared/formattedText";

describe("formatierter Funnel-Text", () => {
  it("lässt Fett, Kursiv, Unterstrich und Hexfarbe zu", () => {
    const html = sanitizeFormattedText('Hallo <b>fett</b> <i>kursiv</i> <u>unten</u> <span style="color: rgb(1, 101, 195)">blau</span>');
    expect(html).toContain("<b>fett</b>");
    expect(html).toContain("<i>kursiv</i>");
    expect(html).toContain("<u>unten</u>");
    expect(html).toContain('style="color: #0165C3"');
    expect(stripFormattedText(html)).toBe("Hallo fett kursiv unten blau");
  });

  it("entfernt Scripts und fremde Attribute", () => {
    const html = sanitizeFormattedText('<b onclick="alert(1)">ok</b><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).toBe("<b>ok</b>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
  });

  it("erkennt leeren Markup-Text", () => {
    expect(isBlankFormattedText("<b>  </b>")).toBe(true);
    expect(isBlankFormattedText("<b>Hallo</b>")).toBe(false);
  });

  it("entfernt weiche Trennstriche aus gespeichertem Text", () => {
    expect(sanitizeFormattedText("Im\u00ADmobilienfinanzierung")).toBe("Immobilienfinanzierung");
    expect(sanitizeFormattedText("<b>Im\u00ADmobilien</b>")).toBe("<b>Immobilien</b>");
    expect(stripFormattedText("Im\u00ADmo &amp; Bau")).toBe("Immo & Bau");
  });

  it("hält & einmal escaped und heilt &amp;amp;", () => {
    expect(sanitizeFormattedText("Bau & Montage")).toBe("Bau &amp; Montage");
    expect(sanitizeFormattedText("Bau &amp; Montage")).toBe("Bau &amp; Montage");
    expect(sanitizeFormattedText("Bau &amp;amp; Montage")).toBe("Bau &amp; Montage");
    expect(sanitizeFormattedText("<b>Bau &amp; Montage</b>")).toBe("<b>Bau &amp; Montage</b>");
    expect(sanitizeFormattedText("<b>Bau &amp;amp; Montage</b>")).toBe("<b>Bau &amp; Montage</b>");
    expect(sanitizeFormattedText(sanitizeFormattedText("Bau & Montage"))).toBe("Bau &amp; Montage");
    expect(stripFormattedText("Bau &amp; Montage")).toBe("Bau & Montage");
    expect(stripFormattedText("<b>Bau &amp;amp; Montage</b>")).toBe("Bau & Montage");
  });
});
