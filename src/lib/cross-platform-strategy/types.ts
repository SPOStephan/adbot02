import type {
  StrategyCurrency,
  StrategyObjective,
  StrategyPlatformId,
} from "@/lib/cross-platform-strategy/catalog";

export const CROSS_PLATFORM_STRATEGY_VERSION =
  "adbot-cross-platform-strategy-v1" as const;

export const STRATEGY_MAX_BUDGET_CHANGE_BPS = 2_000 as const;
export const STRATEGY_COOLDOWN_HOURS = 12 as const;
export const STRATEGY_MAX_PLATFORMS = 10 as const;
export const STRATEGY_MIN_SHARE_BPS = 500 as const;
export const STRATEGY_MAX_SHARE_BPS = 6_000 as const;
export const STRATEGY_EXPLORATION_SHARE_BPS = 1_000 as const;
export const STRATEGY_MIN_MEASURED_SPEND_MINOR = 2_000 as const;
export const STRATEGY_MIN_CONVERSIONS = 3 as const;
export const STRATEGY_MAX_DATA_AGE_DAYS = 3 as const;
export const STRATEGY_MEASURED_PERFORMANCE_PLATFORMS = ["meta"] as const;

export type StrategyConfidence = "low" | "medium" | "high";
export type StrategySignalKind =
  | "prior"
  | "awareness_efficiency"
  | "traffic_efficiency"
  | "conversion_efficiency"
  | "revenue_efficiency";

export type StrategyPlannerRequest = {
  objective: StrategyObjective;
  currency: StrategyCurrency;
  dailyBudgetMinor: number;
  selectedPlatforms: StrategyPlatformId[];
};

export type StrategyPlatformReadiness = {
  platform: StrategyPlatformId;
  name: string;
  description: string;
  integrationStage: "live" | "next" | "roadmap";
  connectedAccountCount: number;
};

export type StrategyAccountInput = {
  accountId: string;
  platform: StrategyPlatformId;
  accountName: string;
  connected: boolean;
};

export type StrategyPerformanceInput = {
  accountId: string;
  platform: StrategyPlatformId;
  currency: string;
  spendMinor: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  leads: number | null;
  purchases: number | null;
  conversionValueMinor: number | null;
  latestDataDate: string | null;
};

export type StrategyPlannerContext = {
  now: Date;
  accounts: StrategyAccountInput[];
  performance: StrategyPerformanceInput[];
  performanceReadErrorCode?: string | null;
};

export type StrategyPlatformAllocation = {
  platform: StrategyPlatformId;
  platformName: string;
  accountIds: string[];
  eligible: boolean;
  readiness: "connected" | "not_connected" | "account_selection_required";
  targetDailyBudgetMinor: number;
  shareBps: number;
  signal: StrategySignalKind;
  confidence: StrategyConfidence;
  objectiveAffinity: number;
  performanceScore: number | null;
  score: number;
  exploration: boolean;
  reasons: string[];
  blockers: string[];
};

export type CrossPlatformStrategyPlan = {
  version: typeof CROSS_PLATFORM_STRATEGY_VERSION;
  generatedAt: string;
  objective: StrategyObjective;
  currency: StrategyCurrency;
  requestedDailyBudgetMinor: number;
  targetAllocatedDailyBudgetMinor: number;
  status: "ready" | "blocked" | "partial";
  confidence: StrategyConfidence;
  executionMode: "read_only";
  guardrails: {
    maxBudgetChangeBpsPer24Hours: typeof STRATEGY_MAX_BUDGET_CHANGE_BPS;
    cooldownHours: typeof STRATEGY_COOLDOWN_HOURS;
    requiresFreshReadBeforeWrite: true;
    requiresReadAfterWrite: true;
    providerWritesCreated: false;
  };
  allocations: StrategyPlatformAllocation[];
  reasons: string[];
  blockers: string[];
};
