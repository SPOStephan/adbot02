/** Shared scrape batch size — stays within chatgptadlibrary.com's ~5-page guest limit. */
export const CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX = 5;
/** Unlocker path is not bound to the guest page cap. Credits are not a throttle. */
export const CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX = 40;
export const CHATGPT_AD_LIBRARY_UNLOCK_CONCURRENCY = 12;
/** Fill the 800s Vercel Pro window; cron every minute restarts when the lease frees. */
export const CHATGPT_AD_LIBRARY_UNLOCK_ROUNDS_MAX = 16;
export const CHATGPT_AD_LIBRARY_UNLOCK_ROUND_BUDGET_MS = 180_000;
export const CHATGPT_AD_LIBRARY_UNLOCK_DRAIN_BUDGET_MS = 750_000;
export const CHATGPT_AD_LIBRARY_UNLOCK_LEASE_MAX = 2;
export const CHATGPT_AD_LIBRARY_UNLOCK_LEASE_TTL_MS = 14 * 60_000;
/** Skip sitemap discover while the pending queue is already large. */
export const CHATGPT_AD_LIBRARY_DISCOVER_DEFER_PENDING = 250;
export const CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT = 4;

/** Sequential probe ceiling when live HTML discover is checkpointed. */
export const CHATGPT_AD_LIBRARY_PROBE_MAX_ID = 30_000;
export const CHATGPT_AD_LIBRARY_PROBE_WINDOW = 200;

/** Paid-unlocker smoke test: one public ad, never ingested. */
export const CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID = "7341";
