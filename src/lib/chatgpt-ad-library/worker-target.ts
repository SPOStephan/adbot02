import "server-only";

const FETCH_TIMEOUT_MS = 280_000;

export function chatgptAdLibraryWorkerUrl(): string | null {
  const value = process.env.CHATGPT_AD_LIBRARY_WORKER_URL?.trim().replace(/\/$/, "") ?? "";
  return /^https?:\/\//i.test(value) ? value : null;
}

export function isChatGPTAdLibraryWorkerConfigured(): boolean {
  return chatgptAdLibraryWorkerUrl() !== null;
}

export function allowInlineChatGPTAdLibraryUnlock(): boolean {
  return process.env.CHATGPT_AD_LIBRARY_ALLOW_INLINE_UNLOCK === "1";
}

export async function triggerChatGPTAdLibraryWorker(input?: {
  mode?: "run" | "run_now" | "discover" | "probe";
  adId?: string;
}): Promise<Record<string, unknown>> {
  const workerUrl = chatgptAdLibraryWorkerUrl();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!workerUrl) {
    throw new Error("CHATGPT_AD_LIBRARY_WORKER_URL fehlt.");
  }
  if (secret.length < 32) {
    throw new Error("CRON_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  }
  const url = new URL(`${workerUrl}/api/run`);
  url.searchParams.set("mode", input?.mode ?? "run");
  if (input?.adId) url.searchParams.set("adId", input.adId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload || payload.ok !== true) {
      const detail =
        (payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload.message === "string" && payload.message) ||
        `HTTP ${response.status}`;
      throw new Error(`Scrape-Worker: ${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
