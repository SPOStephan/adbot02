import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clampCopySizeStep, copySizeCssVars, copySizeLabel, copySizeScale, DEFAULT_COPY_SIZE_STEP, MAX_COPY_SIZE_STEP, MIN_COPY_SIZE_STEP } from "@shared/copySize";

describe("Schriftgröße der Textbereiche", () => {
  it("hält Schritt 0 als unveränderte Standardgröße", () => {
    expect(clampCopySizeStep(undefined)).toBe(DEFAULT_COPY_SIZE_STEP);
    expect(clampCopySizeStep("nein")).toBe(0);
    expect(copySizeScale(0)).toBe(1);
    expect(copySizeLabel(0)).toBe("Standard");
    expect(copySizeCssVars({})).toEqual({
      "--fs-eyebrow": "1",
      "--fs-title": "1",
      "--fs-subtitle": "1",
      "--fs-description": "1",
    });
  });

  it("skaliert in kleinen Schritten und begrenzt den Bereich", () => {
    expect(copySizeScale(1)).toBe(1.06);
    expect(copySizeScale(-1)).toBe(0.94);
    expect(copySizeLabel(2)).toBe("+2");
    expect(copySizeLabel(-3)).toBe("-3");
    expect(clampCopySizeStep(99)).toBe(MAX_COPY_SIZE_STEP);
    expect(clampCopySizeStep(-99)).toBe(MIN_COPY_SIZE_STEP);
    expect(copySizeCssVars({ titleSizeStep: 2, eyebrowSizeStep: -1 })).toMatchObject({
      "--fs-eyebrow": "0.94",
      "--fs-title": "1.12",
    });
  });

  it("multipliziert die bisherigen CSS-Größen mit den Bereichsvariablen", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../client/src/index.css"), "utf8");
    expect(css).toContain("calc(12px * var(--fs-eyebrow, 1))");
    expect(css).toContain("calc(clamp(2rem, 9vw, 3.6rem) * var(--fs-title, 1))");
    expect(css).toContain("calc(clamp(1.05rem, 4vw, 1.4rem) * var(--fs-subtitle, 1))");
    expect(css).toContain("calc(15px * var(--fs-description, 1))");
    expect(css).toContain("calc(16px * var(--fs-eyebrow, 1))");
    expect(css).toContain("calc(2rem * var(--fs-title, 1))");
  });
});
