import { describe, expect, it } from "vitest";
import { buildFrameAncestorsPolicy } from "./securityHeaders";

describe("Frame-Sicherheitsregeln", () => {
  it("erlaubt ausschließlich normalisierte HTTP(S)-Origins und entfernt Duplikate", () => {
    expect(buildFrameAncestorsPolicy([
      "https://www.unternehmen.de/karriere",
      "https://www.unternehmen.de",
      "http://localhost:8080/test",
      "javascript:alert(1)",
      "kein-url wert",
    ])).toBe("frame-ancestors 'self' https://www.unternehmen.de http://localhost:8080");
  });

  it("beschränkt Einbettung ohne Freigaben auf dieselbe Origin", () => {
    expect(buildFrameAncestorsPolicy([])).toBe("frame-ancestors 'self'");
  });
});
