import type { StrategyPlatformId } from "@/lib/cross-platform-strategy/catalog";
import {
  STRATEGY_MEASURED_PERFORMANCE_PLATFORMS,
  type StrategyPerformanceInput,
} from "@/lib/cross-platform-strategy/types";

export const STRATEGY_CANONICAL_ENTITY_TYPE = {
  meta: "ad",
  openai_ads: "campaign",
} as const;

export const STRATEGY_PERFORMANCE_MAX_ROWS = 1_000;

type StrategyPerformancePlatform = keyof typeof STRATEGY_CANONICAL_ENTITY_TYPE;
type StrategyMeasuredPerformancePlatform =
  (typeof STRATEGY_MEASURED_PERFORMANCE_PLATFORMS)[number];

export type RawStrategyPerformanceRow = {
  platform_account_id?: unknown;
  platform?: unknown;
  entity_type?: unknown;
  date?: unknown;
  currency?: unknown;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  inline_link_clicks?: unknown;
  conversions?: unknown;
  leads?: unknown;
  purchases?: unknown;
  purchase_value?: unknown;
};

export type StrategyPerformancePage = {
  rows: RawStrategyPerformanceRow[];
  count: number | null;
  errorCode: string | null;
};

export type StrategyPerformanceCollection = {
  rows: RawStrategyPerformanceRow[];
  errorCode: string | null;
};

/**
 * Accepts performance only from one database statement. PostgreSQL gives that
 * statement a consistent snapshot; client-side offset paging cannot provide
 * the same guarantee while a sync may replace rows. Exact count equality proves
 * that no server response cap truncated the result.
 */
export async function readCompleteStrategyPerformanceRows(
  readSnapshot: (from: number, to: number) => Promise<StrategyPerformancePage>,
  maxRows = STRATEGY_PERFORMANCE_MAX_ROWS,
): Promise<StrategyPerformanceCollection> {
  const page = await readSnapshot(0, maxRows - 1);
  if (page.errorCode) return { rows: [], errorCode: page.errorCode };
  if (page.count === null || page.count > maxRows) {
    return { rows: [], errorCode: "strategy_performance_row_limit" };
  }
  if (page.rows.length !== page.count) {
    return { rows: [], errorCode: "strategy_performance_incomplete_read" };
  }
  return { rows: page.rows, errorCode: null };
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nullableNonNegativeInteger(value: unknown): number | null {
  const parsed = nullableNonNegativeNumber(value);
  if (parsed === null || !Number.isSafeInteger(parsed)) return null;
  return parsed;
}

function nullableMajorToMinor(value: unknown): number | null {
  const parsed = nullableNonNegativeNumber(value);
  if (parsed === null) return null;
  const minor = Math.round(parsed * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function isPerformancePlatform(value: string): value is StrategyPerformancePlatform {
  return Object.prototype.hasOwnProperty.call(STRATEGY_CANONICAL_ENTITY_TYPE, value);
}

function isMeasuredPerformancePlatform(
  value: StrategyPerformancePlatform,
): value is StrategyMeasuredPerformancePlatform {
  return value === "meta";
}

/**
 * Converts raw provider rows without aggregating away currency or NULL semantics.
 * Only a canonical, explicitly completeness-safe provider grain is accepted.
 */
export function normalizeStrategyPerformanceRows(
  rows: readonly RawStrategyPerformanceRow[],
  scopedAccounts: ReadonlyMap<string, StrategyPlatformId>,
): StrategyPerformanceInput[] {
  const normalized: StrategyPerformanceInput[] = [];

  for (const row of rows) {
    const accountId = nonEmptyText(row.platform_account_id);
    const platform = nonEmptyText(row.platform);
    const entityType = nonEmptyText(row.entity_type);
    if (!accountId || !platform || !entityType || !isPerformancePlatform(platform)) {
      continue;
    }
    if (!isMeasuredPerformancePlatform(platform)) continue;
    if (scopedAccounts.get(accountId) !== platform) continue;
    if (STRATEGY_CANONICAL_ENTITY_TYPE[platform] !== entityType) continue;

    normalized.push({
      accountId,
      platform,
      currency: (nonEmptyText(row.currency) ?? "UNKNOWN").toUpperCase(),
      spendMinor: nullableMajorToMinor(row.spend),
      impressions: nullableNonNegativeInteger(row.impressions),
      clicks: nullableNonNegativeInteger(row.inline_link_clicks),
      conversions: nullableNonNegativeNumber(row.conversions),
      leads: nullableNonNegativeNumber(row.leads),
      purchases: nullableNonNegativeNumber(row.purchases),
      conversionValueMinor: nullableMajorToMinor(row.purchase_value),
      latestDataDate: nonEmptyText(row.date),
    });
  }

  return normalized;
}
