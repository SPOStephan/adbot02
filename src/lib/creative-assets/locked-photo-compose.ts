import "server-only";

import sharp from "sharp";

import {
  inspectCreativeImage,
  MAX_CREATIVE_IMAGE_DIMENSION,
  MIN_CREATIVE_IMAGE_DIMENSION,
} from "./image";
import {
  LOCKED_PHOTO_COMPOSE_VERSION,
  PHASE3_MAX_LOCKED_PHOTOS,
} from "./locked-photo-constants";
import type { LockedPhotoAsset } from "./locked-photo-load";
import { CreativeAssetProviderError } from "./types";

export {
  LOCKED_PHOTO_COMPOSE_VERSION,
  PHASE3_MAX_LOCKED_PHOTOS,
} from "./locked-photo-constants";

export type LockedPhotoPlacement = {
  asset_id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  sha256: string;
  pixel_guard: "passed";
};

export type LockedPhotoComposeResult = {
  bytes: Uint8Array;
  mimeType: "image/png";
  width: number;
  height: number;
  sha256: string;
  placements: LockedPhotoPlacement[];
  composeVersion: typeof LOCKED_PHOTO_COMPOSE_VERSION;
};

export type CanvasLayout = {
  width: number;
  height: number;
  placements: Array<{
    assetId: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
};

function parseAspectHint(
  hint: string | undefined,
): { aw: number; ah: number } | null {
  if (!hint || typeof hint !== "string") {
    return null;
  }
  const match = /^(\d{1,4})\s*:\s*(\d{1,4})$/.exec(hint.trim());
  if (!match) {
    return null;
  }
  const aw = Number(match[1]);
  const ah = Number(match[2]);
  if (!Number.isInteger(aw) || !Number.isInteger(ah) || aw < 1 || ah < 1) {
    return null;
  }
  return { aw, ah };
}

/**
 * Minimal canvas that fits locked photo(s) at 1:1 and matches aspect hint.
 * Locked photos are never scaled.
 */
export function planLockedPhotoCanvas(input: {
  locked: ReadonlyArray<Pick<LockedPhotoAsset, "assetId" | "width" | "height">>;
  aspectHint?: string;
}): CanvasLayout {
  if (input.locked.length < 1) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_required",
      message: "Compose benötigt mindestens ein Locked Photo.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }
  if (input.locked.length > PHASE3_MAX_LOCKED_PHOTOS) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_limit",
      message: `Phase 3 unterstützt höchstens ${PHASE3_MAX_LOCKED_PHOTOS} Locked Photo pro Job.`,
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  const photo = input.locked[0];
  if (
    photo.width < MIN_CREATIVE_IMAGE_DIMENSION ||
    photo.height < MIN_CREATIVE_IMAGE_DIMENSION ||
    photo.width > MAX_CREATIVE_IMAGE_DIMENSION ||
    photo.height > MAX_CREATIVE_IMAGE_DIMENSION
  ) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_dimensions",
      message: "Locked-Photo-Dimensionen liegen außerhalb 256–4096.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  const aspect = parseAspectHint(input.aspectHint);
  let width = photo.width;
  let height = photo.height;

  if (aspect) {
    width = photo.width;
    height = Math.ceil((width * aspect.ah) / aspect.aw);
    if (height < photo.height) {
      height = photo.height;
      width = Math.ceil((height * aspect.aw) / aspect.ah);
    }
  }

  if (
    width < MIN_CREATIVE_IMAGE_DIMENSION ||
    height < MIN_CREATIVE_IMAGE_DIMENSION ||
    width > MAX_CREATIVE_IMAGE_DIMENSION ||
    height > MAX_CREATIVE_IMAGE_DIMENSION
  ) {
    throw new CreativeAssetProviderError({
      code: "compose_canvas_out_of_range",
      message:
        "Compose-Canvas passt nicht in 256–4096 bei 1:1-Embed des Locked Photos.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  const left = Math.floor((width - photo.width) / 2);
  const top = Math.floor((height - photo.height) / 2);

  return {
    width,
    height,
    placements: [
      {
        assetId: photo.assetId,
        left,
        top,
        width: photo.width,
        height: photo.height,
      },
    ],
  };
}

async function rawRgba(bytes: Uint8Array): Promise<{
  data: Buffer;
  width: number;
  height: number;
}> {
  const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new CreativeAssetProviderError({
      code: "pixel_guard_channels",
      message: "Pixel-Guard erwartet RGBA.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }
  return { data, width: info.width, height: info.height };
}

/**
 * Exact region compare: composed[left.., top..] must equal locked photo RGBA.
 */
export async function assertLockedPhotoPixelGuard(input: {
  composedBytes: Uint8Array;
  locked: LockedPhotoAsset;
  left: number;
  top: number;
}): Promise<void> {
  const composed = await rawRgba(input.composedBytes);
  const locked = await rawRgba(input.locked.bytes);

  if (
    locked.width !== input.locked.width ||
    locked.height !== input.locked.height
  ) {
    throw new CreativeAssetProviderError({
      code: "pixel_guard_decode_mismatch",
      message: "Locked-Photo-Decode weicht von Metadaten ab.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (
    input.left < 0 ||
    input.top < 0 ||
    input.left + locked.width > composed.width ||
    input.top + locked.height > composed.height
  ) {
    throw new CreativeAssetProviderError({
      code: "pixel_guard_out_of_bounds",
      message: "Locked-Photo-Platzierung liegt außerhalb des Compose-Canvas.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  for (let y = 0; y < locked.height; y += 1) {
    for (let x = 0; x < locked.width; x += 1) {
      const lockedIndex = (y * locked.width + x) * 4;
      const composedIndex =
        ((input.top + y) * composed.width + (input.left + x)) * 4;
      for (let c = 0; c < 4; c += 1) {
        if (composed.data[composedIndex + c] !== locked.data[lockedIndex + c]) {
          throw new CreativeAssetProviderError({
            code: "pixel_guard_failed",
            message:
              "Pixel-Guard: Locked Photo wurde verändert (Embed-only verletzt).",
            failureMode: "POLICY_REJECTED",
            safeToRetry: false,
          });
        }
      }
    }
  }
}

/**
 * Embed locked photos onto an AI background without altering locked pixels.
 * Always emits lossless PNG so the pixel guard remains meaningful.
 */
export async function composeLockedPhotoCreative(input: {
  backgroundBytes: Uint8Array;
  locked: LockedPhotoAsset[];
  aspectHint?: string;
}): Promise<LockedPhotoComposeResult> {
  const layout = planLockedPhotoCanvas({
    locked: input.locked,
    aspectHint: input.aspectHint,
  });

  const backgroundFitted = await sharp(Buffer.from(input.backgroundBytes), {
    failOn: "none",
  })
    .rotate()
    .resize(layout.width, layout.height, {
      fit: "cover",
      position: "centre",
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const composites = layout.placements.map((placement, index) => {
    const photo = input.locked[index];
    return {
      input: Buffer.from(photo.bytes),
      left: placement.left,
      top: placement.top,
    };
  });

  const composedBuffer = await sharp(backgroundFitted)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();

  const composedBytes = new Uint8Array(composedBuffer);

  const placements: LockedPhotoPlacement[] = [];
  for (let i = 0; i < layout.placements.length; i += 1) {
    const placement = layout.placements[i];
    const photo = input.locked[i];
    await assertLockedPhotoPixelGuard({
      composedBytes,
      locked: photo,
      left: placement.left,
      top: placement.top,
    });
    placements.push({
      asset_id: photo.assetId,
      left: placement.left,
      top: placement.top,
      width: placement.width,
      height: placement.height,
      sha256: photo.sha256,
      pixel_guard: "passed",
    });
  }

  const inspected = inspectCreativeImage({
    bytes: composedBytes,
    declaredMimeType: "image/png",
  });

  if (
    inspected.width !== layout.width ||
    inspected.height !== layout.height
  ) {
    throw new CreativeAssetProviderError({
      code: "compose_dimension_mismatch",
      message: "Compose-Output-Maße stimmen nicht mit dem Canvas überein.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  return {
    bytes: inspected.bytes,
    mimeType: "image/png",
    width: inspected.width,
    height: inspected.height,
    sha256: inspected.sha256,
    placements,
    composeVersion: LOCKED_PHOTO_COMPOSE_VERSION,
  };
}
