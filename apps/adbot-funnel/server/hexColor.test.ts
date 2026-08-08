import { describe, expect, it } from "vitest";
import { formatHexColorDraft, normalizeHexColor } from "../client/src/lib/hexColor";

describe("direkte Hex-Farbeingabe", () => {
  it("akzeptiert eingefügte Werte mit und ohne Raute und normalisiert Großschreibung", () => {
    expect(normalizeHexColor("#a1b2c3")).toBe("#A1B2C3");
    expect(normalizeHexColor("0165c3")).toBe("#0165C3");
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
});
