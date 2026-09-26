export const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

function hexDigits(input: string) {
  return input.trim().replace(/^#/, "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function expandShortHex(digits: string) {
  return `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
}

export function formatHexColorDraft(input: string) {
  const digits = hexDigits(input).slice(0, 6);
  return digits ? `#${digits}` : "";
}

export function normalizeHexColor(input: string, options?: { expandShort?: boolean }) {
  const digits = hexDigits(input);
  if (options?.expandShort && digits.length === 3) return `#${expandShortHex(digits)}`;
  const draft = digits.slice(0, 6);
  return draft.length === 6 && HEX_COLOR_PATTERN.test(`#${draft}`) ? `#${draft}` : null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number) {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function parseRgbComponent(input: string) {
  if (!/^\d{1,3}$/.test(input.trim())) return null;
  const value = Number(input.trim());
  if (!Number.isFinite(value) || value < 0 || value > 255) return null;
  return value;
}
