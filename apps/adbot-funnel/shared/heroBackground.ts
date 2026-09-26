export const HERO_BACKGROUND_DESKTOP = { maxWidth: 1920, maxHeight: 1200 };
export const HERO_BACKGROUND_MOBILE = { maxWidth: 1100, maxHeight: 1400 };

/** Scale down to the max box. Never crop. Never upscale. Keeps the full motif. */
export function scaleToMaxBox(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
) {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
