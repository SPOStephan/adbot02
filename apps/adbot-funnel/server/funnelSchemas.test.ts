import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { applicationSubmissionSchema, funnelConfigSchema } from "@shared/funnelSchemas";

describe("Funnel-Validierung", () => {
  it("akzeptiert die vollständige Standardkonfiguration", () => {
    expect(funnelConfigSchema.safeParse(defaultFunnel).success).toBe(true);
  });

  it("erzwingt die verbindliche Akzentfarbe und die feste Seitenstruktur", () => {
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, brand: { ...defaultFunnel.brand, accentColor: "#ff0000" } }).success).toBe(false);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, pages: defaultFunnel.pages.slice(1) }).success).toBe(false);
  });

  it("validiert Favicon-URLs und alle Antwortkasten-Farben", () => {
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, brand: { ...defaultFunnel.brand, faviconUrl: "/api/storage/favicon.png", choiceSelectedBackgroundColor: "#112233" } }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, brand: { ...defaultFunnel.brand, faviconUrl: "javascript:alert(1)" } }).success).toBe(false);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, brand: { ...defaultFunnel.brand, choiceBackgroundColor: "red" } }).success).toBe(false);
  });

  it("erlaubt eine leere Überzeile auf jeder Seite", () => {
    const pages = defaultFunnel.pages.map(page => ({ ...page, eyebrow: "" }));
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, pages }).success).toBe(true);
  });

  it("akzeptiert neue Katalog-Icons und weist unbekannte Werte zurück", () => {
    const pagesWithWrench = defaultFunnel.pages.map(page => page.type === "choice-grid" ? { ...page, options: page.options.map((option, index) => index === 0 ? { ...option, icon: "wrench" as const } : option) } : page);
    const pagesWithUnknownIcon = defaultFunnel.pages.map(page => page.type === "choice-grid" ? { ...page, options: page.options.map((option, index) => index === 0 ? { ...option, icon: "sondericon" } : option) } : page);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, pages: pagesWithWrench }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, pages: pagesWithUnknownIcon }).success).toBe(false);
  });

  it("validiert Impressum, HTTPS-Weiterleitung und öffentliche Meta-Einstellungen", () => {
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      legal: { imprintTitle: "Impressum", imprintContent: "BonCred GmbH\nMusterstraße 1" },
      postSubmit: { mode: "redirect", redirectUrl: "https://www.example.org/danke" },
      metaTracking: { ...defaultFunnel.metaTracking, enabled: true, pixelId: "123456789012345" },
    }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, legal: { ...defaultFunnel.legal, imprintTitle: "   " } }).success).toBe(false);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, legal: { ...defaultFunnel.legal, imprintContent: "\n  \t" } }).success).toBe(false);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, postSubmit: { mode: "redirect", redirectUrl: "http://example.org" } }).success).toBe(false);
    expect(funnelConfigSchema.safeParse({ ...defaultFunnel, metaTracking: { ...defaultFunnel.metaTracking, enabled: true, pixelId: "" } }).success).toBe(false);
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      metaTracking: { ...defaultFunnel.metaTracking, enabled: true, pixelId: "123456789012345", conversionTrigger: "doi" },
    }).success).toBe(true);
    expect(funnelConfigSchema.parse({
      ...defaultFunnel,
      metaTracking: { enabled: false, pixelId: "", eventName: "Lead" },
    }).metaTracking.conversionTrigger).toBe("submit");
  });

  it("akzeptiert Meta-Kennungen ohne separates Checkbox-Feld und ignoriert den Legacy-Wert", () => {
    const base = { funnelSlug: "karriere", answers: {}, contact: { email: "erika@example.org" }, consent: true };
    const parsed = applicationSubmissionSchema.parse({ ...base, trackingConsent: false, metaEventId: "10000000-0000-4000-8000-000000000099", metaFbp: "fb.1.123.456" });
    expect(parsed.metaEventId).toBe("10000000-0000-4000-8000-000000000099");
    expect(parsed.metaFbp).toBe("fb.1.123.456");
    expect("trackingConsent" in parsed).toBe(false);
    expect(applicationSubmissionSchema.safeParse({ ...base, metaEventId: "keine-uuid" }).success).toBe(false);
  });

  it("akzeptiert PDF-, DOC- und DOCX-Lebensläufe bis 8 MB", () => {
    const base = { funnelSlug: "karriere", answers: {}, contact: { name: "Erika Muster", email: "erika@example.org" }, consent: true };
    for (const mimeType of ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const) {
      const result = applicationSubmissionSchema.safeParse({ ...base, resume: { fileName: "lebenslauf.pdf", mimeType, size: 8 * 1024 * 1024, dataBase64: "ZGF0YQ==" } });
      expect(result.success).toBe(true);
    }
  });

  it("weist unerlaubte Formate, übergroße Dateien und ungültige E-Mail-Adressen zurück", () => {
    const base = { funnelSlug: "karriere", answers: {}, contact: { email: "keine-mail" }, consent: true };
    expect(applicationSubmissionSchema.safeParse({ ...base, resume: { fileName: "virus.exe", mimeType: "application/octet-stream", size: 20, dataBase64: "ZGF0YQ==" } }).success).toBe(false);
    expect(applicationSubmissionSchema.safeParse({ ...base, contact: { email: "erika@example.org" }, resume: { fileName: "gross.pdf", mimeType: "application/pdf", size: 8 * 1024 * 1024 + 1, dataBase64: "ZGF0YQ==" } }).success).toBe(false);
    expect(applicationSubmissionSchema.safeParse(base).success).toBe(false);
  });
});
