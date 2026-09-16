const CHATGPT_AD_LIBRARY_ORIGIN = "https://www.chatgptadlibrary.com";
const CHATGPT_AD_LIBRARY_IMAGE_HOST = "img.chatgptadlibrary.com";

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

function unescapeJson(value: string): string {
  return value
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
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

function jsonStringField(source: string, keys: string[]): string {
  for (const key of keys) {
    const patterns = [
      new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"),
      new RegExp(`\\\\"${key}\\\\"\\s*:\\s*\\\\"((?:\\\\.|[^"\\\\])*)\\\\"`, "i"),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (match?.[1]) {
        return decodeHtml(unescapeJson(match[1]).trim());
      }
    }
  }
  return "";
}

function jsonStringArray(source: string, keys: string[], max: number): string[] {
  for (const key of keys) {
    const patterns = [
      new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i"),
      new RegExp(`\\\\"${key}\\\\"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i"),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (!match?.[1]) continue;
      const items = uniqueStrings(
        [...match[1].matchAll(/"((?:\\.|[^"\\]){3,400})"/g)].map((item) =>
          decodeHtml(unescapeJson(item[1] ?? "")),
        ),
        max,
      );
      if (items.length > 0) return items;
    }
  }
  return [];
}

function walkObjects(value: unknown, visit: (row: Record<string, unknown>) => void, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit, depth + 1);
    return;
  }
  const row = value as Record<string, unknown>;
  visit(row);
  for (const child of Object.values(row)) walkObjects(child, visit, depth + 1);
}

function collectEmbeddedObjects(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const scripts = [
    ...html.matchAll(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
    ...html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const match of scripts) {
    try {
      walkObjects(JSON.parse(match[1] ?? ""), (row) => found.push(row));
    } catch {
      // ignore broken payloads
    }
  }
  for (const match of html.matchAll(/__next_f\.push\(\[[^\]]*?,(["'`])([\s\S]*?)\1\]\)/g)) {
    const blob = unescapeJson(match[2] ?? "");
    for (const objectMatch of blob.matchAll(/\{[^{}]{20,8000}\}/g)) {
      try {
        walkObjects(JSON.parse(objectMatch[0] ?? ""), (row) => found.push(row));
      } catch {
        // not a complete object
      }
    }
  }
  return found;
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickStringArray(row: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    const items = uniqueStrings(
      value.filter((item): item is string => typeof item === "string"),
      40,
    );
    if (items.length > 0) return items;
  }
  return [];
}

function splitOgTitle(raw: string): { advertiser: string; title: string } {
  const cleaned = raw.replace(/\s*[—–-]\s*ChatGPT Ad\s*$/i, "").trim();
  const quoted = /^(.*?):\s*[“"](.+?)[”"]\s*$/.exec(cleaned);
  if (quoted?.[1] && quoted[2]) {
    return { advertiser: quoted[1].trim(), title: quoted[2].trim() };
  }
  const colon = /^(.*?):\s+(.+)$/.exec(cleaned);
  if (colon?.[1] && colon[2] && colon[1].length <= 60) {
    return { advertiser: colon[1].trim(), title: colon[2].trim() };
  }
  return { advertiser: "", title: cleaned };
}

function visiblePromptList(html: string): string[] {
  const labeled = html.match(
    /(?:triggering\s+prompts|prompts?\s+that\s+triggered|associated\s+prompts)[\s\S]{0,4000}?(?:<\/(?:ul|ol|section)>)/i,
  )?.[0];
  const source = labeled ?? html;
  return uniqueStrings(
    [
      ...source.matchAll(/data-prompt=["']([^"']{3,400})["']/gi),
      ...source.matchAll(/<li[^>]*>\s*(?:<[^>]+>\s*)*([^<]{8,400})/gi),
    ].map((match) => decodeHtml(match[1] ?? "")),
    40,
  ).filter((item) => !/^(home|library|login|sign|visit|source|advertiser)$/i.test(item));
}

export function hasUsableChatGPTAdLibraryCopy(record: {
  body?: unknown;
  triggeringPrompts?: unknown;
}): boolean {
  const body = typeof record.body === "string" ? record.body.trim() : "";
  const prompts = Array.isArray(record.triggeringPrompts)
    ? record.triggeringPrompts.filter((item) => typeof item === "string" && item.trim().length >= 8)
    : [];
  return body.length >= 8 || prompts.length >= 1;
}

