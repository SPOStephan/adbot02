import "server-only";

const MAX_HTML_BYTES = 512_000;
const MAX_TEXT_CHARS = 6_000;
const FETCH_TIMEOUT_MS = 8_000;

export type LandingPageContext = {
  url: string;
  title: string;
  description: string;
  excerpt: string;
};

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i",
    );
    const match = html.match(pattern) ?? html.match(alt);
    if (match?.[1]) {
      return decodeBasicEntities(match[1]).trim();
    }
  }
  return "";
}

export function assertPublicHttpsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Die Ziel-URL ist ungültig.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Die Ziel-URL muss HTTPS verwenden.");
  }
  if (url.username || url.password || url.port) {
    throw new Error("Die Ziel-URL darf keinen Benutzer, kein Passwort und keinen Port enthalten.");
  }
  const host = url.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("127.") ||
    host === "0.0.0.0" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("Nur öffentliche HTTPS-Zielseiten sind erlaubt.");
  }
  return url.toString();
}

export async function fetchLandingPageContext(
  destinationUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LandingPageContext> {
  const url = assertPublicHttpsUrl(destinationUrl);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "AdbotCopyBot/1.0 (+https://adbot.one)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Die Zielseite konnte nicht geladen werden (HTTP ${response.status}).`,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml")
  ) {
    throw new Error("Die Ziel-URL liefert keine HTML-Seite.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_HTML_BYTES) {
    throw new Error("Die Zielseite ist zu groß für die Textanalyse.");
  }

  const html = buffer.toString("utf8");
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeBasicEntities((titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim())
    .slice(0, 200);
  const description = metaContent(html, [
    "description",
    "og:description",
    "twitter:description",
  ]).slice(0, 300);
  const excerpt = stripTags(html).slice(0, MAX_TEXT_CHARS);

  if (!title && !description && excerpt.length < 40) {
    throw new Error(
      "Aus der Zielseite konnte kein brauchbarer Text gelesen werden.",
    );
  }

  return { url, title, description, excerpt };
}
