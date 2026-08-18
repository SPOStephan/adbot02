import "server-only";

import sharp from "sharp";

import { inspectCreativeImage } from "@/lib/creative-assets/image";
import type { CreativeImageMimeType } from "@/lib/creative-assets/types";
import {
  META_FORMAT_SLOTS,
  type MetaFormatKey,
  presetsNeedingCrop,
} from "@/lib/media-library/meta-formats";

/** @deprecated Prefer META_FORMAT_SLOTS — kept as alias for existing imports. */
export const META_CROP_PRESETS = META_FORMAT_SLOTS;

export type MetaCropPresetKey = MetaFormatKey;

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
 * Content-aware cover crop into Meta-ready sizes.
 * Skips presets the original already matches (smart crop).
 */
export async function generateMetaCropsFromOriginal(input: {
  bytes: Uint8Array;
  mimeType: CreativeImageMimeType;
  originalWidth: number;
  originalHeight: number;
  /** Override which presets to generate; default = only missing formats. */
  onlyKeys?: readonly MetaFormatKey[];
}): Promise<GeneratedMetaCrop[]> {
  const keys = new Set(
    input.onlyKeys ??
      presetsNeedingCrop(input.originalWidth, input.originalHeight),
  );
  const crops: GeneratedMetaCrop[] = [];

  for (const preset of META_FORMAT_SLOTS) {
    if (!keys.has(preset.key)) {
      continue;
    }
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
        declaredMimeType:
          input.mimeType === "image/png" ? "image/png" : "image/jpeg",
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
