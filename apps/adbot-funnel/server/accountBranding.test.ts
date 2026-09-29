import { describe, expect, it } from "vitest";
import {
  companyNameFromEmail,
  companyNameFromLogoAlt,
  dashboardTitle,
  deriveCompanyName,
} from "@shared/accountBranding";

describe("Konto-Branding im Dashboard", () => {
  it("leitet den Firmennamen aus der Konto-Domain ab", () => {
    expect(companyNameFromEmail("adbot@boncred.info")).toBe("Boncred");
    expect(companyNameFromEmail("Info@Klickwerk.de")).toBe("Klickwerk");
    expect(companyNameFromEmail("team@mail.firma.co.uk")).toBe("Firma");
  });

  it("ignoriert Freemail-Domains und ungültige Adressen", () => {
    expect(companyNameFromEmail("max@gmail.com")).toBeNull();
    expect(companyNameFromEmail("max@web.de")).toBeNull();
    expect(companyNameFromEmail("")).toBeNull();
    expect(companyNameFromEmail(null)).toBeNull();
  });

  it("nutzt den Logo-Alternativtext als Fallback, außer Platzhalter", () => {
    expect(companyNameFromLogoAlt("Boncred Logo")).toBe("Boncred");
    expect(companyNameFromLogoAlt("Logo der Boncred GmbH")).toBe("Boncred GmbH");
    expect(companyNameFromLogoAlt("Unternehmenslogo")).toBeNull();
    expect(deriveCompanyName({ email: "max@gmail.com", logoAlt: "Boncred" })).toBe("Boncred");
    expect(deriveCompanyName({ email: "max@gmail.com", logoAlt: "Unternehmenslogo" })).toBeNull();
  });

  it("baut den Titel mit Fallback Adbot Funnel", () => {
    expect(dashboardTitle("Boncred")).toBe("Boncred Funnel");
    expect(dashboardTitle(null)).toBe("Adbot Funnel");
    expect(dashboardTitle("  ")).toBe("Adbot Funnel");
  });
});

describe("Hinterlegte Firmenangaben", () => {
  it("bevorzugt den angezeigten Namen, dann den vollständigen Firmennamen", () => {
    expect(deriveCompanyName({ displayName: "Boncred", companyName: "Boncred Finanzvermittlungs GmbH", email: "x@andere.de" })).toBe("Boncred");
    expect(deriveCompanyName({ displayName: "  ", companyName: "Boncred Finanzvermittlungs GmbH", email: "x@andere.de" })).toBe("Boncred Finanzvermittlungs GmbH");
    expect(deriveCompanyName({ displayName: "", companyName: "", email: "adbot@boncred.info" })).toBe("Boncred");
  });
});
