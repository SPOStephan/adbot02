import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filterPickerIcons, isSelectableFunnelIcon, visiblePickerIcons } from "@shared/funnelIconCatalog";
import { placeholderFunnelIconSvg, sanitizeFunnelIconSvg } from "@shared/funnelIconSvg";
import { requestFunnelLibraryIcon, resetFunnelIconStoreForTests } from "./funnelIconStore";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vereinheitlichter Icon-Katalog", () => {
  it("blendet das doppelte Lucide-Auto aus und findet Firmenwagen über Auto", () => {
    expect(visiblePickerIcons()).not.toContain("car");
    expect(visiblePickerIcons()).toContain("adbot-company-car");
    expect(filterPickerIcons("Auto")).toEqual(["adbot-company-car"]);
  });

  it("nimmt beauftragte Icons in die Bibliothek auf", async () => {
    resetFunnelIconStoreForTests();
    const created = await requestFunnelLibraryIcon({
      label: "Fahrrad",
      requestNote: "Fahrrad von der Seite",
    });
    expect(isSelectableFunnelIcon(created.id)).toBe(true);
    expect(created.status).toBe("requested");
    expect(created.svg).toContain("<svg");
    expect(sanitizeFunnelIconSvg(placeholderFunnelIconSvg("Fahrrad"))).toContain("svg");
  });

  it("lehnt gefährliche SVGs ab", () => {
    expect(sanitizeFunnelIconSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
  });

  it("sucht in einer Liste ohne Herkunftsreiter", () => {
    const picker = readFileSync(join(root, "client/src/components/admin/IconPicker.tsx"), "utf8");
    expect(picker).not.toContain('["lucide", "Lucide"]');
    expect(picker).toContain("Icon fehlt? Neu beauftragen");
    const css = readFileSync(join(root, "client/src/index.css"), "utf8");
    expect(css).toMatch(/\.funnel-start-benefits-tiles li \{[\s\S]*align-items: start;/);
  });
});
