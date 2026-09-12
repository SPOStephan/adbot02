export const META_CREATIVE_DECISION_CONTRACT =
  "meta_creative_format_operational_evidence_v2" as const;
export const META_CREATIVE_ATTRIBUTION_CONTRACT =
  "link_ctr:daily:v1" as const;

export const META_CREATIVE_FIXED_TEST_DAYS = 7;
export const META_CREATIVE_MIN_IMPRESSIONS = 1_000;
export const META_CREATIVE_MIN_SPEND_MINOR = 5_000;
export const META_CREATIVE_MIN_TRAFFIC_CLICKS = 100;
export const META_CREATIVE_MIN_DELIVERY_BALANCE = 0.5;
export const META_CREATIVE_MIN_RELATIVE_LIFT = 0.1;
export const META_CREATIVE_MIN_DAILY_WINS = 6;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type MetaCreativeDailyEvidence = {
  date: string;
  impressions: number | null;
  inlineLinkClicks: number | null;
  spendMinor: number | null;
};

export type MetaCreativeCandidateEvidence = {
  adId: string;
  platformAdId: string;
  adSetId: string;
  platformAdSetId: string;
  campaignId: string;
  platformCampaignId: string;
  objective: string;
  optimizationGoal: string | null;
  currency: string;
  sourceSyncId: string;
  attributionContract: string;
  assetId: string | null;
  assetSha256: string | null;
  formatKey: string | null;
  rows: MetaCreativeDailyEvidence[];
};

export type MetaCreativeCandidateSummary = {
  adId: string;
  platformAdId: string;
  assetId: string | null;
  assetSha256: string | null;
  formatKey: string | null;
  impressions: number;
  inlineLinkClicks: number;
  spendMinor: number;
  primaryResults: number;
  trials: number;
  successes: number;
  rate: number;
  daily: Array<{
    date: string;
    impressions: number;
    inlineLinkClicks: number;
    spendMinor: number;
  }>;
};

export type MetaCreativeDecisionEvidence = {
  contract: typeof META_CREATIVE_DECISION_CONTRACT;
  attributionContract: typeof META_CREATIVE_ATTRIBUTION_CONTRACT;
  successKind: "traffic";
  commonDates: string[];
  sourceSyncId: string;
  currency: string;
  adSetId: string;
  platformAdSetId: string;
  campaignId: string;
  platformCampaignId: string;
  objective: string;
  optimizationGoal: "LINK_CLICKS";
  winner: MetaCreativeCandidateSummary;
  loser: MetaCreativeCandidateSummary;
  relativeLift: number | null;
  dailyWins: number;
  deliveryAgreement: boolean;
  thresholds: {
    fixedTestDays: number;
    impressions: number;
    spendMinor: number;
    trafficClicks: number;
    minDeliveryBalance: number;
    relativeLift: number;
    dailyWins: number;
  };
};

export type MetaCreativeOptimizationDecision =
  | {
      status: "START_TEST";
      reason: "single_active_ad";
      baselineAdId: string;
      platformAdSetId: string;
    }
  | {
      status: "PAUSE_LOSER";
      reason: "fixed_window_operational_dominance";
      winnerAdId: string;
      loserAdId: string;
      evidence: MetaCreativeDecisionEvidence;
    }
  | {
      status: "COMPLETE_NO_WINNER";
      reason:
        | "insufficient_volume"
        | "imbalanced_delivery"
        | "no_delivery_agreement"
        | "no_consistent_lift";
      evidence: MetaCreativeDecisionEvidence;
    }
  | {
      status: "WAIT_FOR_EVIDENCE";
      reason:
        | "no_active_ads"
        | "too_many_active_ads"
        | "fixed_window_required"
        | "fixed_window_not_mature"
        | "incompatible_candidates"
        | "incomplete_daily_metrics";
    }
  | {
      status: "UNSUPPORTED";
      reason: "unsupported_objective_or_optimization_goal";
    };

function supportedTrafficCandidate(candidate: MetaCreativeCandidateEvidence): boolean {
  return (
    candidate.objective === "OUTCOME_TRAFFIC"
    || candidate.objective === "LINK_CLICKS"
  ) && candidate.optimizationGoal === "LINK_CLICKS";
}

