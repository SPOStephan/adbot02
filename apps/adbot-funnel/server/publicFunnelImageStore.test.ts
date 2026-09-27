import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./bunny", () => ({
  isBunnyConfigured: vi.fn(() => false),
  uploadFunnelBytesToBunny: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn(),
}));

import { storePublicFunnelImage } from "./publicFunnelImageStore";
import { isBunnyConfigured, uploadFunnelBytesToBunny } from "./bunny";
import { storagePut } from "./storage";

afterEach(() => {
  vi.clearAllMocks();
});

describe("storePublicFunnelImage", () => {
  it("schreibt ohne Bunny unter funnels/ und prüft den öffentlichen Pfad", async () => {
    vi.mocked(storagePut).mockResolvedValue({
      key: "funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/abc-logo.png",
      url: "/api/storage/funnels/32d70247-e148-4dca-a6f8-f357fe604b07/branding/abc-logo.png",
    });

    const stored = await storePublicFunnelImage({
      funnelId: "32d70247-e148-4dca-a6f8-f357fe604b07",
      ownerUserId: null,
      folder: "branding",
      filename: "logo.png",
      contentType: "image/png",
      data: Buffer.from("x"),
    });

    expect(stored.url).toContain("/api/storage/funnels/");
    expect(vi.mocked(storagePut).mock.calls[0]?.[0]).toMatch(/^funnels\/32d70247-e148-4dca-a6f8-f357fe604b07\/branding\//);
  });

  it("nimmt Bunny-HTTPS, wenn der CDN-Weg konfiguriert ist", async () => {
    vi.mocked(isBunnyConfigured).mockReturnValue(true);
    vi.mocked(uploadFunnelBytesToBunny).mockResolvedValue({
      bunnyPath: "funnels/owner/branding/logo.webp",
      url: "https://cdn.example.org/funnels/owner/branding/logo.webp",
      byteSize: 1,
      storedOn: "bunny",
    });

    const stored = await storePublicFunnelImage({
      funnelId: "32d70247-e148-4dca-a6f8-f357fe604b07",
      ownerUserId: "owner",
      folder: "branding",
      filename: "logo.png",
      contentType: "image/png",
      data: Buffer.from("x"),
    });

    expect(stored.url).toBe("https://cdn.example.org/funnels/owner/branding/logo.webp");
    expect(storagePut).not.toHaveBeenCalled();
  });
});
