export const DEFAULT_COPY_SIZE_STEP = 0;
export const MIN_COPY_SIZE_STEP = -4;
export const MAX_COPY_SIZE_STEP = 8;
export const COPY_SIZE_STEP_FACTOR = 0.06;

export type CopySizeFields = {
  eyebrowSizeStep?: number;
  titleSizeStep?: number;
  subtitleSizeStep?: number;
  descriptionSizeStep?: number;
};

export function clampCopySizeStep(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_COPY_SIZE_STEP;
  return Math.max(MIN_COPY_SIZE_STEP, Math.min(MAX_COPY_SIZE_STEP, Math.round(numeric)));
}

export function copySizeScale(step: unknown): number {
  return Number((1 + clampCopySizeStep(step) * COPY_SIZE_STEP_FACTOR).toFixed(3));
}

export function copySizeLabel(step: unknown): string {
  const clamped = clampCopySizeStep(step);
  if (clamped === DEFAULT_COPY_SIZE_STEP) return "Standard";
  return clamped > 0 ? `+${clamped}` : String(clamped);
}

export function copySizeCssVars(page: CopySizeFields): Record<`--fs-${"eyebrow" | "title" | "subtitle" | "description"}`, string> {
  return {
    "--fs-eyebrow": String(copySizeScale(page.eyebrowSizeStep)),
    "--fs-title": String(copySizeScale(page.titleSizeStep)),
    "--fs-subtitle": String(copySizeScale(page.subtitleSizeStep)),
    "--fs-description": String(copySizeScale(page.descriptionSizeStep)),
  };
}
