export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;
  async function run(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => run()));
  return results;
}

const SKIP_ERRORS = new Set([
  "parse_failed",
  "parse_copy_missing",
  "http_404",
  "unlocker_404",
  "http_410",
  "unlocker_410",
]);

export function isUnlockerProviderBlockError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  return (
    normalized === "unlocker_credits" ||
    normalized === "unlocker_400" ||
    normalized === "unlocker_401" ||
    normalized === "unlocker_402" ||
    normalized === "unlocker_403" ||
    /credit|quota|payment required|api[_ ]key/i.test(normalized)
  );
}

export function shouldSkipScrapeError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  if (isUnlockerProviderBlockError(normalized)) return false;
  if (SKIP_ERRORS.has(normalized)) return true;
  return /^(http|unlocker)_4(04|10)$/.test(normalized);
}
