const UNLOCK_TIMEOUT_MS = 90_000;
const SCRAPINGBEE_ENDPOINT = "https://app.scrapingbee.com/api/v1/";

export function scrapingBeeApiKey(): string | null {
  const value = process.env.SCRAPINGBEE_API_KEY?.trim();
  return value && value.length >= 8 ? value : null;
}

export function isChatGPTAdLibraryUnlockerConfigured(): boolean {
  return scrapingBeeApiKey() !== null;
}

export function isScrapingBeeCreditOrAuthError(input: {
  status: number;
  text?: string | null;
  providerError?: string | null;
}): boolean {
  if (input.status === 401 || input.status === 402) return true;
  const blob = `${input.providerError ?? ""} ${input.text ?? ""}`.toLowerCase();
  return /not enough credits|insufficient credits|credits? (left|remaining|exhausted)|out of credits|quota exceeded|payment required/.test(
    blob,
  );
}

export type UnlockedPage = {
  ok: boolean;
  status: number;
  text: string;
  cost: string | null;
  providerError: string | null;
  attempt: "none" | "auto" | "stealth_fallback";
};

type UnlockParams = Record<string, string>;

/**
 * ScrapingBee only accepts wait_browser=domcontentloaded|load|networkidle0|networkidle2.
 * `networkidle` is invalid and returns HTTP 400 with 0 credits before any scrape.
 */
const AUTO_PARAMS: UnlockParams = {
  mode: "auto",
  wait_browser: "networkidle2",
  timeout: "80000",
};

const STEALTH_PARAMS: UnlockParams = {
  render_js: "true",
  stealth_proxy: "true",
  wait_browser: "networkidle2",
  timeout: "80000",
};

export function extractScrapingBeeError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const parts = ["error", "message", "detail", "reason"]
      .map((key) => parsed[key])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    if (parts.length > 0) return parts.join(" — ").slice(0, 280);
  } catch {
    // not JSON
  }
  if (/vercel security checkpoint/i.test(trimmed) || /<!doctype|<html/i.test(trimmed)) {
    return null;
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 280);
}

async function fetchScrapingBeePage(
  url: string,
  key: string,
  params: UnlockParams,
  attempt: UnlockedPage["attempt"],
): Promise<UnlockedPage> {
  const endpoint = new URL(SCRAPINGBEE_ENDPOINT);
  endpoint.searchParams.set("api_key", key);
  endpoint.searchParams.set("url", url);
  for (const [name, value] of Object.entries(params)) {
    endpoint.searchParams.set(name, value);
  }

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
      providerError: response.ok ? null : extractScrapingBeeError(text),
      attempt,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      text: "",
      cost: null,
      providerError: "unlocker_timeout_or_network",
      attempt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a chatgptadlibrary.com URL through ScrapingBee.
 * Auto-Mode first (cheapest winning tier). HTTP 400 retries with explicit stealth
 * — trial accounts may reject mode=auto; invalid wait_browser also 400s at 0 credits.
 */
export async function unlockChatGPTAdLibraryUrl(url: string): Promise<UnlockedPage> {
  const key = scrapingBeeApiKey();
  if (!key) {
    return {
      ok: false,
      status: 0,
      text: "",
      cost: null,
      providerError: "SCRAPINGBEE_API_KEY fehlt",
      attempt: "none",
    };
  }

  const auto = await fetchScrapingBeePage(url, key, AUTO_PARAMS, "auto");
  if (auto.ok || auto.status !== 400) return auto;

  return fetchScrapingBeePage(url, key, STEALTH_PARAMS, "stealth_fallback");
}
