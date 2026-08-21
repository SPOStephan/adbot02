/** Customer-facing calendar helpers for Beitrag detection history (no server-only). */

export const CONTENT_DETECTION_TIME_ZONE = "Europe/Berlin";
export const CONTENT_DETECTION_LOOKBACK_DAYS = 7;

export type ContentDetectionSourceCounts = {
  facebook: number;
  instagram: number;
  total: number;
};

export type DetectionHistoryWindow = "today" | "week";

type DetectionTimedItem = {
  source: string;
  firstSeenAt: string | null;
  publishedAt?: string | null;
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
  } else {
    // Non-instagram rows are treated as Facebook in the UI badges.
    counts.facebook += 1;
  }
}

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isSameLocalDay(
  value: string | null | undefined,
  dayKey: string | null,
  timeZone: string,
): boolean {
  if (!value || !dayKey) return false;
  return localDayKey(value, timeZone) === dayKey;
}

function isWithinLookback(
  value: string | null | undefined,
  nowMs: number,
  lookbackDays: number,
): boolean {
  const ms = parseInstant(value);
  if (ms === null) return false;
  return ms >= nowMs - lookbackDays * 24 * 60 * 60 * 1000;
}

/**
 * Heute/Woche: Beitrag zählt, wenn er heute (bzw. in der Woche) veröffentlicht
 * wurde ODER erstmals erkannt wurde. Sonst widersprechen Liste und Warnung,
 * sobald Posts schon früher gespeichert, aber heute veröffentlicht wirken.
 */
export function isDetectionInWindow(
  item: DetectionTimedItem | string | null,
  window: DetectionHistoryWindow,
  now: Date = new Date(),
  timeZone: string = CONTENT_DETECTION_TIME_ZONE,
  lookbackDays: number = CONTENT_DETECTION_LOOKBACK_DAYS,
): boolean {
  // Back-compat: older callers passed firstSeenAt as a bare string.
  const timed: DetectionTimedItem =
    typeof item === "string" || item === null
      ? { source: "", firstSeenAt: item, publishedAt: null }
      : item;

  const nowMs = now.getTime();
  if (window === "week") {
    return (
      isWithinLookback(timed.publishedAt, nowMs, lookbackDays) ||
      isWithinLookback(timed.firstSeenAt, nowMs, lookbackDays)
    );
  }

  const todayKey = localDayKey(now, timeZone);
  return (
    isSameLocalDay(timed.publishedAt, todayKey, timeZone) ||
    isSameLocalDay(timed.firstSeenAt, todayKey, timeZone)
  );
}

export function countDetectionSources(
  items: Array<{ source: string }>,
): ContentDetectionSourceCounts {
  const counts = emptyDetectionSourceCounts();
  for (const item of items) {
    bumpDetectionSourceCount(counts, item.source);
  }
  return counts;
}

export function summarizeDetectionWindows<T extends DetectionTimedItem>(
  items: T[],
  now: Date = new Date(),
  timeZone: string = CONTENT_DETECTION_TIME_ZONE,
  lookbackDays: number = CONTENT_DETECTION_LOOKBACK_DAYS,
): { today: ContentDetectionSourceCounts; week: ContentDetectionSourceCounts } {
  const today = emptyDetectionSourceCounts();
  const week = emptyDetectionSourceCounts();

  for (const item of items) {
    if (isDetectionInWindow(item, "week", now, timeZone, lookbackDays)) {
      bumpDetectionSourceCount(week, item.source);
    }
    if (isDetectionInWindow(item, "today", now, timeZone, lookbackDays)) {
      bumpDetectionSourceCount(today, item.source);
    }
  }

  return { today, week };
}
