/** Shared scrape batch size — stays within chatgptadlibrary.com's ~5-page guest limit. */
export const CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX = 5;
export const CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT = 4;

/** Sequential probe ceiling when live HTML discover is checkpointed. */
export const CHATGPT_AD_LIBRARY_PROBE_MAX_ID = 30_000;
export const CHATGPT_AD_LIBRARY_PROBE_WINDOW = 200;
