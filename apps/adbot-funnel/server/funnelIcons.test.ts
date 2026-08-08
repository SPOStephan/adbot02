import { describe, expect, it } from "vitest";
import { FUNNEL_OPTION_ICON_LABELS, FUNNEL_OPTION_ICONS } from "@shared/funnel";

describe("visueller Funnel-Icon-Katalog", () => {
  it("enthält mindestens 40 eindeutige, vollständig beschriftete Symbole", () => {
    expect(FUNNEL_OPTION_ICONS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FUNNEL_OPTION_ICONS).size).toBe(FUNNEL_OPTION_ICONS.length);
    expect(FUNNEL_OPTION_ICONS.every(icon => FUNNEL_OPTION_ICON_LABELS[icon].trim().length > 0)).toBe(true);
  });
});
