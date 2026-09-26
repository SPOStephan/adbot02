import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelIcon } from "../client/src/components/funnel/FunnelIcon";
import { ADBOT_ICON_STROKE, ADBOT_ICON_VIEWBOX } from "../client/src/components/funnel/adbotIcons";
import { ADBOT_FUNNEL_ICONS, FUNNEL_OPTION_ICON_LABELS, FUNNEL_OPTION_ICONS, isAdbotFunnelIcon } from "@shared/funnel";
import { visiblePickerIcons } from "@shared/funnelIconCatalog";
import { placeholderFunnelIconSvg } from "@shared/funnelIconSvg";

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

  it("zeigt in der Auswahl keine Herkunftsgruppen und kein doppeltes Auto", () => {
    expect(visiblePickerIcons().includes("car")).toBe(false);
    expect(visiblePickerIcons().includes("adbot-company-car")).toBe(true);
  });

  it("zeichnet Adbot-Icons kleiner und mit dünnerem Strich als Lucide", () => {
    const adbot = renderToStaticMarkup(<FunnelIcon name="adbot-company-car" />);
    const lucide = renderToStaticMarkup(<FunnelIcon name="sparkles" />);
    expect(ADBOT_ICON_VIEWBOX).toBe("-2.5 -2.5 29 29");
    expect(ADBOT_ICON_STROKE).toBe(1.55);
    expect(adbot).toContain("funnel-icon-own");
    expect(adbot).toContain(ADBOT_ICON_VIEWBOX);
    expect(adbot).toContain(`stroke-width="${ADBOT_ICON_STROKE}"`);
    expect(lucide).not.toContain("funnel-icon-own");
    expect(placeholderFunnelIconSvg("Test")).toContain('stroke-width="1.55"');
  });
});
