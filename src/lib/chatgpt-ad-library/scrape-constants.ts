/** Shared scrape batch size — stays within chatgptadlibrary.com's ~5-page guest limit. */
export const CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX = 5;
/** Unlocker path is not bound to the guest page cap; keep under the 300s cron. */
export const CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX = 10;
export const CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT = 4;

/** Sequential probe ceiling when live HTML discover is checkpointed. */
export const CHATGPT_AD_LIBRARY_PROBE_MAX_ID = 30_000;
export const CHATGPT_AD_LIBRARY_PROBE_WINDOW = 200;

/** Paid-unlocker smoke test: one public ad, never ingested. */
export const CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID = "7341";
