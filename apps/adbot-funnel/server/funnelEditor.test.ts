import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { isFunnelPageHidden, visibleFunnelPages } from "@shared/funnel";
import { applyFunnelPagePatch, deleteFunnelPage, duplicateFunnelPage, moveFunnelPage, patchFunnelPage, toggleFunnelPageHidden } from "@shared/funnelEditor";
import { patchStartBadge } from "@shared/startLayout";

const editorSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/admin/FunnelEditor.tsx"), "utf8");

describe("Funnel-Seiteneditor", () => {
  it("dupliziert eine Auswahlseite mit eigenen IDs direkt hinter dem Original", () => {
    let counter = 0;
    const result = duplicateFunnelPage(defaultFunnel, "page-role", () => `copy-${counter++}-00000000`);
    const duplicate = result.pages[2];

    expect(result.pages).toHaveLength(defaultFunnel.pages.length + 1);
    expect(duplicate.type).toBe("choice-grid");
    expect(duplicate.name).toBe("Arbeitsbereich – Kopie");
    expect(duplicate.id).not.toBe(defaultFunnel.pages[1]?.id);
    if (duplicate.type !== "choice-grid") throw new Error("Falscher Seitentyp");
    expect(duplicate.questionKey).toContain(duplicate.id.slice(0, 8));
    expect(new Set(duplicate.options.map(option => option.id)).size).toBe(duplicate.options.length);
    expect(defaultFunnel.pages).toHaveLength(4);
  });

  it("sortiert nur die editierbaren Mittelseiten und hält Start/Kontakt fest", () => {
    const moved = moveFunnelPage(defaultFunnel, "page-experience", -1);
    expect(moved.pages.map(page => page.id)).toEqual(["page-start", "page-experience", "page-role", "page-contact"]);
    expect(moveFunnelPage(defaultFunnel, "page-start", 1)).toBe(defaultFunnel);
    expect(moveFunnelPage(defaultFunnel, "page-contact", -1)).toBe(defaultFunnel);
  });

  it("löscht Auswahlseiten, aber nie die strukturell nötige Start- oder Kontaktseite", () => {
    expect(deleteFunnelPage(defaultFunnel, "page-role").pages.map(page => page.id)).toEqual(["page-start", "page-experience", "page-contact"]);
    expect(deleteFunnelPage(defaultFunnel, "page-start")).toBe(defaultFunnel);
    expect(deleteFunnelPage(defaultFunnel, "page-contact")).toBe(defaultFunnel);
  });

  it("blendet Auswahlseiten aus und holt sie per erneutem Klick zurück", () => {
    const hidden = toggleFunnelPageHidden(defaultFunnel, "page-role");
    expect(hidden.pages.map(page => page.id)).toEqual(defaultFunnel.pages.map(page => page.id));
    expect(isFunnelPageHidden(hidden.pages[1]!)).toBe(true);
    expect(visibleFunnelPages(hidden.pages).map(page => page.id)).toEqual(["page-start", "page-experience", "page-contact"]);
    expect(toggleFunnelPageHidden(hidden, "page-role").pages[1]?.hidden).toBe(false);
    expect(toggleFunnelPageHidden(defaultFunnel, "page-start")).toBe(defaultFunnel);
    expect(toggleFunnelPageHidden(defaultFunnel, "page-contact")).toBe(defaultFunnel);
  });

  it("bietet das Hinzufügen einer Option oben und unter der Liste an", () => {
    expect(editorSource.match(/Weitere Option hinzufügen/g)?.length).toBe(2);
    expect(editorSource).toContain("page.options.length > 0");
  });

  it("trennt Überzeile über der Überschrift von der Sub-Headline darunter", () => {
    expect(editorSource).toContain('label="Überzeile"');
    expect(editorSource).toContain('label="Sub-Headline"');
    expect(editorSource).not.toContain("Überzeile / Sub-Headline");
    expect(editorSource).toContain("über der Überschrift");
    expect(editorSource).toContain("unter der Überschrift");
    expect(editorSource).toContain("(m/w/d)");
    const fieldSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/FormattedTextField.tsx"), "utf8");
    expect(fieldSource).toContain("wrapSelectionInSmall");
    expect(fieldSource).toContain("wrapSelectionInColor");
    expect(fieldSource).toContain("Kleiner");
    expect(fieldSource).not.toContain('runCommand("foreColor"');
    expect(fieldSource).toContain("onPaste");
    expect(fieldSource).toContain("plainTextFromClipboard");
    expect(fieldSource).toContain("insertPlainTextAtSelection");
    expect(fieldSource).toContain('getData("text/plain")');
    expect(fieldSource).toContain("ColorValueEditor");
    expect(fieldSource).toContain("Schriftfarbe");
    expect(fieldSource).toContain("Popover");
    expect(fieldSource).toContain("onFocusOutside");
    const applyColorAt = fieldSource.indexOf("const applyColor");
    expect(applyColorAt).toBeGreaterThan(-1);
    expect(fieldSource.slice(applyColorAt, fieldSource.indexOf("return (", applyColorAt))).not.toContain("focus(");
    expect(editorSource).toContain("CopySizeStepper");
    expect(editorSource).toContain("eyebrowSizeStep");
    expect(editorSource).toContain("titleSizeStep");
    expect(editorSource).toContain("subtitleSizeStep");
    expect(editorSource).toContain("descriptionSizeStep");
    expect(editorSource).toContain("Größe über die Pfeile");
    const stepperSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/CopySizeStepper.tsx"), "utf8");
    expect(stepperSource).toContain("kleiner");
    expect(stepperSource).toContain("größer");
    expect(stepperSource).toContain("Standard");
  });

  it("lässt den Abstand unter der Fortschrittsleiste in Pixeln einstellen", () => {
    expect(editorSource).toContain("Abstand zum Inhalt");
    expect(editorSource).toContain("contentGapPx");
    expect(editorSource).toContain("clampProgressContentGapPx");
  });

  it("nimmt Hexwerte in Farbfeldern mit und ohne Raute an", () => {
    const hexSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/HexColorTextInput.tsx"), "utf8");
    const editorSourceColor = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/ColorValueEditor.tsx"), "utf8");
    const brandSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/BrandColorField.tsx"), "utf8");
    const iconColorSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/IconColorField.tsx"), "utf8");
    expect(hexSource).toContain("expandShort");
    expect(hexSource).toContain("onPaste");
    expect(hexSource).toContain("stopPropagation");
    expect(hexSource).toContain("#0165C3 oder 0165C3");
    expect(editorSourceColor).toContain("Hexwert");
    expect(editorSourceColor).toContain("HexColorTextInput");
    expect(brandSource).toContain("ColorValueEditor");
    expect(iconColorSource).toContain("ColorValueEditor");
  });

  it("lässt eingefügte Badges per Drag sortieren und per Doppelklick bearbeiten", () => {
    const badgesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/StartBadgesField.tsx"), "utf8");
    expect(badgesSource).toContain("moveStartBadge");
    expect(badgesSource).toContain("onDragStart");
    expect(badgesSource).toContain("onDoubleClick");
    expect(badgesSource).toContain("Badge-Text");
    expect(badgesSource).toContain("Hintergrund");
    expect(badgesSource).toContain("Textfarbe");
    expect(badgesSource).toContain("Automatisch");
    expect(badgesSource).toContain("fallbackTextColor");
    expect(badgesSource).toContain("IconPicker");
    expect(badgesSource).toContain("allowEmpty");
    expect(badgesSource).toContain("Icon nach rechts");
    expect(badgesSource).toContain("StartBadgeContent");
    const pickerSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/IconPicker.tsx"), "utf8");
    expect(pickerSource).toContain("Kein Icon");
  });

  it("bietet für Impressum und Datenschutz eigene Seite oder externe URL", () => {
    expect(editorSource).toContain("LegalPagesFields");
    expect(editorSource).toContain("Impressum und Datenschutz");
    const legalSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/LegalPagesFields.tsx"), "utf8");
    expect(legalSource).toContain("Eigene Seite in Adbot");
    expect(legalSource).toContain("Externe URL");
    expect(legalSource).toContain("privacyMode");
    expect(legalSource).toContain("imprintMode");
    const settingsSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/admin/Settings.tsx"), "utf8");
    expect(settingsSource).toContain("LegalPagesFields");
    expect(settingsSource).toContain("Bestehende Domain anbinden");
    expect(settingsSource).toContain("Für alle Funnel anbinden");
    expect(settingsSource).toContain("registerAccountDomain");
    expect(settingsSource).toContain("Account-Domain");
    expect(editorSource).toContain("preferredPublicFunnelUrl");
    expect(editorSource).toContain("href={publicUrl}");
    const librarySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/admin/FunnelLibrary.tsx"), "utf8");
    expect(librarySource).toContain("preferredPublicFunnelUrl");
    expect(librarySource).toContain("window.open(publicUrl");
    expect(librarySource).not.toContain("window.open(`/f/${funnel.slug}`");
    expect(settingsSource).toContain("DomainActionNotice");
    expect(settingsSource).toContain("ChromeHostReuseNotice");
    expect(settingsSource).toContain("noch nie als Website");
    expect(settingsSource).toContain("unsichere Seite");
    expect(settingsSource).toContain("DNS/SSL erneut prüfen");
    expect(settingsSource).not.toContain("https://Hostname/");
    expect(settingsSource).not.toContain("Domain registrieren");
    expect(settingsSource).not.toContain("ein bis zwei Minuten warten und neu laden");
    const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/App.tsx"), "utf8");
    expect(appSource).toContain("/f/:slug/datenschutz");
    expect(appSource).toContain("/datenschutz");
    const accountIndex = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/AccountFunnelIndex.tsx"), "utf8");
    expect(accountIndex).toContain("AccountHostLegal");
    expect(accountIndex).toContain("/impressum");
    const rootImprint = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/RootImprint.tsx"), "utf8");
    expect(rootImprint).toContain("publicCatalogByHost");
    expect(rootImprint).toContain("AccountHostLegal");
    const rootPrivacy = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/RootPrivacy.tsx"), "utf8");
    expect(rootPrivacy).toContain("publicCatalogByHost");
    expect(rootPrivacy).toContain("AccountHostLegal");
  });

  it("speichert Badge- und Start-Hintergrundfarbe beim ersten Persist, auch wenn ein Save noch läuft", () => {
    expect(editorSource).toContain("createEditorSaveController");
    expect(editorSource).toContain("bumpRevision");
    expect(editorSource).toContain("finishPersist");
    expect(editorSource).toContain("persistNow");
    expect(editorSource).toContain("configRef.current = next");
    expect(editorSource).toContain("patchFunnelPage");
    expect(editorSource).not.toContain("persist(config, false)");
    expect(editorSource).not.toContain("if (!next || save.isPending) return");
    const badgesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/StartBadgesField.tsx"), "utf8");
    expect(badgesSource).toContain("patchStartBadge");
    expect(badgesSource).toContain("onChange(current =>");
    const colorSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/components/admin/ColorValueEditor.tsx"), "utf8");
    expect(colorSource).toContain("rgbDraftRef");
    expect(colorSource).toContain("nextRgbDraft");
    const start = defaultFunnel.pages[0];
    if (start?.type !== "start") throw new Error("Startseite fehlt");
    const seeded = applyFunnelPagePatch(start, {
      heroSectionBackground: "",
      badges: [{ id: "badge-1", label: "Homeoffice", icon: "", iconPosition: "left" as const }],
    });
    const withHero = applyFunnelPagePatch(seeded, { heroSectionBackground: "#FFF4E5" });
    const withBadgeColor = applyFunnelPagePatch(withHero, current => ({
      badges: patchStartBadge(
        current.type === "start" ? current.badges ?? [] : [],
        "badge-1",
        { backgroundColor: "#0165C3" },
      ),
    }));
    const withBothColors = applyFunnelPagePatch(withBadgeColor, current => ({
      badges: patchStartBadge(
        current.type === "start" ? current.badges ?? [] : [],
        "badge-1",
        { textColor: "#FFFFFF" },
      ),
    }));
    if (withBothColors.type !== "start") throw new Error("Startseite fehlt");
    expect(withBothColors.heroSectionBackground).toBe("#FFF4E5");
    expect(withBothColors.badges[0]).toMatchObject({ backgroundColor: "#0165C3", textColor: "#FFFFFF" });
    const saved = patchFunnelPage(defaultFunnel, start.id, { heroSectionBackground: "#FFF4E5" });
    const savedStart = saved.pages[0];
    if (savedStart?.type !== "start") throw new Error("Startseite fehlt");
    expect(savedStart.heroSectionBackground).toBe("#FFF4E5");
  });
});
