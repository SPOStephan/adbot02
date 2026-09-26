import { hyphenateHTMLSync, hyphenateSync } from "hyphen/de-1996";

export const SOFT_HYPHEN = "\u00AD";

export function stripSoftHyphens(value: string): string {
  return value.replaceAll(SOFT_HYPHEN, "");
}

export function hyphenateGermanText(text: string): string {
  if (!text) return "";
  return hyphenateSync(stripSoftHyphens(text));
}

export function hyphenateGermanHtml(html: string): string {
  if (!html) return "";
  return hyphenateHTMLSync(stripSoftHyphens(html));
}
