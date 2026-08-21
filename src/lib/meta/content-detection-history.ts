/** Customer-facing calendar helpers for Beitrag detection history (no server-only). */

export const CONTENT_DETECTION_TIME_ZONE = "Europe/Berlin";
export const CONTENT_DETECTION_LOOKBACK_DAYS = 7;

export type ContentDetectionSourceCounts = {
  facebook: number;
  instagram: number;
  total: number;
};

/** Calendar day key in the customer timezone (YYYY-MM-DD). */
export function localDayKey(
  value: string | Date,
  timeZone: string = CONTENT_DETECTION_TIME_ZONE,
): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function emptyDetectionSourceCounts(): ContentDetectionSourceCounts {
  return { facebook: 0, instagram: 0, total: 0 };
}

export function bumpDetectionSourceCount(
  counts: ContentDetectionSourceCounts,
  source: string,
) {
  counts.total += 1;
  if (source === "instagram") {
    counts.instagram += 1;
  } else if (source === "facebook") {
    counts.facebook += 1;
  }
}

export function summarizeDetectionWindows<
  T extends { source: string; firstSeenAt: string | null },
>(
  items: T[],
  now: Date = new Date(),
  timeZone: string = CONTENT_DETECTION_TIME_ZONE,
  lookbackDays: number = CONTENT_DETECTION_LOOKBACK_DAYS,
): { today: ContentDetectionSourceCounts; week: ContentDetectionSourceCounts } {
  const todayKey = localDayKey(now, timeZone);
  const weekStart = new Date(
    now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
  );
  const today = emptyDetectionSourceCounts();
  const week = emptyDetectionSourceCounts();

  for (const item of items) {
    const seenAt = item.firstSeenAt;
    if (!seenAt) continue;
    const seenMs = new Date(seenAt).getTime();
    if (!Number.isFinite(seenMs)) continue;

    if (seenMs >= weekStart.getTime()) {
      bumpDetectionSourceCount(week, item.source);
    }
    if (todayKey && localDayKey(seenAt, timeZone) === todayKey) {
      bumpDetectionSourceCount(today, item.source);
    }
  }

  return { today, week };
}

export function isDetectionInWindow(
  firstSeenAt: string | null,
  window: "today" | "week",
  now: Date = new Date(),
  timeZone: string = CONTENT_DETECTION_TIME_ZONE,
  lookbackDays: number = CONTENT_DETECTION_LOOKBACK_DAYS,
): boolean {
  if (!firstSeenAt) return false;
  const seenMs = new Date(firstSeenAt).getTime();
  if (!Number.isFinite(seenMs)) return false;

  if (window === "week") {
    return seenMs >= now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  }

  const todayKey = localDayKey(now, timeZone);
  return Boolean(todayKey && localDayKey(firstSeenAt, timeZone) === todayKey);
}
