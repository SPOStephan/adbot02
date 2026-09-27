import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { legalFooterLinks, legalPagesAreValid, normalizeFunnelLegal, resolveImprintLink, resolvePrivacyLink } from "@shared/legalPages";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { normalizeFunnelConfig } from "./funnelStore";

describe("Rechtliche Seiten", () => {
  it("fällt ohne Angabe auf Impressum intern und Datenschutz extern zurück", () => {
    const legal = normalizeFunnelLegal({});
    expect(legal.imprintMode).toBe("internal");
    expect(legal.privacyMode).toBe("external");
    expect(legal.imprintTitle).toBe("Impressum");
    expect(legal.privacyTitle).toBe("Datenschutzerklärung");
    expect(resolveImprintLink(legal, "/f/demo/impressum")).toEqual({ href: "/f/demo/impressum", external: false });
    expect(resolvePrivacyLink(legal, "https://example.org/datenschutz", "/f/demo/datenschutz")).toEqual({
      href: "https://example.org/datenschutz",
      external: true,
    });
  });

  it("leitet bei externem Impressum auf die HTTPS-Adresse weiter", () => {
    const legal = normalizeFunnelLegal({
      imprintMode: "external",
      imprintUrl: "https://firma.de/impressum",
    });
    expect(resolveImprintLink(legal, "/f/demo/impressum")).toEqual({
      href: "https://firma.de/impressum",
      external: true,
    });
    const footer = legalFooterLinks(
      { legal, privacyUrl: "https://firma.de/datenschutz", privacyLabel: "Datenschutz" },
      { imprintUrl: "/impressum", privacyUrl: "/datenschutz" },
    );
    expect(footer.imprintExternal).toBe(true);
    expect(footer.privacyExternal).toBe(true);
  });

  it("nutzt die interne Datenschutz-Seite, wenn der Text gepflegt ist", () => {
    const legal = normalizeFunnelLegal({
      privacyMode: "internal",
      privacyTitle: "Datenschutz",
      privacyContent: "Wir verarbeiten Daten nur für die Bewerbung.",
    });
    expect(resolvePrivacyLink(legal, "https://example.org/datenschutz", "/f/demo/datenschutz")).toEqual({
      href: "/f/demo/datenschutz",
      external: false,
    });
    expect(legalPagesAreValid({ legal, privacyUrl: "" }).ok).toBe(true);
  });

  it("lehnt unvollständige eigene Seiten und fehlende HTTPS-Adressen ab", () => {
    expect(legalPagesAreValid({
      legal: normalizeFunnelLegal({ imprintMode: "internal", imprintTitle: "", imprintContent: "" }),
      privacyUrl: "https://example.org/datenschutz",
    }).ok).toBe(false);
    expect(legalPagesAreValid({
      legal: normalizeFunnelLegal({ imprintMode: "external", imprintUrl: "" }),
      privacyUrl: "https://example.org/datenschutz",
    }).ok).toBe(false);
    expect(legalPagesAreValid({
      legal: normalizeFunnelLegal({ privacyMode: "internal", privacyContent: "" }),
      privacyUrl: "",
    }).ok).toBe(false);
  });

  it("akzeptiert beide Modi im Schema und normalisiert Bestände", () => {
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      legal: {
        ...defaultFunnel.legal,
        imprintMode: "external",
        imprintUrl: "https://firma.de/impressum",
      },
    }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      privacyUrl: "",
      legal: {
        ...defaultFunnel.legal,
        privacyMode: "internal",
        privacyContent: "Datenschutztext",
      },
    }).success).toBe(true);
    expect(funnelConfigSchema.safeParse({
      ...defaultFunnel,
      legal: { ...defaultFunnel.legal, imprintMode: "external", imprintUrl: "" },
    }).success).toBe(false);

    const legacy = structuredClone(defaultFunnel);
    Reflect.deleteProperty(legacy.legal, "imprintMode");
    Reflect.deleteProperty(legacy.legal, "imprintUrl");
    Reflect.deleteProperty(legacy.legal, "privacyMode");
    Reflect.deleteProperty(legacy.legal, "privacyTitle");
    Reflect.deleteProperty(legacy.legal, "privacyContent");
    const normalized = normalizeFunnelConfig(legacy, true);
    expect(normalized.legal.imprintMode).toBe("internal");
    expect(normalized.legal.privacyMode).toBe("external");
    expect(normalized.legal.imprintUrl).toBe("");
    expect(normalized.legal.privacyTitle).toBe("Datenschutzerklärung");
  });
});
