import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertPublicFunnelImageUrl,
  isPublicFunnelStorageKey,
} from "./publicFunnelStorage";

const proxySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "_core/storageProxy.ts"),
  "utf8",
);

describe("isPublicFunnelStorageKey", () => {
  it("gibt jedes Editor-Bild unter funnels/ dauerhaft frei", () => {
    const funnelId = "32d70247-e148-4dca-a6f8-f357fe604b07";
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/branding/logo-abc.png`)).toBe(true);
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/portraits/image-abc.webp`)).toBe(true);
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/backgrounds/desktop-abc.webp`)).toBe(true);
    expect(isPublicFunnelStorageKey("funnels/platform/branding/logo.webp")).toBe(true);
    expect(isPublicFunnelStorageKey("funnels/owner-id/cards/photo.webp")).toBe(true);
    expect(
      isPublicFunnelStorageKey(
        "funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/logo-26549fed-a774-4544-b6ba-f989eab27996_d639a6fe.png",
      ),
    ).toBe(true);
  });

  it("hält Lebensläufe privat und blockiert Path-Traversal", () => {
    expect(isPublicFunnelStorageKey("applications/test/cv.pdf")).toBe(false);
    expect(isPublicFunnelStorageKey("funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/../applications/cv.pdf")).toBe(false);
    expect(isPublicFunnelStorageKey("../funnels/x/logo.png")).toBe(false);
  });
});

describe("assertPublicFunnelImageUrl", () => {
  it("lässt HTTPS-CDN und öffentliche Storage-Pfade durch", () => {
    expect(() => assertPublicFunnelImageUrl("https://cdn.example.org/funnels/a/logo.webp")).not.toThrow();
    expect(() =>
      assertPublicFunnelImageUrl("/api/storage/funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/logo.png"),
    ).not.toThrow();
  });

  it("lehnt private Storage-Pfade ab", () => {
    expect(() => assertPublicFunnelImageUrl("/api/storage/applications/cv.pdf")).toThrow(/privat|öffentlich/);
  });
});

describe("Speicher-Proxy", () => {
  it("liefert öffentliche Funnel-Bilder direkt aus, ohne Admin-Login und ohne Signed-URL", () => {
    expect(proxySource).toContain("isPublicFunnelStorageKey");
    expect(proxySource).toContain("storageDownload");
    expect(proxySource).toContain("Content-Type");
    expect(proxySource).not.toContain("createSignedUrl");
  });
});