function finiteNonNegative(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function compareCandidates(
  left: MetaCreativeCandidateEvidence,
  right: MetaCreativeCandidateEvidence,
): boolean {
  return left.adSetId === right.adSetId
    && left.platformAdSetId === right.platformAdSetId
    && left.campaignId === right.campaignId
    && left.platformCampaignId === right.platformCampaignId
    && left.objective === right.objective
    && left.optimizationGoal === right.optimizationGoal
    && left.currency === right.currency
    && left.sourceSyncId === right.sourceSyncId
    && left.attributionContract === META_CREATIVE_ATTRIBUTION_CONTRACT
    && right.attributionContract === META_CREATIVE_ATTRIBUTION_CONTRACT;
}

function validFixedDates(value: readonly string[] | undefined): value is string[] {
  if (!value || value.length !== META_CREATIVE_FIXED_TEST_DAYS) return false;
  if (new Set(value).size !== value.length) return false;
  if (value.some((date) => !ISO_DATE_PATTERN.test(date))) return false;
  const sorted = [...value].sort();
  if (sorted.some((date, index) => date !== value[index])) return false;
  for (let index = 1; index < value.length; index += 1) {
    const previous = new Date(`${value[index - 1]}T12:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() + 1);
    if (previous.toISOString().slice(0, 10) !== value[index]) return false;
  }
  return true;
}

function summarizeCandidate(
  candidate: MetaCreativeCandidateEvidence,
  dates: readonly string[],
): MetaCreativeCandidateSummary | null {
  const byDate = new Map(candidate.rows.map((row) => [row.date, row]));
  if (byDate.size !== candidate.rows.length) return null;
  let impressions = 0;
  let inlineLinkClicks = 0;
  let spendMinor = 0;
  const daily: MetaCreativeCandidateSummary["daily"] = [];

  for (const date of dates) {
    const row = byDate.get(date) ?? {
      date,
      impressions: 0,
      inlineLinkClicks: 0,
      spendMinor: 0,
    };
    if (
      !row
      || !finiteNonNegative(row.impressions)
      || !finiteNonNegative(row.inlineLinkClicks)
      || !finiteNonNegative(row.spendMinor)
      || row.inlineLinkClicks > row.impressions
    ) return null;
    impressions += row.impressions;
    inlineLinkClicks += row.inlineLinkClicks;
    spendMinor += row.spendMinor;
    daily.push({
      date,
      impressions: row.impressions,
      inlineLinkClicks: row.inlineLinkClicks,
      spendMinor: row.spendMinor,
    });
  }
  return {
    adId: candidate.adId,
    platformAdId: candidate.platformAdId,
    assetId: candidate.assetId,
    assetSha256: candidate.assetSha256,
    formatKey: candidate.formatKey,
    impressions,
    inlineLinkClicks,
    spendMinor,
    primaryResults: inlineLinkClicks,
    trials: impressions,
    successes: inlineLinkClicks,
    rate: impressions > 0 ? inlineLinkClicks / impressions : 0,
    daily,
  };
}

function volumeSufficient(summary: MetaCreativeCandidateSummary): boolean {
  return summary.impressions >= META_CREATIVE_MIN_IMPRESSIONS
    && summary.spendMinor >= META_CREATIVE_MIN_SPEND_MINOR
    && summary.inlineLinkClicks >= META_CREATIVE_MIN_TRAFFIC_CLICKS;
}

export function decideMetaCreativeOptimization(input: {
  candidates: MetaCreativeCandidateEvidence[];
  requiredDates?: string[];
  matureThrough: string;
}): MetaCreativeOptimizationDecision {
  if (input.candidates.length === 0) {
    return { status: "WAIT_FOR_EVIDENCE", reason: "no_active_ads" };
  }
  if (input.candidates.some((candidate) => !supportedTrafficCandidate(candidate))) {
    return {
      status: "UNSUPPORTED",
      reason: "unsupported_objective_or_optimization_goal",
    };
  }
  if (input.candidates.length === 1) {
    return {
      status: "START_TEST",
      reason: "single_active_ad",
      baselineAdId: input.candidates[0].adId,
      platformAdSetId: input.candidates[0].platformAdSetId,
    };
  }
  if (input.candidates.length !== 2) {
    return { status: "WAIT_FOR_EVIDENCE", reason: "too_many_active_ads" };
  }
  if (!compareCandidates(input.candidates[0], input.candidates[1])) {
    return { status: "WAIT_FOR_EVIDENCE", reason: "incompatible_candidates" };
  }
  if (!validFixedDates(input.requiredDates)) {
    return { status: "WAIT_FOR_EVIDENCE", reason: "fixed_window_required" };
  }
  if (input.requiredDates.at(-1)! > input.matureThrough) {
    return { status: "WAIT_FOR_EVIDENCE", reason: "fixed_window_not_mature" };
  }

  const left = summarizeCandidate(input.candidates[0], input.requiredDates);
  const right = summarizeCandidate(input.candidates[1], input.requiredDates);
  if (!left || !right) {
    return { status: "WAIT_FOR_EVIDENCE", reason: "incomplete_daily_metrics" };
  }

  const ranked = [left, right].sort((a, b) =>
    b.rate - a.rate || a.platformAdId.localeCompare(b.platformAdId));
  const winner = ranked[0];
  const loser = ranked[1];
  const impressionBalance = Math.min(winner.impressions, loser.impressions)
    / Math.max(winner.impressions, loser.impressions);
  const spendBalance = Math.min(winner.spendMinor, loser.spendMinor)
    / Math.max(winner.spendMinor, loser.spendMinor);
  const deliveryAgreement = winner.impressions >= loser.impressions
    && winner.spendMinor >= loser.spendMinor;
  const relativeLift = loser.rate === 0
    ? null
    : winner.rate / loser.rate - 1;
  const dailyWins = winner.daily.filter((winnerDay, index) => {
    const loserDay = loser.daily[index];
    if (!loserDay || winnerDay.impressions <= 0 || loserDay.impressions <= 0) return false;
    return winnerDay.inlineLinkClicks / winnerDay.impressions
      > loserDay.inlineLinkClicks / loserDay.impressions;
  }).length;
  const first = input.candidates[0];
  const evidence: MetaCreativeDecisionEvidence = {
    contract: META_CREATIVE_DECISION_CONTRACT,
    attributionContract: META_CREATIVE_ATTRIBUTION_CONTRACT,
    successKind: "traffic",
    commonDates: [...input.requiredDates],
    sourceSyncId: first.sourceSyncId,
    currency: first.currency,
    adSetId: first.adSetId,
    platformAdSetId: first.platformAdSetId,
    campaignId: first.campaignId,
    platformCampaignId: first.platformCampaignId,
    objective: first.objective,
    optimizationGoal: "LINK_CLICKS",
    winner,
    loser,
    relativeLift,
    dailyWins,
    deliveryAgreement,
    thresholds: {
      fixedTestDays: META_CREATIVE_FIXED_TEST_DAYS,
      impressions: META_CREATIVE_MIN_IMPRESSIONS,
      spendMinor: META_CREATIVE_MIN_SPEND_MINOR,
      trafficClicks: META_CREATIVE_MIN_TRAFFIC_CLICKS,
      minDeliveryBalance: META_CREATIVE_MIN_DELIVERY_BALANCE,
      relativeLift: META_CREATIVE_MIN_RELATIVE_LIFT,
      dailyWins: META_CREATIVE_MIN_DAILY_WINS,
    },
  };

  if (!volumeSufficient(left) || !volumeSufficient(right)) {
    return { status: "COMPLETE_NO_WINNER", reason: "insufficient_volume", evidence };
  }
  if (
    impressionBalance < META_CREATIVE_MIN_DELIVERY_BALANCE
    || spendBalance < META_CREATIVE_MIN_DELIVERY_BALANCE
  ) {
    return { status: "COMPLETE_NO_WINNER", reason: "imbalanced_delivery", evidence };
  }
  if (!deliveryAgreement) {
    return { status: "COMPLETE_NO_WINNER", reason: "no_delivery_agreement", evidence };
  }
  if (
    relativeLift === null
    || relativeLift < META_CREATIVE_MIN_RELATIVE_LIFT
    || dailyWins < META_CREATIVE_MIN_DAILY_WINS
  ) {
    return { status: "COMPLETE_NO_WINNER", reason: "no_consistent_lift", evidence };
  }

  return {
    status: "PAUSE_LOSER",
    reason: "fixed_window_operational_dominance",
    winnerAdId: winner.adId,
    loserAdId: loser.adId,
    evidence,
  };

}
