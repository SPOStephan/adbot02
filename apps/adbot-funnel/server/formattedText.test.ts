import { describe, expect, it } from "vitest";
import { isBlankFormattedText, sanitizeFormattedText, stripFormattedText } from "@shared/formattedText";

describe("formatierter Funnel-Text", () => {
  it("lässt Fett, Kursiv, Unterstrich, Klein und Hexfarbe zu", () => {
    const html = sanitizeFormattedText('Hallo <b>fett</b> <i>kursiv</i> <u>unten</u> <small><span style="color: rgb(96, 114, 135)">(m/w/d)</span></small>');
    expect(html).toContain("<b>fett</b>");
    expect(html).toContain("<i>kursiv</i>");
    expect(html).toContain("<u>unten</u>");
    expect(html).toContain("<small>");
    expect(html).toContain("(m/w/d)");
    expect(html).toContain('style="color: #607287"');
    expect(stripFormattedText(html)).toBe("Hallo fett kursiv unten (m/w/d)");
  });

  it("entfernt Scripts und fremde Attribute", () => {
    const html = sanitizeFormattedText('<b onclick="alert(1)">ok</b><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).toBe("<b>ok</b>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
  });

  it("färbt Text aus font-Tags ein, statt ihn zu löschen", () => {
    expect(sanitizeFormattedText('<font color="#0165c3">Du verkaufst Versicherungen</font>'))
      .toBe('<span style="color: #0165C3">Du verkaufst Versicherungen</span>');
    expect(sanitizeFormattedText('<font color="rgb(1, 101, 195)">Text</font>'))
      .toBe('<span style="color: #0165C3">Text</span>');
    expect(sanitizeFormattedText('<font color="#0af">Kurz</font>'))
      .toBe('<span style="color: #00AAFF">Kurz</span>');
    expect(sanitizeFormattedText("<font>Text ohne Farbe</font>")).toBe("Text ohne Farbe");
    expect(stripFormattedText('<font color="#0165c3">Du verkaufst Versicherungen</font>')).toBe("Du verkaufst Versicherungen");
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
