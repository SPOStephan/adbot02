/**
 * Relative success ranking for ABO sibling ad-set budget reallocation.
 * Never stops campaigns for low volume; prefers best / least-bad only.
 */

export type ObjectiveSuccessKind =
  | "traffic"
  | "leads"
  | "sales"
  | "unsupported";

export type SiblingAdSetMetrics = {
  adGroupId: string;
  /** Meta ad-set id — used for pure-tie stable order. */
  platformAdGroupId: string;
  spend: number;
  /** Traffic: inline_link_clicks; Leads: leads; Sales: purchases. */
  primaryResults: number;
};

export type RankedSiblingAdSet = SiblingAdSetMetrics & {
  /** 0-based; 0 = best (highest primary / least-bad). */
  rankIndex: number;
  /** Lower is better when primaryResults > 0; null when incomparable. */
  tieBreakCost: number | null;
};

export type SiblingReallocationProposal = {
  winnerAdGroupId: string;
  loserAdGroupId: string;
  winnerPlatformAdGroupId: string;
  loserPlatformAdGroupId: string;
  changeBps: number;
  deltaMinor: number;
  winnerBudgetBefore: number;
  loserBudgetBefore: number;
  winnerBudgetAfter: number;
  loserBudgetAfter: number;
  sumBefore: number;
  sumAfter: number;
};

export function objectiveSuccessKind(objective: string): ObjectiveSuccessKind {
  const normalized = objective.trim().toUpperCase();
  if (
    normalized === "OUTCOME_TRAFFIC" ||
    normalized === "LINK_CLICKS" ||
    normalized === "TRAFFIC"
  ) {
    return "traffic";
  }
  if (
    normalized === "OUTCOME_LEADS" ||
    normalized === "LEAD_GENERATION" ||
    normalized === "LEADS"
  ) {
    return "leads";
  }
  if (
    normalized === "OUTCOME_SALES" ||
    normalized === "CONVERSIONS" ||
    normalized === "SALES"
  ) {
    return "sales";
  }
  return "unsupported";
}

function tieBreakCost(spend: number, primaryResults: number): number | null {
  if (primaryResults > 0 && Number.isFinite(spend)) {
    return spend / primaryResults;
  }
  return null;
}

/**
 * Relative ranking only: higher primary results win; among equals, lower
 * CPC/CPL (spend/results) wins. Zero primary with spend > 0 ranks worse than
 * any entity with results. Pure ties keep stable order by platform ad-group id.
 * No hard min-volume gates.
 */
export function rankSiblingAdSets(
  siblings: readonly SiblingAdSetMetrics[],
): RankedSiblingAdSet[] {
  const decorated = siblings.map((sibling) => {
    const primary = Number(sibling.primaryResults);
    const spend = Number(sibling.spend);
    const hasResults = primary > 0;
    const zeroSpendBurn = !hasResults && spend > 0;
    return {
      ...sibling,
      primaryResults: primary,
      spend,
      hasResults,
      zeroSpendBurn,
      tieBreakCost: tieBreakCost(spend, primary),
    };
  });

  decorated.sort((a, b) => {
    // Entities with results always beat zero-result entities.
    if (a.hasResults !== b.hasResults) {
      return a.hasResults ? -1 : 1;
    }
    if (a.hasResults && b.hasResults) {
      if (a.primaryResults !== b.primaryResults) {
        return b.primaryResults - a.primaryResults;
      }
      const costA = a.tieBreakCost ?? Number.POSITIVE_INFINITY;
      const costB = b.tieBreakCost ?? Number.POSITIVE_INFINITY;
      if (costA !== costB) {
        return costA - costB;
      }
    } else {
      // Both have zero primary: spend>0 is worse (least-bad prefers no burn).
      if (a.zeroSpendBurn !== b.zeroSpendBurn) {
        return a.zeroSpendBurn ? 1 : -1;
      }
      if (a.zeroSpendBurn && b.zeroSpendBurn && a.spend !== b.spend) {
        return a.spend - b.spend;
      }
    }
    return a.platformAdGroupId.localeCompare(b.platformAdGroupId);
  });

  return decorated.map((item, rankIndex) => ({
    adGroupId: item.adGroupId,
    platformAdGroupId: item.platformAdGroupId,
    spend: item.spend,
    primaryResults: item.primaryResults,
    rankIndex,
    tieBreakCost: item.tieBreakCost,
  }));
}

/**
 * Propose transferring up to `changeBps` of the loser's daily budget to the
 * winner. Sibling ABO sum stays constant. Skips when ranks are equal (no
 * distinguishable winner/loser) or delta < 1 minor unit.
 */
export function proposeSiblingReallocation(input: {
  ranked: readonly RankedSiblingAdSet[];
  budgetsByAdGroupId: Readonly<Record<string, number>>;
  changeBps?: number;
}): SiblingReallocationProposal | null {
  const changeBps = input.changeBps ?? 1000;
  if (
    !Number.isInteger(changeBps) ||
    changeBps <= 0 ||
    changeBps > 10000 ||
    input.ranked.length < 2
  ) {
    return null;
  }

  const winner = input.ranked[0];
  const loser = input.ranked[input.ranked.length - 1];
  if (!winner || !loser || winner.adGroupId === loser.adGroupId) {
    return null;
  }

  // Ranks equal when relative sort keys cannot distinguish winner vs loser
  // (pure ties only differ by stable meta id ordering).
  const ranksEqual =
    winner.primaryResults === loser.primaryResults &&
    winner.tieBreakCost === loser.tieBreakCost &&
    winner.spend === loser.spend;

  if (ranksEqual) {
    return null;
  }

  const winnerBudgetBefore = input.budgetsByAdGroupId[winner.adGroupId];
  const loserBudgetBefore = input.budgetsByAdGroupId[loser.adGroupId];
  if (
    !Number.isSafeInteger(winnerBudgetBefore) ||
    !Number.isSafeInteger(loserBudgetBefore) ||
    winnerBudgetBefore <= 0 ||
    loserBudgetBefore <= 0
  ) {
    return null;
  }

  const deltaMinor = Math.floor((loserBudgetBefore * changeBps) / 10000);
  if (deltaMinor < 1) {
    return null;
  }

  const winnerBudgetAfter = winnerBudgetBefore + deltaMinor;
  const loserBudgetAfter = loserBudgetBefore - deltaMinor;
  if (loserBudgetAfter <= 0) {
    return null;
  }

  const sumBefore = winnerBudgetBefore + loserBudgetBefore;
  const sumAfter = winnerBudgetAfter + loserBudgetAfter;
  if (sumBefore !== sumAfter) {
    throw new Error(
      "proposeSiblingReallocation: sibling ABO budget sum must stay constant",
    );
  }

  return {
    winnerAdGroupId: winner.adGroupId,
    loserAdGroupId: loser.adGroupId,
    winnerPlatformAdGroupId: winner.platformAdGroupId,
    loserPlatformAdGroupId: loser.platformAdGroupId,
    changeBps,
    deltaMinor,
    winnerBudgetBefore,
    loserBudgetBefore,
    winnerBudgetAfter,
    loserBudgetAfter,
    sumBefore,
    sumAfter,
  };
}
