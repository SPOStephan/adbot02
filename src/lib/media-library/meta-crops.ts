import "server-only";

import sharp from "sharp";

import { inspectCreativeImage } from "@/lib/creative-assets/image";
import type { CreativeImageMimeType } from "@/lib/creative-assets/types";

/** Common Meta placements for feed / link ads (cover-crop targets). */
export const META_CROP_PRESETS = [
  {
    key: "meta_feed_1x1",
    label: "Feed 1:1",
    width: 1080,
    height: 1080,
    preferredForLaunch: true,
  },
  {
    key: "meta_feed_4x5",
    label: "Feed 4:5",
    width: 1080,
    height: 1350,
    preferredForLaunch: false,
  },
  {
    key: "meta_link_191x1",
    label: "Link 1,91:1",
    width: 1200,
    height: 628,
    preferredForLaunch: false,
  },
] as const;

export type MetaCropPresetKey = (typeof META_CROP_PRESETS)[number]["key"];

export type GeneratedMetaCrop = {
  key: MetaCropPresetKey;
  label: string;
  width: number;
  height: number;
  preferredForLaunch: boolean;
  bytes: Uint8Array;
  sha256: string;
  mimeType: CreativeImageMimeType;
  byteSize: number;
};

/**
 * Content-aware cover crop (sharp attention/entropy) into Meta-ready sizes.
 * Does not mutate the original bytes — caller must store the original separately.
 */
export async function generateMetaCropsFromOriginal(input: {
  bytes: Uint8Array;
  mimeType: CreativeImageMimeType;
}): Promise<GeneratedMetaCrop[]> {
  const crops: GeneratedMetaCrop[] = [];

  for (const preset of META_CROP_PRESETS) {
    try {
      let out: Buffer;
      try {
        const pipeline = sharp(Buffer.from(input.bytes), { failOn: "none" })
          .rotate()
          .resize(preset.width, preset.height, {
            fit: "cover",
            position: "attention",
          });
        out =
          input.mimeType === "image/png"
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
            : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      } catch {
        const pipeline = sharp(Buffer.from(input.bytes), { failOn: "none" })
          .rotate()
          .resize(preset.width, preset.height, {
            fit: "cover",
            position: "centre",
          });
        out =
          input.mimeType === "image/png"
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
            : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      }

      const bytes = new Uint8Array(out);
      const inspected = inspectCreativeImage({
        bytes,
        declaredMimeType: input.mimeType === "image/png" ? "image/png" : "image/jpeg",
      });

      crops.push({
        key: preset.key,
        label: preset.label,
        width: inspected.width,
        height: inspected.height,
        preferredForLaunch: preset.preferredForLaunch,
        bytes: inspected.bytes,
        sha256: inspected.sha256,
        mimeType: inspected.mimeType,
        byteSize: inspected.byteSize,
      });
    } catch {
      // Skip individual crop failures; original upload must still succeed.
    }
  }

  return crops;
}
