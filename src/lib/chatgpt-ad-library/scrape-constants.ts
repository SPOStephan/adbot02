/** Shared scrape batch size — stays within chatgptadlibrary.com's ~5-page guest limit. */
export const CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX = 5;
/** Unlocker path is not bound to the guest page cap. Credits are not a throttle. */
export const CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX = 40;
export const CHATGPT_AD_LIBRARY_UNLOCK_CONCURRENCY = 12;
/** Admin/Action drain hard cap. Cron and GitHub Action must stay well below this. */
export const CHATGPT_AD_LIBRARY_UNLOCK_ROUNDS_MAX = 16;
export const CHATGPT_AD_LIBRARY_UNLOCK_ROUND_BUDGET_MS = 90_000;
/** GitHub Action `mode=unlock` — one short drain so Production login stays free. */
export const CHATGPT_AD_LIBRARY_UNLOCK_ACTION_BUDGET_MS = 90_000;
export const CHATGPT_AD_LIBRARY_UNLOCK_DRAIN_BUDGET_MS = 750_000;
export const CHATGPT_AD_LIBRARY_UNLOCK_LEASE_MAX = 2;
export const CHATGPT_AD_LIBRARY_UNLOCK_LEASE_TTL_MS = 14 * 60_000;
/** Skip sitemap discover while the pending queue is already large. */
export const CHATGPT_AD_LIBRARY_DISCOVER_DEFER_PENDING = 250;
/** Do not start another sitemap unlock just because the queue drained. */
export const CHATGPT_AD_LIBRARY_DISCOVER_COOLDOWN_MS = 10 * 60_000;
export const CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT = 4;

/** Sequential probe ceiling when live HTML discover is checkpointed. */
export const CHATGPT_AD_LIBRARY_PROBE_MAX_ID = 30_000;
export const CHATGPT_AD_LIBRARY_PROBE_WINDOW = 200;

/** Paid-unlocker smoke test: one public ad, never ingested. */
export const CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID = "7341";

/** Admin „Jetzt einen Lauf“ — several rounds, stays under the 300s route limit. */
export const CHATGPT_AD_LIBRARY_RUN_NOW_ROUNDS = 6;
export const CHATGPT_AD_LIBRARY_RUN_NOW_BUDGET_MS = 240_000;