/**
 * Best-effort HTML parser for chatgptadlibrary.com ad detail pages.
 * Image alone is not enough — callers should require hasUsableChatGPTAdLibraryCopy().
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

  const embedded = collectEmbeddedObjects(html);
  let embeddedTitle = "";
  let embeddedAdvertiser = "";
  let embeddedBody = "";
  let embeddedLanding: string | null = null;
  let embeddedPrompts: string[] = [];
  let embeddedCategory: string[] = [];
  for (const row of embedded) {
    if (!embeddedTitle) {
      embeddedTitle = pickString(row, ["title", "headline", "adTitle", "name"]);
    }
    if (!embeddedAdvertiser) {
      embeddedAdvertiser = pickString(row, [
        "advertiserName",
        "advertiser",
        "brandName",
        "companyName",
      ]);
    }
    if (!embeddedBody) {
      embeddedBody = pickString(row, ["body", "bodyText", "adBody", "copy", "description"]);
    }
    if (!embeddedLanding) {
      const landing = pickString(row, [
        "landingPageUrl",
        "destinationUrl",
        "destination_url",
        "clickUrl",
      ]);
      if (/^https:\/\//i.test(landing) && !/chatgptadlibrary\.com/i.test(landing)) {
        embeddedLanding = landing;
      }
    }
    if (embeddedPrompts.length < 1) {
      embeddedPrompts = pickStringArray(row, [
        "triggeringPrompts",
        "prompts",
        "associatedPrompts",
        "triggerPrompts",
      ]);
    }
    if (embeddedCategory.length < 1) {
      embeddedCategory = pickStringArray(row, ["category", "categories", "niches"]);
    }
  }

  const ogTitleRaw = firstMatch(html, [
    /property=["']og:title["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+property=["']og:title["']/i,
    /<h1[^>]*>([^<]{2,200})<\/h1>/i,
  ]);
  const ogSplit = splitOgTitle(ogTitleRaw);
  const title =
    embeddedTitle ||
    jsonStringField(html, ["title", "headline", "adTitle"]) ||
    ogSplit.title ||
    `ChatGPT Ad ${id}`;

  const advertiserName =
    embeddedAdvertiser ||
    jsonStringField(html, ["advertiserName", "advertiser", "brandName"]) ||
    firstMatch(html, [
      /property=["']og:site_name["']\s+content=["']([^"']+)["']/i,
      /"advertiserName"\s*:\s*"([^"]+)"/i,
    ]) ||
    ogSplit.advertiser ||
    title;

  const body =
    embeddedBody ||
    jsonStringField(html, ["body", "bodyText", "adBody", "copy"]) ||
    firstMatch(html, [
      /property=["']og:description["']\s+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["']\s+property=["']og:description["']/i,
      /<p[^>]*data-(?:body|copy)[^>]*>([^<]{8,400})<\/p>/i,
    ]);

  const landingPageUrl =
    embeddedLanding ||
    jsonStringField(html, ["landingPageUrl", "destinationUrl", "destination_url"]) ||
    firstMatch(html, [
      /rel=["']canonical["']\s+href=["'](https:\/\/(?!www\.chatgptadlibrary\.com)[^"']+)["']/i,
      /"landingPageUrl"\s*:\s*"(https:\/\/[^"]+)"/i,
      /href=["'](https:\/\/(?!www\.chatgptadlibrary\.com|img\.chatgptadlibrary\.com)[^"']+)["'][^>]*>\s*Visit/i,
    ]) ||
    null;

  const triggeringPrompts = uniqueStrings(
    [
      ...embeddedPrompts,
      ...jsonStringArray(html, ["triggeringPrompts", "associatedPrompts", "prompts"], 40),
      ...visiblePromptList(html),
    ],
    40,
  );

  const category = uniqueStrings(
    [
      ...embeddedCategory,
      ...[...html.matchAll(/\/library\/([^"'/]+)\/?/gi)].map((match) =>
        decodeHtml(decodeURIComponent(match[1] ?? "").replace(/[-_]/g, " ")),
      ),
      ...jsonStringArray(html, ["category", "categories"], 12),
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
    landingPageUrl:
      landingPageUrl && /^https:\/\//i.test(landingPageUrl) && !/chatgptadlibrary\.com/i.test(landingPageUrl)
        ? landingPageUrl
        : null,
    triggeringPrompts,
    category,
  };
}

export function extractAdIdsFromSitemapXml(xml: string): string[] {
  if (!xml || /vercel security checkpoint/i.test(xml)) return [];
  const decoded = xml
    .replace(/&amp;/g, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
  return [
    ...new Set(
      [...decoded.matchAll(/\/ad\/(\d{1,12})(?!\d)/gi)]
        .map((match) => match[1] ?? "")
        .filter((id) => id && !decoded.includes(`/ad/sitemaps/${id}`)),
    ),
  ].filter(Boolean);
}
