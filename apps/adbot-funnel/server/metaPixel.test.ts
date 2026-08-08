import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMetaPixel, readMetaBrowserIdentifiers, resetMetaPixelRuntimeForTests, trackMetaConversion } from "../client/src/lib/metaPixel";

describe("Automatische Meta-Pixel-Runtime", () => {
  const elements = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    resetMetaPixelRuntimeForTests();
    elements.clear();
    vi.stubGlobal("window", { location: { href: "https://example.org/f/karriere" } });
    vi.stubGlobal("document", {
      cookie: "_fbp=fb.1.123.456; _fbc=fb.1.123.click",
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: () => ({}),
      head: { appendChild: (element: Record<string, unknown>) => { elements.set(String(element.id), element); return element; } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetMetaPixelRuntimeForTests();
  });

  it("lädt Skript und PageView nur einmal und nutzt dieselbe Event-ID für die Conversion", () => {
    expect(loadMetaPixel("123456789012345")).toBe(true);
    expect(loadMetaPixel("123456789012345")).toBe(true);
    expect(elements.get("meta-pixel-script")?.src).toBe("https://connect.facebook.net/en_US/fbevents.js");
    expect(trackMetaConversion("123456789012345", "Lead", "10000000-0000-4000-8000-000000000099")).toBe(true);
    const queue = (window.fbq?.queue ?? []) as unknown[][];
    expect(queue.filter(call => call[0] === "init")).toHaveLength(1);
    expect(queue.filter(call => call[0] === "track" && call[1] === "PageView")).toHaveLength(1);
    expect(queue.at(-1)).toEqual(["track", "Lead", expect.any(Object), { eventID: "10000000-0000-4000-8000-000000000099" }]);
    expect(readMetaBrowserIdentifiers()).toEqual({ metaFbp: "fb.1.123.456", metaFbc: "fb.1.123.click" });
  });

  it("lädt bei ungültiger Pixel-ID kein externes Skript", () => {
    expect(loadMetaPixel("kein-pixel")).toBe(false);
    expect(elements.size).toBe(0);
  });
});
