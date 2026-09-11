import "server-only";

import {
  isStrategyCurrency,
  STRATEGY_PLATFORM_CATALOG,
  STRATEGY_PLATFORM_IDS,
  type StrategyCurrency,
  type StrategyPlatformId,
} from "@/lib/cross-platform-strategy/catalog";
import {
  normalizeStrategyPerformanceRows,
  readCompleteStrategyPerformanceRows,
} from "@/lib/cross-platform-strategy/performance-data";
import type {
  StrategyAccountInput,
  StrategyPerformanceInput,
  StrategyPlannerContext,
  StrategyPlatformReadiness,
} from "@/lib/cross-platform-strategy/types";
import { STRATEGY_MEASURED_PERFORMANCE_PLATFORMS } from "@/lib/cross-platform-strategy/types";
import { createClient } from "@/lib/supabase/server";

export type StrategyPlannerData = {
  context: StrategyPlannerContext;
  readiness: StrategyPlatformReadiness[];
  suggestedCurrency: StrategyCurrency;
};

type StrategyPlannerDataOptions = {
  now?: Date;
  selectedPlatforms?: readonly StrategyPlatformId[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPerformancePlatform(
  platform: StrategyPlatformId,
): platform is (typeof STRATEGY_MEASURED_PERFORMANCE_PLATFORMS)[number] {
  return platform === "meta";
}

export async function loadStrategyPlannerData(
  userId: string,
  options: StrategyPlannerDataOptions = {},
): Promise<StrategyPlannerData> {
  const now = options.now ?? new Date();
  const selectedPlatforms = new Set(options.selectedPlatforms ?? []);
  const supabase = await createClient();
  const windowStart = new Date(now.getTime() - 29 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const windowEnd = now.toISOString().slice(0, 10);

  const accountResult = await supabase
    .from("platform_accounts")
    .select("id,platform,account_name,connected_at,revoked_at")
    .eq("user_id", userId)
    .in("platform", [...STRATEGY_PLATFORM_IDS])
    .order("connected_at", { ascending: true });

  if (accountResult.error) {
    console.error("cross_platform_strategy_accounts_failed", {
      code: accountResult.error.code,
    });
    throw new Error("Verbundene Werbekonten konnten nicht sicher gelesen werden.");
  }

  const accounts: StrategyAccountInput[] = (accountResult.data ?? [])
    .filter(
      (row) =>
        typeof row.platform === "string" &&
        STRATEGY_PLATFORM_IDS.includes(row.platform as StrategyPlatformId),
    )
    .map((row) => ({
      accountId: String(row.id),
      platform: String(row.platform) as StrategyPlatformId,
      accountName: text(row.account_name) ?? String(row.platform),
      connected: row.revoked_at === null || row.revoked_at === undefined,
    }));

  const connectedByPlatform = new Map<StrategyPlatformId, StrategyAccountInput[]>();
  for (const account of accounts) {
    if (!account.connected) continue;
    const existing = connectedByPlatform.get(account.platform) ?? [];
    existing.push(account);
    connectedByPlatform.set(account.platform, existing);
  }

  // Performance is loaded only for the one unambiguous connected account per
  // platform. Multi-account platforms remain blocked by the planner.
  const scopedAccounts = new Map<string, StrategyPlatformId>();
  for (const [platform, platformAccounts] of connectedByPlatform) {
    if (platformAccounts.length === 1) {
      scopedAccounts.set(platformAccounts[0].accountId, platform);
    }
  }
  const performanceAccountIds = [...scopedAccounts.entries()]
    .filter(
      ([, platform]) =>
        selectedPlatforms.has(platform) && isPerformancePlatform(platform),
    )
    .map(([accountId]) => accountId);

  let performanceReadErrorCode: string | null = null;
  let performance: StrategyPerformanceInput[] = [];
  if (performanceAccountIds.length > 0) {
    const collected = await readCompleteStrategyPerformanceRows(async (from, to) => {
      const pageResult = await supabase
        .from("performance_data")
        .select(
          "id,platform_account_id,platform,entity_type,date,currency,spend,impressions,clicks,inline_link_clicks,conversions,leads,purchases,purchase_value",
          { count: "exact" },
        )
        .eq("user_id", userId)
        .in("platform_account_id", performanceAccountIds)
        .in("platform", [...STRATEGY_MEASURED_PERFORMANCE_PLATFORMS])
        .gte("date", windowStart)
        .lte("date", windowEnd)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      return {
        rows: pageResult.data ?? [],
        count: pageResult.count,
        errorCode: pageResult.error?.code ?? null,
      };
    });

    performanceReadErrorCode = collected.errorCode;
    if (performanceReadErrorCode) {
      console.error("cross_platform_strategy_performance_failed", {
        code: performanceReadErrorCode,
      });
    } else {
      performance = normalizeStrategyPerformanceRows(collected.rows, scopedAccounts);
    }
  }

  const readiness = STRATEGY_PLATFORM_CATALOG.map((profile) => ({
    platform: profile.id,
    name: profile.name,
    description: profile.description,
    integrationStage: profile.integrationStage,
    connectedAccountCount: accounts.filter(
      (account) => account.platform === profile.id && account.connected,
    ).length,
  }));
  const currencies = performance
    .map((row) => row.currency)
    .filter((currency): currency is StrategyCurrency => isStrategyCurrency(currency));
  const uniqueCurrencies = [...new Set(currencies)];

  return {
    context: {
      now,
      accounts,
      performance,
      performanceReadErrorCode,
    },
    readiness,
    suggestedCurrency: uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : "EUR",
  };
}
