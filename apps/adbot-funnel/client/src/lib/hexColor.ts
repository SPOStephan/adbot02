export const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

export function formatHexColorDraft(input: string) {
  const digits = input.trim().replace(/^#/, "").replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
  return digits ? `#${digits}` : "";
}

export function normalizeHexColor(input: string) {
  const draft = formatHexColorDraft(input);
  return HEX_COLOR_PATTERN.test(draft) ? draft : null;
}
