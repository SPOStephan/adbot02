import { describe, expect, it } from "vitest";
import { isPublicFunnelStorageKey } from "./publicFunnelStorage";

describe("isPublicFunnelStorageKey", () => {
  it("gibt Logo, Favicon, Portrait und Hintergrund ohne Login frei", () => {
    const funnelId = "32d70247-e148-4dca-a6f8-f357fe604b07";
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/branding/logo-abc.png`)).toBe(true);
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/branding/favicon-abc.png`)).toBe(true);
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/portraits/image-abc.webp`)).toBe(true);
    expect(isPublicFunnelStorageKey(`funnels/${funnelId}/backgrounds/desktop-abc.webp`)).toBe(true);
    expect(
      isPublicFunnelStorageKey(
        "/api/storage/funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/logo-26549fed-a774-4544-b6ba-f989eab27996_d639a6fe.png"
          .replace(/^\/api\/storage\//, ""),
      ),
    ).toBe(true);
  });

  it("hält Lebensläufe und sonstige Keys weiter hinter dem Admin-Login", () => {
    expect(isPublicFunnelStorageKey("applications/test/cv.pdf")).toBe(false);
    expect(isPublicFunnelStorageKey("funnels/not-a-uuid/branding/logo.png")).toBe(false);
    expect(isPublicFunnelStorageKey("funnels/32d70247-e148-4dca-a6f8-f357fe604b07/secret/logo.png")).toBe(false);
    expect(isPublicFunnelStorageKey("funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/../applications/cv.pdf")).toBe(false);
  });
});
