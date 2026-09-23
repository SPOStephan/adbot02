import { describe, expect, it } from "vitest";
import { ADBOT_FUNNEL_ICONS, FUNNEL_OPTION_ICON_LABELS, FUNNEL_OPTION_ICONS, isAdbotFunnelIcon } from "@shared/funnel";

describe("visueller Funnel-Icon-Katalog", () => {
  it("enthält mindestens 40 eindeutige, vollständig beschriftete Symbole", () => {
    expect(FUNNEL_OPTION_ICONS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FUNNEL_OPTION_ICONS).size).toBe(FUNNEL_OPTION_ICONS.length);
    expect(FUNNEL_OPTION_ICONS.every(icon => FUNNEL_OPTION_ICON_LABELS[icon].trim().length > 0)).toBe(true);
  });

  it("hält die eigene Adbot-Bibliothek mit eindeutigen Namen vor", () => {
    expect(ADBOT_FUNNEL_ICONS.length).toBeGreaterThanOrEqual(12);
    expect(ADBOT_FUNNEL_ICONS.every(icon => icon.startsWith("adbot-") && isAdbotFunnelIcon(icon))).toBe(true);
    expect(isAdbotFunnelIcon("calendar")).toBe(false);
  });
});
