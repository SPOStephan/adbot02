import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { deleteFunnelPage, duplicateFunnelPage, moveFunnelPage } from "@shared/funnelEditor";

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
});
