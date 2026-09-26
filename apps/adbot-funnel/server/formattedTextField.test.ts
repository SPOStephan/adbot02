import { describe, expect, it } from "vitest";
import { plainTextFromClipboard } from "../client/src/components/admin/FormattedTextField";

describe("Einfügen in formatierte Textfelder", () => {
  it("nimmt nur den Rohtext aus der Zwischenablage und verwirft HTML-Format", () => {
    const data = {
      getData: (type: string) => (type === "text/plain" ? "Rohtext\r\nzweite Zeile" : "<b style=\"font-family:Calibri;color:#c00\">fett</b>"),
    } as DataTransfer;
    expect(plainTextFromClipboard(data)).toBe("Rohtext\nzweite Zeile");
    expect(plainTextFromClipboard(data)).not.toContain("font-family");
    expect(plainTextFromClipboard(data)).not.toContain("<b");
    expect(plainTextFromClipboard(null)).toBe("");
  });
});
