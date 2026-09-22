import { runDedicatedUnlock } from "../apps/chatgpt-ad-library-worker/lib/unlock-run.ts";

const result = await runDedicatedUnlock({ mode: "run" });
console.log(JSON.stringify(result, null, 2));
if (!result.configured) {
  console.warn("SCRAPINGBEE_API_KEY fehlt — Unlocker nicht konfiguriert.");
  process.exit(1);
}
