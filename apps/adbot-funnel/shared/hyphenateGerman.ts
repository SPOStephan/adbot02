import { hyphenateHTMLSync, hyphenateSync } from "hyphen/de-1996";

export const SOFT_HYPHEN = "\u00AD";

/** Only words this long can overflow a typical funnel tile; shorter ones wrap as a whole. */
export const MIN_HYPHEN_WORD_LENGTH = 18;

const hyphenOptions = { minWordLength: MIN_HYPHEN_WORD_LENGTH };

export function stripSoftHyphens(value: string): string {
  return value.replaceAll(SOFT_HYPHEN, "");
}

export function hyphenateGermanText(text: string): string {
  if (!text) return "";
  return hyphenateSync(stripSoftHyphens(text), hyphenOptions);
}

export function hyphenateGermanHtml(html: string): string {
  if (!html) return "";
  return hyphenateHTMLSync(stripSoftHyphens(html), hyphenOptions);
}
