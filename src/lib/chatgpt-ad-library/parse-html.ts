const CHATGPT_AD_LIBRARY_ORIGIN = "https://www.chatgptadlibrary.com";
const CHATGPT_AD_LIBRARY_IMAGE_HOST = "img.chatgptadlibrary.com";

const AD_ID_RE = /\/ad\/(\d{1,12})(?:[/?#]|$)/;
const HASH_IMG_RE = new RegExp(
  `https://${CHATGPT_AD_LIBRARY_IMAGE_HOST.replace(/\./g, "\\.")}/c/[0-9a-f]{2}/[0-9a-f]{32,128}\\.webp`,
  "gi",
);

const CHROME_RE =
  /we couldn't find that|want us to go get it|tell us the advertiser|probe chatgpt for the ads|keep it updated|a sponsored chatgpt ad by|gads-theme|localstorage\.getItem|document\.documentElement|document\.document/i;
const CODE_RE =
  /\(function\s*\(|try\s*\{|localStorage|document\.|=>\s*\{|colorScheme|data-theme/;

export type ChatGPTAdLibraryCopyFields = {
  title: string;
  advertiserName: string;
  body: string;
  triggeringPrompts: string[];
};

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

export function isChatGPTAdLibraryChromeText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return CHROME_RE.test(text) || CODE_RE.test(text);
}

/** Drop library SEO that og:description appends after the real ad body. */
export function stripChatGPTAdLibrarySeoBlurb(value: string): string {
  return value
    .replace(/\s*A sponsored ChatGPT ad by[\s\S]*$/i, "")
    .replace(/\s*,?\s*and the \d+ prompts that trigger it\.?\s*$/i, "")
    .trim();
}

export function isLikelyChatGPTAdTriggerPrompt(value: string): boolean {
  const text = value.trim();
  if (text.length < 12 || text.length > 400) return false;
  if (isChatGPTAdLibraryChromeText(text)) return false;
  if (/chatgpt ad\s*$/i.test(text)) return false;
  if (/^[A-Z][\w .&'-]{1,60}:\s*[“"].+[”"]$/.test(text)) return false;
  if ((text.match(/\s+/g) ?? []).length < 2) return false;
  if (/[{};=<>]|<\/?[a-z]|javascript:/i.test(text) && CODE_RE.test(text)) return false;
  return /[a-z]/i.test(text);
}

export function isDirtyChatGPTAdLibraryCopy(input: ChatGPTAdLibraryCopyFields): boolean {
  const clean = sanitizeChatGPTAdLibraryCopy(input);
  if (input.body.trim() !== clean.body) return true;
  if (isChatGPTAdLibraryChromeText(input.title) || isChatGPTAdLibraryChromeText(input.body)) {
    return true;
  }
  if (input.triggeringPrompts.some((item) => !isLikelyChatGPTAdTriggerPrompt(item))) return true;
  return clean.triggeringPrompts.length === 0;
}

export function resolveChatGPTAdLibraryCopy(input: {
  current: ChatGPTAdLibraryCopyFields;
  incoming: ChatGPTAdLibraryCopyFields;
  seed?: ChatGPTAdLibraryCopyFields | null;
}): ChatGPTAdLibraryCopyFields {
  const current = sanitizeChatGPTAdLibraryCopy(input.current);
  const incoming = sanitizeChatGPTAdLibraryCopy(input.incoming);
  const seed = input.seed ? sanitizeChatGPTAdLibraryCopy(input.seed) : null;
  const prompts = uniqueStrings(
    [...incoming.triggeringPrompts, ...current.triggeringPrompts],
    40,
  );
  return sanitizeChatGPTAdLibraryCopy({
    title: incoming.title || current.title || seed?.title || "",
    advertiserName:
      incoming.advertiserName || current.advertiserName || seed?.advertiserName || "",
    body: incoming.body || current.body || seed?.body || "",
    triggeringPrompts: prompts.length > 0 ? prompts : (seed?.triggeringPrompts ?? []),
  });
}

export function sanitizeChatGPTAdLibraryCopy(
  input: ChatGPTAdLibraryCopyFields,
): ChatGPTAdLibraryCopyFields {
  const title = isChatGPTAdLibraryChromeText(input.title) ? "" : input.title.trim();
  const advertiserName = isChatGPTAdLibraryChromeText(input.advertiserName)
    ? ""
    : input.advertiserName.trim();
  const strippedBody = stripChatGPTAdLibrarySeoBlurb(input.body);
  const body = isChatGPTAdLibraryChromeText(strippedBody) ? "" : strippedBody;
  return {
    title,
    advertiserName,
    body,
    triggeringPrompts: uniqueStrings(
      input.triggeringPrompts.filter(isLikelyChatGPTAdTriggerPrompt),
      40,
    ),
  };
}

export function scoreChatGPTAdLibraryCopy(input: ChatGPTAdLibraryCopyFields): number {
  const clean = sanitizeChatGPTAdLibraryCopy(input);
  if (
    isChatGPTAdLibraryChromeText(input.title) ||
    isChatGPTAdLibraryChromeText(input.body) ||
    input.triggeringPrompts.some((item) => CODE_RE.test(item) || CHROME_RE.test(item))
  ) {
    return -100;
  }
  let score = 0;
  if (clean.body.length >= 8) score += 20 + Math.min(clean.body.length, 80);
  score += clean.triggeringPrompts.length * 8;
  if (clean.title) score += 5;
  if (clean.advertiserName) score += 3;
  return score;
}

export function mergeChatGPTAdLibraryCopy(
  current: ChatGPTAdLibraryCopyFields,
  incoming: ChatGPTAdLibraryCopyFields,
): ChatGPTAdLibraryCopyFields | null {
  const currentClean = sanitizeChatGPTAdLibraryCopy(current);
  const incomingClean = sanitizeChatGPTAdLibraryCopy(incoming);
  const currentScore = scoreChatGPTAdLibraryCopy(current);
  const incomingScore = scoreChatGPTAdLibraryCopy(incoming);

  const mergedPrompts = uniqueStrings(
    [...currentClean.triggeringPrompts, ...incomingClean.triggeringPrompts],
    40,
  );
  const currentBodyIsSeo = /a sponsored chatgpt ad by|prompts that trigger it/i.test(
    current.body,
  );
  const nextBody =
    incomingClean.body &&
    (isChatGPTAdLibraryChromeText(current.body) ||
      currentBodyIsSeo ||
      currentClean.body.length < 8 ||
      (incomingScore > currentScore &&
        incomingClean.body.length >= 8 &&
        incomingClean.body.length <= currentClean.body.length + 20))
      ? incomingClean.body
      : currentClean.body;
  const nextTitle =
    incomingClean.title && (!currentClean.title || currentScore < 0)
      ? incomingClean.title
      : currentClean.title;
  const nextAdvertiser =
    incomingClean.advertiserName && (!currentClean.advertiserName || currentScore < 0)
      ? incomingClean.advertiserName
      : currentClean.advertiserName;

  const next = sanitizeChatGPTAdLibraryCopy({
    title: nextTitle,
    advertiserName: nextAdvertiser,
    body: nextBody,
    triggeringPrompts: mergedPrompts,
  });
  const nextScore = scoreChatGPTAdLibraryCopy(next);
  const promptsGrew = next.triggeringPrompts.length > currentClean.triggeringPrompts.length;
  const bodyRepaired =
    isChatGPTAdLibraryChromeText(current.body) && next.body.length >= 8;
  const titleRepaired =
    isChatGPTAdLibraryChromeText(current.title) && Boolean(next.title);
  if (nextScore < 0) return null;
  if (!bodyRepaired && !titleRepaired && !promptsGrew && nextScore <= currentScore) {
    return null;
  }
  return next;
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
        const value = decodeHtml(unescapeJson(match[1]).trim());
        if (value && !isChatGPTAdLibraryChromeText(value)) return value;
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
        [...match[1].matchAll(/"((?:\\.|[^"\\]){3,400})"/g)]
          .map((item) => decodeHtml(unescapeJson(item[1] ?? "")))
          .filter(isLikelyChatGPTAdTriggerPrompt),
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
    if (typeof value === "string" && value.trim() && !isChatGPTAdLibraryChromeText(value)) {
      return value.trim();
    }
  }
  return "";
}

function pickStringArray(row: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    const items = uniqueStrings(
      value
        .filter((item): item is string => typeof item === "string")
        .filter(isLikelyChatGPTAdTriggerPrompt),
      40,
    );
    if (items.length > 0) return items;
  }
  return [];
}

function pickQuestionLikeArray(row: Record<string, unknown>): string[] {
  for (const value of Object.values(row)) {
    if (!Array.isArray(value) || value.length < 2) continue;
    const items = uniqueStrings(
      value
        .filter((item): item is string => typeof item === "string")
        .filter(isLikelyChatGPTAdTriggerPrompt)
        .filter((item) => /\?$/.test(item) || /^(best|how|what|can|free)\b/i.test(item)),
      40,
    );
    if (items.length >= 2) return items;
  }
  return [];
}

function isAdLikeObject(row: Record<string, unknown>, adId: string): boolean {
  const id = row.id ?? row.adId ?? row.external_id;
  if (id != null && String(id) === adId) return true;
  const hasAdvertiser = typeof row.advertiserName === "string" && row.advertiserName.trim();
  const hasPrompts = Array.isArray(row.triggeringPrompts);
  const image = typeof row.imageUrl === "string" ? row.imageUrl : "";
  const hasImage = HASH_IMG_RE.test(image);
  HASH_IMG_RE.lastIndex = 0;
  return Boolean(hasAdvertiser && (hasPrompts || hasImage || typeof row.body === "string"));
}

function splitOgTitle(raw: string): { advertiser: string; title: string } {
  if (!raw || isChatGPTAdLibraryChromeText(raw)) return { advertiser: "", title: "" };
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
    /(?:triggering\s+prompts|prompts?\s+that\s+trigger(?:ed)?|\d+\s+prompts)[\s\S]{0,12000}?(?:<\/(?:ul|ol|section|div)>)/i,
  )?.[0];
  if (!labeled) return [];
  return uniqueStrings(
    [
      ...labeled.matchAll(/data-prompt=["']([^"']{3,400})["']/gi),
      ...labeled.matchAll(/<(?:li|p|blockquote|button)[^>]*>\s*(?:<[^>]+>\s*)*([^<]{8,400})/gi),
    ]
      .map((match) => decodeHtml(match[1] ?? ""))
      .filter(isLikelyChatGPTAdTriggerPrompt),
    40,
  );
}

export function hasUsableChatGPTAdLibraryCopy(record: {
  body?: unknown;
  triggeringPrompts?: unknown;
  title?: unknown;
}): boolean {
  const clean = sanitizeChatGPTAdLibraryCopy({
    title: typeof record.title === "string" ? record.title : "",
    advertiserName: "",
    body: typeof record.body === "string" ? record.body : "",
    triggeringPrompts: Array.isArray(record.triggeringPrompts)
      ? record.triggeringPrompts.filter((item): item is string => typeof item === "string")
      : [],
  });
  return clean.body.length >= 8 || clean.triggeringPrompts.length >= 1;
}

/**
 * Best-effort HTML parser for chatgptadlibrary.com ad detail pages.
 * Site chrome, inline scripts and search-empty copy are dropped.
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

  const embedded = collectEmbeddedObjects(html).filter((row) => isAdLikeObject(row, id));
  let embeddedTitle = "";
  let embeddedAdvertiser = "";
  let embeddedBody = "";
  let embeddedLanding: string | null = null;
  let embeddedPrompts: string[] = [];
  let embeddedCategory: string[] = [];
  for (const row of embedded) {
    if (!embeddedTitle) embeddedTitle = pickString(row, ["title", "headline", "adTitle"]);
    if (!embeddedAdvertiser) {
      embeddedAdvertiser = pickString(row, ["advertiserName", "advertiser", "brandName"]);
    }
    if (!embeddedBody) embeddedBody = pickString(row, ["body", "bodyText", "adBody"]);
    if (!embeddedLanding) {
      const landing = pickString(row, ["landingPageUrl", "destinationUrl", "destination_url"]);
      if (/^https:\/\//i.test(landing) && !/chatgptadlibrary\.com/i.test(landing)) {
        embeddedLanding = landing;
      }
    }
    if (embeddedPrompts.length < 1) {
      embeddedPrompts = pickStringArray(row, [
        "triggeringPrompts",
        "associatedPrompts",
        "triggerPrompts",
        "observedPrompts",
        "promptTexts",
      ]);
    }
    if (embeddedPrompts.length < 1) {
      embeddedPrompts = pickQuestionLikeArray(row);
    }
    if (embeddedCategory.length < 1) {
      embeddedCategory = uniqueStrings(
        (Array.isArray(row.category) ? row.category : Array.isArray(row.categories) ? row.categories : [])
          .filter((item): item is string => typeof item === "string")
          .filter((item) => !isChatGPTAdLibraryChromeText(item)),
        12,
      );
    }
  }

  const ogTitleRaw = firstMatch(html, [
    /property=["']og:title["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+property=["']og:title["']/i,
  ]);
  const ogSplit = splitOgTitle(ogTitleRaw);
  const clean = sanitizeChatGPTAdLibraryCopy({
    title:
      embeddedTitle ||
      jsonStringField(html, ["headline", "adTitle"]) ||
      ogSplit.title ||
      "",
    advertiserName:
      embeddedAdvertiser ||
      jsonStringField(html, ["advertiserName", "advertiser", "brandName"]) ||
      ogSplit.advertiser ||
      "",
    body:
      embeddedBody ||
      jsonStringField(html, ["body", "bodyText", "adBody"]) ||
      firstMatch(html, [
        /property=["']og:description["']\s+content=["']([^"']+)["']/i,
        /content=["']([^"']+)["']\s+property=["']og:description["']/i,
      ]),
    triggeringPrompts: [
      ...embeddedPrompts,
      ...jsonStringArray(
        html,
        ["triggeringPrompts", "associatedPrompts", "triggerPrompts", "observedPrompts"],
        40,
      ),
      ...visiblePromptList(html),
    ],
  });

  const landingPageUrl =
    embeddedLanding ||
    jsonStringField(html, ["landingPageUrl", "destinationUrl", "destination_url"]) ||
    firstMatch(html, [
      /"landingPageUrl"\s*:\s*"(https:\/\/[^"]+)"/i,
      /href=["'](https:\/\/(?!www\.chatgptadlibrary\.com|img\.chatgptadlibrary\.com)[^"']+)["'][^>]*>\s*Visit/i,
    ]) ||
    null;

  const category = uniqueStrings(
    [
      ...embeddedCategory,
      ...[...html.matchAll(/\/library\/([^"'/]+)\/?/gi)].map((match) =>
        decodeHtml(decodeURIComponent(match[1] ?? "").replace(/[-_]/g, " ")),
      ),
    ].filter((item) => !isChatGPTAdLibraryChromeText(item)),
    12,
  );

  return {
    id: Number(id),
    sourceUrl: `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${id}`,
    advertiserName: (clean.advertiserName || clean.title || `ChatGPT Ad ${id}`).slice(0, 120),
    title: (clean.title || clean.advertiserName || `ChatGPT Ad ${id}`).slice(0, 120),
    body: clean.body.slice(0, 2000),
    imageUrl,
    landingPageUrl:
      landingPageUrl &&
      /^https:\/\//i.test(landingPageUrl) &&
      !/chatgptadlibrary\.com/i.test(landingPageUrl) &&
      !isChatGPTAdLibraryChromeText(landingPageUrl)
        ? landingPageUrl
        : null,
    triggeringPrompts: clean.triggeringPrompts,
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
