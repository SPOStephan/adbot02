const FETCH_TIMEOUT_MS = 60_000;

export type AdbotStatus = {
  enabled?: boolean;
  pendingCount?: number;
  lastDiscoverAt?: string | null;
  nextDiscoverShard?: number;
  unlockerConfigured?: boolean;
};

function appUrl(): string {
  const value = process.env.ADBOT_APP_URL?.trim().replace(/\/$/, "") ?? "";
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("ADBOT_APP_URL fehlt. Im Worker-Projekt z.B. https://app.adbot.one setzen.");
  }
  return value;
}

function cronSecret(): string {
  const value = process.env.CRON_SECRET?.trim() ?? "";
  if (value.length < 32) {
    throw new Error("CRON_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  }
  return value;
}

async function adbotFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${appUrl()}${path}`, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cronSecret()}`,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload || payload.ok !== true) {
      const detail =
        (payload && typeof payload.error === "string" && payload.error) ||
        `HTTP ${response.status}`;
      throw new Error(`Adbot ${path}: ${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStatus(): Promise<AdbotStatus> {
  const payload = await adbotFetch("/api/cron/chatgpt-ad-library-scrape?mode=status");
  return (payload.status ?? {}) as AdbotStatus;
}

export async function getPlan(limit: number): Promise<{
  enabled: boolean;
  ids: string[];
  pendingRemaining: number;
  source: string;
  discoverShard: number | null;
}> {
  const payload = await adbotFetch(
    `/api/cron/chatgpt-ad-library-scrape?mode=plan&limit=${encodeURIComponent(String(limit))}`,
  );
  const plan = (payload.plan ?? {}) as {
    enabled?: boolean;
    ids?: string[];
    pendingRemaining?: number;
    source?: string;
    discoverShard?: number | null;
  };
  return {
    enabled: plan.enabled === true,
    ids: Array.isArray(plan.ids) ? plan.ids.map((id) => String(id)) : [],
    pendingRemaining: Number(plan.pendingRemaining) || 0,
    source: typeof plan.source === "string" ? plan.source : "empty",
    discoverShard: typeof plan.discoverShard === "number" ? plan.discoverShard : null,
  };
}

export async function postAction(
  action: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return adbotFetch("/api/cron/chatgpt-ad-library-scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
}
