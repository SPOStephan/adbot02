/**
 * Legal pages are plain text (not Markdown). Strip accidental heading markers
 * like "# Titel" / "## Abschnitt" that show up literally in the public pages.
 */
export function normalizeLegalPlainText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
