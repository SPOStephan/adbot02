import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import {
  computeApplicationLeadValue,
  parseLeadValue,
  resolveQualityEventName,
  resolveQualityEventValue,
} from "@shared/leadValue";

describe("Lead-Wert aus Funnel-Antworten", () => {
  it("summiert nur ausgewählte Optionen mit hinterlegtem Wert", () => {
    expect(
      computeApplicationLeadValue(defaultFunnel, {
        arbeitsbereich: ["vertrieb"],
        berufserfahrung: ["3-plus"],
      }),
    ).toBe(150);
    expect(
      computeApplicationLeadValue(defaultFunnel, {
        arbeitsbereich: ["office", "technik"],
        berufserfahrung: ["einstieg"],
      }),
    ).toBe(110);
  });

  it("ignoriert Antworten auf ausgeblendeten Seiten", () => {
    const hiddenRole = {
      ...defaultFunnel,
      pages: defaultFunnel.pages.map(page => page.id === "page-role" ? { ...page, hidden: true } : page),
    };
    expect(
      computeApplicationLeadValue(hiddenRole, {
        arbeitsbereich: ["vertrieb"],
        berufserfahrung: ["3-plus"],
      }),
    ).toBe(80);
  });

  it("liefert keinen Wert, wenn keine Option einen Wert hat", () => {
    const withoutValues = structuredClone(defaultFunnel);
    for (const page of withoutValues.pages) {
      if (page.type === "choice-grid" || page.type === "choice-list") {
        page.options = page.options.map(option => {
          const { leadValue: _leadValue, ...rest } = option;
          return rest;
        });
      }
    }
    expect(
      computeApplicationLeadValue(withoutValues, {
        arbeitsbereich: ["vertrieb"],
        berufserfahrung: ["3-plus"],
      }),
    ).toBeUndefined();
  });

  it("lehnt ungültige Beträge ab und rundet auf Cent", () => {
    expect(parseLeadValue("80,5")).toBe(80.5);
    expect(parseLeadValue(-1)).toBeUndefined();
    expect(parseLeadValue(10_001)).toBeUndefined();
    expect(parseLeadValue("abc")).toBeUndefined();
  });

  it("setzt Meta-Ereignisname und Wert für Gut/Schlecht", () => {
    expect(resolveQualityEventName("good")).toBe("Subscribe");
    expect(resolveQualityEventName("bad")).toBe("DisqualifiedLead");
    expect(resolveQualityEventValue("good", 150)).toBe(150);
    expect(resolveQualityEventValue("good", 150, { good: 200 })).toBe(200);
    expect(resolveQualityEventValue("bad", 150)).toBe(0);
    expect(resolveQualityEventValue("bad", 150, { bad: 5 })).toBe(5);
  });
});
