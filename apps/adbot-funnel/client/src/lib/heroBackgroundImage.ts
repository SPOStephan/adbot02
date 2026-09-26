import { HERO_BACKGROUND_DESKTOP, HERO_BACKGROUND_MOBILE, HERO_IMAGE_MAX, scaleToMaxBox } from "@shared/heroBackground";

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function canvasToBase64(canvas: HTMLCanvasElement, quality = 0.74) {
  const blob = await new Promise<Blob | null>(resolve => {
    if (canvas.toBlob) {
      canvas.toBlob(resolve, "image/webp", quality);
      return;
    }
    resolve(null);
  });
  const fallback = blob ?? await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error("Bild konnte nicht kodiert werden.")), "image/jpeg", quality);
  });
  const buffer = await fallback.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(value => { binary += String.fromCharCode(value); });
  return {
    dataBase64: btoa(binary),
    mimeType: fallback.type === "image/webp" ? "image/webp" as const : "image/jpeg" as const,
    size: fallback.size,
  };
}

async function encodeVariant(bitmap: ImageBitmap, maxWidth: number, maxHeight: number) {
  const size = scaleToMaxBox(bitmap.width, bitmap.height, maxWidth, maxHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvasToBase64(canvas);
}

export async function prepareHeroImage(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("Bitte ein JPG, PNG, WebP oder GIF wählen.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Das Bild darf maximal 12 MB groß sein.");
  const bitmap = await createImageBitmap(file);
  try {
    const image = await encodeVariant(bitmap, HERO_IMAGE_MAX.maxWidth, HERO_IMAGE_MAX.maxHeight);
    return { image, filename: file.name };
  } finally {
    bitmap.close();
  }
}

export async function prepareHeroBackgroundVariants(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("Bitte ein JPG, PNG, WebP oder GIF wählen.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Das Bild darf maximal 12 MB groß sein.");
  const bitmap = await createImageBitmap(file);
  try {
    const [desktop, mobile] = await Promise.all([
      encodeVariant(bitmap, HERO_BACKGROUND_DESKTOP.maxWidth, HERO_BACKGROUND_DESKTOP.maxHeight),
      encodeVariant(bitmap, HERO_BACKGROUND_MOBILE.maxWidth, HERO_BACKGROUND_MOBILE.maxHeight),
    ]);
    return { desktop, mobile, filename: file.name };
  } finally {
    bitmap.close();
  }
}
