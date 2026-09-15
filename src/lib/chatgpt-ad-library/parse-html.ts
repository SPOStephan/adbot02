import {
  CHATGPT_AD_LIBRARY_IMAGE_HOST,
  CHATGPT_AD_LIBRARY_ORIGIN,
} from "@/lib/chatgpt-ad-library/types";

const AD_ID_RE = /\/ad\/(\d{1,12})(?:[/?#]|$)/;
const HASH_IMG_RE = new RegExp(
  `https://${CHATGPT_AD_LIBRARY_IMAGE_HOST.replace(/\./g, "\\.")}/c/[0-9a-f]{2}/[0-9a-f]{32,128}\\.webp`,
  "gi",
);

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstMatch(html: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return "";
}

function uniqueStrings(values: string[], max: number): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, max);
}

/**
 * Best-effort HTML parser for chatgptadlibrary.com ad detail pages.
 * Used when a browser/worker already fetched the HTML (Playwright / Browserless).
 */
export function parseChatGPTAdLibraryHtml(input: {
  html: string;
  adId?: string | number;
  pageUrl?: string;
}): Record<string, unknown> | null {
  const html = input.html;
  if (!html || /vercel security checkpoint/i.test(html)) {
    return null;
  }

  const idFromUrl =
    input.adId != null
      ? String(input.adId)
      : input.pageUrl
        ? AD_ID_RE.exec(input.pageUrl)?.[1]
        : undefined;
  const idFromHtml = AD_ID_RE.exec(html)?.[1];
  const id = (idFromUrl || idFromHtml || "").trim();
  if (!/^\d{1,12}$/.test(id)) return null;

  const imageMatches = html.match(HASH_IMG_RE) ?? [];
  const imageUrl = imageMatches.find((url) => !/placeholder/i.test(url)) ?? "";
  if (!imageUrl) return null;

  const title =
    firstMatch(html, [
      /property=["']og:title["']\s+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["']\s+property=["']og:title["']/i,
      /<h1[^>]*>([^<]{2,200})<\/h1>/i,
    ]) || `ChatGPT Ad ${id}`;

  const advertiserName =
    firstMatch(html, [
      /property=["']og:site_name["']\s+content=["']([^"']+)["']/i,
      /"advertiserName"\s*:\s*"([^"]+)"/i,
      /"advertiser"\s*:\s*"([^"]+)"/i,
    ]) || title;

  const body = firstMatch(html, [
    /property=["']og:description["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+property=["']og:description["']/i,
    /"body"\s*:\s*"([^"]+)"/i,
  ]);

  const landingPageUrl =
    firstMatch(html, [
      /rel=["']canonical["']\s+href=["'](https:\/\/(?!www\.chatgptadlibrary\.com)[^"']+)["']/i,
      /"landingPageUrl"\s*:\s*"(https:\/\/[^"]+)"/i,
      /href=["'](https:\/\/(?!www\.chatgptadlibrary\.com|img\.chatgptadlibrary\.com)[^"']+)["'][^>]*>\s*Visit/i,
    ]) || null;

  const promptMatches = [
    ...html.matchAll(/"triggeringPrompts"\s*:\s*\[([\s\S]*?)\]/g),
  ];
  let triggeringPrompts: string[] = [];
  if (promptMatches[0]?.[1]) {
    triggeringPrompts = uniqueStrings(
      [...promptMatches[0][1].matchAll(/"([^"]{3,400})"/g)].map((m) => m[1] ?? ""),
      40,
    );
  }
  if (triggeringPrompts.length < 1) {
    triggeringPrompts = uniqueStrings(
      [...html.matchAll(/data-prompt=["']([^"']{3,400})["']/gi)].map((m) =>
        decodeHtml(m[1] ?? ""),
      ),
      40,
    );
  }

  const category = uniqueStrings(
    [
      ...[...html.matchAll(/\/library\/([^"'/]+)\/?/gi)].map((m) =>
        decodeHtml(decodeURIComponent(m[1] ?? "").replace(/[-_]/g, " ")),
      ),
      ...[...html.matchAll(/"category"\s*:\s*"([^"]+)"/gi)].map((m) => m[1] ?? ""),
    ],
    12,
  );

  return {
    id: Number(id),
    sourceUrl: `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${id}`,
    advertiserName: advertiserName.slice(0, 120),
    title: title.slice(0, 120),
    body: body.slice(0, 2000),
    imageUrl,
    landingPageUrl,
    triggeringPrompts,
    category,
  };
}

export function extractAdIdsFromSitemapXml(xml: string): string[] {
  if (!xml || /vercel security checkpoint/i.test(xml)) return [];
  return [
    ...new Set(
      [...xml.matchAll(/https?:\/\/[^<\s]+\/ad\/(\d{1,12})/gi)].map((m) => m[1] ?? ""),
    ),
  ].filter(Boolean);
}
