import "server-only";

import {
  EMPTY_AD_LEARNING_CONTEXT,
  type AdLearningContext,
  type CustomerCreativeSignal,
  type InspirationPattern,
  type TrainingGroundSignal,
} from "@/lib/ad-learning/types";
import {
  customerSignalFromAsset,
  inspirationPatternFromMetadata,
  scoreInspirationMatch,
  scoreTrainingGroundMatch,
} from "@/lib/ad-learning/context";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoadAdLearningContextInput = {
  userId: string;
  platformAccountId?: string;
  platform?: string;
  objective?: string;
  industry?: string;
  landingHostname?: string;
  inspirationLimit?: number;
  customerLimit?: number;
  trainingLimit?: number;
};

function mapObjective(value?: string): string | undefined {
  if (!value) return undefined;
  if (value === "OUTCOME_LEADS" || value === "leads") return "leads";
  if (value === "OUTCOME_TRAFFIC" || value === "traffic") return "traffic";
  return value;
}

async function loadInspirationPatterns(input: {
  platform?: string;
  objective?: string;
  industry?: string;
  limit: number;
}): Promise<InspirationPattern[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select("id,library_scope,metadata,updated_at")
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->>library", "eq", "ad_example_library")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data)) return [];

  const scored = data
    .map((row) => {
      const pattern = inspirationPatternFromMetadata({
        brandAssetId: String(row.id),
        libraryScope: String(row.library_scope ?? ""),
        metadata: row.metadata,
      });
      if (!pattern) return null;
      return {
        pattern,
        score: scoreInspirationMatch(pattern, {
          platform: input.platform,
          objective: input.objective,
          industry: input.industry,
        }),
      };
    })
    .filter((item): item is { pattern: InspirationPattern; score: number } =>
      Boolean(item),
    )
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, input.limit).map((item) => item.pattern);
}

async function loadCustomerSignals(input: {
  userId: string;
  platformAccountId?: string;
  limit: number;
}): Promise<CustomerCreativeSignal[]> {
  const admin = createAdminClient();
  let query = admin
    .from("brand_assets")
    .select("id,user_id,library_scope,training_status,original_filename,updated_at")
    .eq("library_scope", "CUSTOMER")
    .eq("user_id", input.userId)
    .eq("status", "READY")
    .eq("moderation_status", "APPROVED")
    .in("training_status", ["marked_good", "performance_winner"])
    .order("updated_at", { ascending: false })
    .limit(40);
  if (input.platformAccountId) {
    query = query.eq("platform_account_id", input.platformAccountId);
  }
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];

  const signals: CustomerCreativeSignal[] = [];
  for (const row of data) {
    const signal = customerSignalFromAsset({
      brandAssetId: String(row.id),
      libraryScope: String(row.library_scope ?? ""),
      userId: input.userId,
      ownerUserId: String(row.user_id ?? ""),
      trainingStatus: String(row.training_status ?? "none"),
      originalFilename:
        typeof row.original_filename === "string" ? row.original_filename : null,
    });
    if (!signal) continue;
    signals.push(signal);
    if (signals.length >= input.limit) break;
  }
  return signals;
}

async function loadTrainingGroundSignals(input: {
  platform?: string;
  objective?: string;
  industry?: string;
  landingHostname?: string;
  limit: number;
}): Promise<TrainingGroundSignal[]> {
  if (input.limit < 1) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("adbot_training_runs")
    .select(
      "id,platform,objective,industry,landing_hostname,headline,primary_text,verdict,verdict_note,rated_at",
    )
    .in("verdict", ["keep", "reject"])
    .order("rated_at", { ascending: false })
    .limit(80);
  if (error || !Array.isArray(data)) return [];

  return data
    .map((row) => {
      const verdict = row.verdict === "reject" ? "reject" : row.verdict === "keep" ? "keep" : null;
      if (!verdict) return null;
      const signal: TrainingGroundSignal = {
        runId: String(row.id),
        verdict,
        platform: String(row.platform ?? "other"),
        objective: String(row.objective ?? "other"),
        industry: String(row.industry ?? ""),
        landingHostname: String(row.landing_hostname ?? ""),
        headline: String(row.headline ?? ""),
        primaryText: String(row.primary_text ?? ""),
        note: String(row.verdict_note ?? ""),
      };
      return {
        signal,
        score: scoreTrainingGroundMatch(signal, {
          platform: input.platform,
          objective: input.objective,
          industry: input.industry,
          landingHostname: input.landingHostname,
        }),
      };
    })
    .filter((item): item is { signal: TrainingGroundSignal; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((item) => item.signal);
}

export async function loadInspirationLearningPreview(input: {
  platform?: string;
  objective?: string;
  industry?: string;
  limit?: number;
}): Promise<InspirationPattern[]> {
  return loadInspirationPatterns({
    platform: input.platform,
    objective: mapObjective(input.objective),
    industry: input.industry,
    limit: Math.min(Math.max(input.limit ?? 8, 0), 8),
  });
}

export async function loadAdLearningContext(
  input: LoadAdLearningContextInput,
): Promise<AdLearningContext> {
  const inspirationLimit = Math.min(Math.max(input.inspirationLimit ?? 5, 0), 8);
  const customerLimit = Math.min(Math.max(input.customerLimit ?? 5, 0), 8);
  const trainingLimit = Math.min(Math.max(input.trainingLimit ?? 6, 0), 8);
  try {
    const [inspirationPatterns, customerSignals, trainingSignals] = await Promise.all([
      loadInspirationPatterns({
        platform: input.platform,
        objective: mapObjective(input.objective),
        industry: input.industry,
        limit: inspirationLimit,
      }),
      loadCustomerSignals({
        userId: input.userId,
        platformAccountId: input.platformAccountId,
        limit: customerLimit,
      }),
      loadTrainingGroundSignals({
        platform: input.platform,
        objective: mapObjective(input.objective),
        industry: input.industry,
        landingHostname: input.landingHostname,
        limit: trainingLimit,
      }),
    ]);
    return { inspirationPatterns, customerSignals, trainingSignals };
  } catch (error) {
    console.error("ad_learning_context_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return EMPTY_AD_LEARNING_CONTEXT;
  }
}

export async function loadCustomerWinnerAssetIds(input: {
  userId: string;
  platformAccountId: string;
  limit?: number;
}): Promise<string[]> {
  const context = await loadAdLearningContext({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
    inspirationLimit: 0,
    customerLimit: input.limit ?? 4,
  });
  return context.customerSignals
    .filter((item) => item.trainingStatus === "performance_winner")
    .map((item) => item.brandAssetId)
    .concat(
      context.customerSignals
        .filter((item) => item.trainingStatus === "marked_good")
        .map((item) => item.brandAssetId),
    );
}
