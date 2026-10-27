/**
 * Retry timing for Meta rate limits. No runtime imports:
 * scripts/test-meta-campaign-status-change.mjs loads this file directly.
 */

// Meta #613 "concurrent request rate limit of 1 calls per 30 seconds" clears
// after 30 seconds; waiting the generic 15 minutes only delays the write.
export const SHORT_CONCURRENT_RATE_LIMIT_RETRY_SECONDS = 60;

export function isShortConcurrentRateLimit(
  code: number | null | undefined,
  message: string,
): boolean {
  return code === 613 && /concurrent request rate limit/i.test(message);
}
