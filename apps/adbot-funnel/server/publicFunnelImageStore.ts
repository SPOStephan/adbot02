import { randomUUID } from "node:crypto";
import { isBunnyConfigured, uploadFunnelBytesToBunny } from "./bunny";
import { assertPublicFunnelImageUrl } from "./publicFunnelStorage";
import { storagePut } from "./storage";

export type PublicFunnelImageFolder = "branding" | "portraits" | "backgrounds";

export async function storePublicFunnelImage(input: {
  funnelId: string;
  ownerUserId: string | null;
  folder: PublicFunnelImageFolder;
  filename: string;
  contentType: string;
  data: Buffer;
}): Promise<{ url: string; path: string }> {
  if (isBunnyConfigured()) {
    const stored = await uploadFunnelBytesToBunny({
      ownerUserId: input.ownerUserId,
      filename: input.filename,
      contentType: input.contentType,
      data: input.data,
      folder: input.folder,
    });
    assertPublicFunnelImageUrl(stored.url);
    return { url: stored.url, path: stored.bunnyPath };
  }

  try {
    const stored = await storagePut(
      `funnels/${input.funnelId}/${input.folder}/${randomUUID()}-${input.filename}`,
      input.data,
      input.contentType,
    );
    assertPublicFunnelImageUrl(stored.url);
    return { url: stored.url, path: stored.key };
  } catch (error) {
    if (!isBunnyConfigured()) {
      const stored = await uploadFunnelBytesToBunny({
        ownerUserId: input.ownerUserId,
        filename: input.filename,
        contentType: input.contentType,
        data: input.data,
        folder: input.folder,
      });
      assertPublicFunnelImageUrl(stored.url);
      return { url: stored.url, path: stored.bunnyPath };
    }
    throw error;
  }
}
