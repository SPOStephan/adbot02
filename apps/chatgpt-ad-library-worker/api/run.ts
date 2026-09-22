import type { IncomingMessage, ServerResponse } from "node:http";

import { parseWorkerMode, roundsForMode, runDedicatedUnlock } from "../lib/unlock-run";

export const config = {
  maxDuration: 300,
};

function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function authorized(req: IncomingMessage): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const header = String(req.headers.authorization ?? "");
  return timingSafeEqual(header, `Bearer ${secret}`);
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function requestUrl(req: IncomingMessage): URL {
  const host = String(req.headers.host ?? "localhost");
  return new URL(req.url ?? "/api/run", `https://${host}`);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    send(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  if (!cronSecret()) {
    send(res, 503, { ok: false, error: "cron_not_configured" });
    return;
  }
  if (!authorized(req)) {
    send(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const url = requestUrl(req);
  const mode = parseWorkerMode(url.searchParams.get("mode"));
  try {
    const result = await runDedicatedUnlock({
      mode,
      rounds: roundsForMode(mode),
    });
    send(res, 200, result);
  } catch (error) {
    console.error("chatgpt_ad_library_worker_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    send(res, 500, {
      ok: false,
      error: "worker_failed",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
