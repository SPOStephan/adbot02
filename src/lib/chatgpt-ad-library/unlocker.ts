import "server-only";

const UNLOCK_TIMEOUT_MS = 90_000;
const SCRAPINGBEE_ENDPOINT = "https://app.scrapingbee.com/api/v1/";

export function scrapingBeeApiKey(): string | null {
  const value = process.env.SCRAPINGBEE_API_KEY?.trim();
  return value && value.length >= 8 ? value : null;
}

export function isChatGPTAdLibraryUnlockerConfigured(): boolean {
  return scrapingBeeApiKey() !== null;
}

export type UnlockedPage = {
  ok: boolean;
  status: number;
  text: string;
  cost: string | null;
};

/**
 * Fetch a chatgptadlibrary.com URL through ScrapingBee Auto-Mode.
 * Auto-Mode picks the cheapest proxy/JS tier that succeeds (up to stealth).
 */
export async function unlockChatGPTAdLibraryUrl(url: string): Promise<UnlockedPage> {
  const key = scrapingBeeApiKey();
  if (!key) {
    return { ok: false, status: 0, text: "", cost: null };
  }

  const endpoint = new URL(SCRAPINGBEE_ENDPOINT);
  endpoint.searchParams.set("api_key", key);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("mode", "auto");
  endpoint.searchParams.set("wait_browser", "networkidle");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UNLOCK_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    const cost =
      response.headers.get("Spb-auto-cost") ?? response.headers.get("Spb-cost");
    const blocked = /vercel security checkpoint/i.test(text);
    return {
      ok: response.ok && !blocked,
      status: blocked ? 429 : response.status,
      text,
      cost,
    };
  } catch {
    return { ok: false, status: 0, text: "", cost: null };
  } finally {
    clearTimeout(timer);
  }
}
