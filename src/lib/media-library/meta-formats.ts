/**
 * Shared Meta creative format slots — safe for client and server.
 * Used for upload validation, smart crop skip, and picker UI.
 */

export const META_FORMAT_SLOTS = [
  {
    key: "meta_feed_1x1",
    label: "Feed 1:1",
    width: 1080,
    height: 1080,
    note: "Standard für Feed-Anzeigen",
    preferredForLaunch: true,
  },
  {
    key: "meta_feed_4x5",
    label: "Feed 4:5",
    width: 1080,
    height: 1350,
    note: "Mehr Fläche im mobilen Feed",
    preferredForLaunch: false,
  },
  {
    key: "meta_story_9x16",
    label: "Story 9:16",
    width: 1080,
    height: 1920,
    note: "Stories, Reels und hochkantige Platzierungen",
    preferredForLaunch: false,
  },
] as const;

export type MetaFormatKey = (typeof META_FORMAT_SLOTS)[number]["key"];

export type MetaFormatSlot = (typeof META_FORMAT_SLOTS)[number];

/** Aspect ratio may deviate by at most this fraction of the target ratio. */
export const META_FORMAT_RATIO_TOLERANCE = 0.03;

/** Each edge must be at least this fraction of the recommended size. */
export const META_FORMAT_MIN_EDGE_RATIO = 0.85;

export function isMetaFormatKey(value: string): value is MetaFormatKey {
  return META_FORMAT_SLOTS.some((slot) => slot.key === value);
}

export function getMetaFormatSlot(key: MetaFormatKey): MetaFormatSlot {
  const slot = META_FORMAT_SLOTS.find((entry) => entry.key === key);
  if (!slot) {
    throw new Error(`Unknown Meta format key: ${key}`);
  }
  return slot;
}

export function matchesMetaFormat(
  width: number,
  height: number,
  slot: Pick<MetaFormatSlot, "width" | "height">,
): boolean {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    return false;
  }

  const targetRatio = slot.width / slot.height;
  const actualRatio = width / height;
  if (
    Math.abs(actualRatio - targetRatio) / targetRatio >
    META_FORMAT_RATIO_TOLERANCE
  ) {
    return false;
  }

  if (
    width < slot.width * META_FORMAT_MIN_EDGE_RATIO ||
    height < slot.height * META_FORMAT_MIN_EDGE_RATIO
  ) {
    return false;
  }

  return true;
}

export function presetsNeedingCrop(
  width: number,
  height: number,
): MetaFormatKey[] {
  return META_FORMAT_SLOTS.filter(
    (slot) => !matchesMetaFormat(width, height, slot),
  ).map((slot) => slot.key);
}

export function describeMetaFormatCheck(
  width: number,
  height: number,
  slot: MetaFormatSlot,
): { ok: true } | { ok: false; message: string } {
  if (matchesMetaFormat(width, height, slot)) {
    return { ok: true };
  }

  const targetRatio = slot.width / slot.height;
  const actualRatio = width / height;
  const ratioOff =
    Math.abs(actualRatio - targetRatio) / targetRatio >
    META_FORMAT_RATIO_TOLERANCE;

  if (ratioOff) {
    return {
      ok: false,
      message:
        `${slot.label}: Seitenverhältnis passt nicht ` +
        `(ist ${width}×${height}, empfohlen ${slot.width}×${slot.height}).`,
    };
  }

  return {
    ok: false,
    message:
      `${slot.label}: Auflösung zu klein ` +
      `(ist ${width}×${height}, empfohlen mind. ca. ` +
      `${Math.round(slot.width * META_FORMAT_MIN_EDGE_RATIO)}×` +
      `${Math.round(slot.height * META_FORMAT_MIN_EDGE_RATIO)}, ` +
      `ideal ${slot.width}×${slot.height}).`,
  };
}

export function formatLabelForDimensions(
  width: number | null | undefined,
  height: number | null | undefined,
): string | null {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  for (const slot of META_FORMAT_SLOTS) {
    if (matchesMetaFormat(width, height, slot)) {
      return slot.label;
    }
  }
  return null;
}

/** Read pixel size in the browser before upload (Schnellcheck). */
export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        reject(new Error("Bildgröße konnte nicht gelesen werden."));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht geladen werden."));
    };
    image.src = url;
  });
}
