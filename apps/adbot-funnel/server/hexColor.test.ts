import { describe, expect, it } from "vitest";
import { formatHexColorDraft, hexToRgb, normalizeHexColor, parseRgbComponent, rgbToHex } from "../client/src/lib/hexColor";

describe("direkte Hex-Farbeingabe", () => {
  it("akzeptiert eingefügte Werte mit und ohne Raute und normalisiert Großschreibung", () => {
    expect(normalizeHexColor("#a1b2c3")).toBe("#A1B2C3");
    expect(normalizeHexColor("0165c3")).toBe("#0165C3");
    expect(normalizeHexColor("  #0165c3  ")).toBe("#0165C3");
    expect(normalizeHexColor("0af", { expandShort: true })).toBe("#00AAFF");
    expect(normalizeHexColor("#0AF", { expandShort: true })).toBe("#00AAFF");
    expect(normalizeHexColor("0af")).toBeNull();
  });

  it("behält unvollständige Eingaben als Entwurf, übernimmt sie aber noch nicht", () => {
    expect(formatHexColorDraft("#01 65")).toBe("#0165");
    expect(normalizeHexColor("#0165")).toBeNull();
    expect(normalizeHexColor("#1234567")).toBe("#123456");
  });

  it("filtert Nicht-Hex-Zeichen und liefert für einen leeren Entwurf keinen Farbwert", () => {
    expect(formatHexColorDraft("#GG12zz34")).toBe("#1234");
    expect(formatHexColorDraft(" ")).toBe("");
    expect(normalizeHexColor("")).toBeNull();
  });

  it("wandelt Hex und RGB in beide Richtungen um", () => {
    expect(hexToRgb("#0165C3")).toEqual({ r: 1, g: 101, b: 195 });
    expect(rgbToHex(1, 101, 195)).toBe("#0165C3");
    expect(parseRgbComponent("255")).toBe(255);
    expect(parseRgbComponent("256")).toBeNull();
    expect(parseRgbComponent("")).toBeNull();
  });
});
