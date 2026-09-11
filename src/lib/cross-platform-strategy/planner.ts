import {
  getStrategyPlatformProfile,
  type StrategyObjective,
  type StrategyPlatformId,
} from "@/lib/cross-platform-strategy/catalog";
import {
  CROSS_PLATFORM_STRATEGY_VERSION,
  STRATEGY_COOLDOWN_HOURS,
  STRATEGY_EXPLORATION_SHARE_BPS,
  STRATEGY_MAX_BUDGET_CHANGE_BPS,
  STRATEGY_MAX_DATA_AGE_DAYS,
  STRATEGY_MAX_SHARE_BPS,
  STRATEGY_MIN_CONVERSIONS,
  STRATEGY_MIN_MEASURED_SPEND_MINOR,
  STRATEGY_MIN_SHARE_BPS,
  STRATEGY_MEASURED_PERFORMANCE_PLATFORMS,
  type CrossPlatformStrategyPlan,
  type StrategyConfidence,
  type StrategyPerformanceInput,
  type StrategyPlannerContext,
  type StrategyPlannerRequest,
  type StrategyPlatformAllocation,
  type StrategySignalKind,
} from "@/lib/cross-platform-strategy/types";

type Candidate = {
  platform: StrategyPlatformId;
  accounts: string[];
  readiness: StrategyPlatformAllocation["readiness"];
  blockers: string[];
  reasons: string[];
  eligible: boolean;
  affinity: number;
  metric: number | null;
  signal: StrategySignalKind;
  measured: boolean;
};

const MEASURED_PERFORMANCE_PLATFORMS: readonly StrategyPlatformId[] =
  STRATEGY_MEASURED_PERFORMANCE_PLATFORMS;

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function performanceFor(
  rows: StrategyPerformanceInput[],
  platform: StrategyPlatformId,
  accountId: string,
): StrategyPerformanceInput | null {
  const matches = rows.filter(
    (row) => row.platform === platform && row.accountId === accountId,
  );
  if (matches.length === 0) return null;

  const latest = matches
    .map((row) => row.latestDataDate)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const currencies = new Set(matches.map((row) => row.currency));
  return {
    accountId,
    platform,
    currency: currencies.size === 1 ? matches[0].currency : "MIXED",
    spendMinor: matches.every((row) => row.spendMinor !== null)
      ? sum(matches.map((row) => finiteNonNegative(row.spendMinor)))
      : null,
    impressions: matches.every((row) => row.impressions !== null)
      ? sum(matches.map((row) => finiteNonNegative(row.impressions)))
      : null,
    clicks: matches.every((row) => row.clicks !== null)
      ? sum(matches.map((row) => finiteNonNegative(row.clicks)))
      : null,
    conversions: matches.every((row) => row.conversions !== null)
      ? sum(matches.map((row) => finiteNonNegative(row.conversions)))
      : null,
    leads: matches.every((row) => row.leads !== null)
      ? sum(matches.map((row) => finiteNonNegative(row.leads)))
      : null,
    purchases: matches.every((row) => row.purchases !== null)
      ? sum(matches.map((row) => finiteNonNegative(row.purchases)))
      : null,
    conversionValueMinor: matches.every(
      (row) => row.conversionValueMinor !== null,
    )
      ? sum(matches.map((row) => finiteNonNegative(row.conversionValueMinor)))
      : null,
    latestDataDate: latest,
  };
}

function daysOld(date: string | null, now: Date): number | null {
  if (!date) return null;
  const timestamp = Date.parse(`${date}T23:59:59.999Z`);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

function efficiencyMetric(
  objective: StrategyObjective,
  performance: StrategyPerformanceInput,
): { metric: number | null; signal: StrategySignalKind; reason: string } {
  const spend = performance.spendMinor;
  if (spend === null) {
    return {
      metric: null,
      signal: "prior",
      reason: "Spend-Daten sind teilweise unvollständig; es gilt nur der Ziel-Prior.",
    };
  }
  if (spend < STRATEGY_MIN_MEASURED_SPEND_MINOR) {
    return {
      metric: null,
      signal: "prior",
      reason: "Noch nicht genügend Spend für einen belastbaren Plattformvergleich.",
    };
  }

  if (objective === "awareness") {
    if (performance.impressions === null) {
      return {
        metric: null,
        signal: "prior",
        reason: "Impressionsdaten sind teilweise unvollständig; es gilt nur der Ziel-Prior.",
      };
    }
    if (performance.impressions < 1_000) {
      return {
        metric: null,
        signal: "prior",
        reason: "Noch nicht genügend Impressionen für einen Awareness-Vergleich.",
      };
    }
    return {
      metric: performance.impressions / spend,
      signal: "awareness_efficiency",
      reason: "Gewichtung nutzt Impressionen je eingesetzter Währungseinheit.",
    };
  }

  if (objective === "traffic" || objective === "engagement") {
    if (performance.clicks === null) {
      return {
        metric: null,
        signal: "prior",
        reason: "Klickdaten sind teilweise unvollständig; es gilt nur der Ziel-Prior.",
      };
    }
    if (performance.clicks < 20) {
      return {
        metric: null,
        signal: "prior",
        reason: "Noch nicht genügend Klicks für einen belastbaren Effizienzvergleich.",
      };
    }
    return {
      metric: performance.clicks / spend,
      signal: "traffic_efficiency",
      reason: "Gewichtung nutzt Klicks je eingesetzter Währungseinheit.",
    };
  }

  if (objective === "app_promotion") {
    return {
      metric: null,
      signal: "prior",
      reason: "Ein freigegebenes App-Event-Signal ist noch nicht normalisiert; es gilt nur der Ziel-Prior.",
    };
  }

  if (objective === "sales" && performance.conversionValueMinor !== null && finiteNonNegative(performance.conversionValueMinor) > 0) {
    return {
      metric: finiteNonNegative(performance.conversionValueMinor) / spend,
      signal: "revenue_efficiency",
      reason: "Gewichtung nutzt belegten Conversion-Wert relativ zum Spend.",
    };
  }

  const results =
    objective === "leads"
      ? performance.leads
      : performance.purchases;
  if (results === null) {
    return {
      metric: null,
      signal: "prior",
      reason: "Ergebnisdaten sind teilweise unvollständig; es gilt nur der Ziel-Prior.",
    };
  }
  if (finiteNonNegative(results) < STRATEGY_MIN_CONVERSIONS) {
    return {
      metric: null,
      signal: "prior",
      reason: "Noch nicht genügend bestätigte Ergebnisse für einen Effizienzvergleich.",
    };
  }
  return {
    metric: finiteNonNegative(results) / spend,
    signal: "conversion_efficiency",
    reason: "Gewichtung nutzt bestätigte Ergebnisse je eingesetzter Währungseinheit.",
  };
}

function normalizePerformanceScores(candidates: Candidate[]): Map<StrategyPlatformId, number> {
  const measured = candidates.filter(
    (candidate): candidate is Candidate & { metric: number } =>
      candidate.eligible && candidate.metric !== null,
  );
  const result = new Map<StrategyPlatformId, number>();
  if (measured.length === 0) return result;
  if (measured.length === 1) {
    result.set(measured[0].platform, 65);
    return result;
  }

  const minimum = Math.min(...measured.map((candidate) => candidate.metric));
  const maximum = Math.max(...measured.map((candidate) => candidate.metric));
  for (const candidate of measured) {
    const score =
      maximum === minimum
        ? 68
        : 35 + ((candidate.metric - minimum) / (maximum - minimum)) * 65;
    result.set(candidate.platform, Math.round(score));
  }
  return result;
}

function allocateShares(
  weighted: Array<{
    platform: StrategyPlatformId;
    weight: number;
    minimumShareBps: number;
  }>,
): Map<StrategyPlatformId, number> {
  const shares = new Map<StrategyPlatformId, number>();
  if (weighted.length === 0) return shares;
  if (weighted.length === 1) {
    shares.set(weighted[0].platform, 10_000);
    return shares;
  }

  const maxShare = STRATEGY_MAX_SHARE_BPS;
  const capacity = new Map<StrategyPlatformId, number>();
  for (const item of weighted) {
    shares.set(item.platform, item.minimumShareBps);
    capacity.set(item.platform, maxShare - item.minimumShareBps);
  }

  let remaining =
    10_000 - sum(weighted.map((item) => item.minimumShareBps));
  while (remaining > 0) {
    const active = weighted.filter((item) => (capacity.get(item.platform) ?? 0) > 0);
    if (active.length === 0) break;
    const totalWeight = sum(active.map((item) => Math.max(1, item.weight)));
    const proposals = active.map((item) => {
      const exact = (remaining * Math.max(1, item.weight)) / totalWeight;
      const available = capacity.get(item.platform) ?? 0;
      return {
        ...item,
        exact,
        add: Math.min(available, Math.floor(exact)),
      };
    });
    let assigned = sum(proposals.map((item) => item.add));

    if (assigned === 0) {
      const winner = [...proposals].sort(
        (left, right) =>
          right.exact - Math.floor(right.exact) -
            (left.exact - Math.floor(left.exact)) ||
          left.platform.localeCompare(right.platform),
      )[0];
      winner.add = 1;
      assigned = 1;
    }

    for (const proposal of proposals) {
      if (proposal.add <= 0) continue;
      shares.set(
        proposal.platform,
        (shares.get(proposal.platform) ?? 0) + proposal.add,
      );
      capacity.set(
        proposal.platform,
        (capacity.get(proposal.platform) ?? 0) - proposal.add,
      );
    }
    remaining -= assigned;
  }

  if (remaining !== 0) {
    throw new Error("Die Plattformanteile konnten nicht exakt verteilt werden.");
  }
  return shares;
}

function allocateMinorUnits(
  totalMinor: number,
  shares: Map<StrategyPlatformId, number>,
): Map<StrategyPlatformId, number> {
  const rows = [...shares.entries()].map(([platform, shareBps]) => {
    const exact = (totalMinor * shareBps) / 10_000;
    return { platform, exact, amount: Math.floor(exact) };
  });
  let remainder = totalMinor - sum(rows.map((row) => row.amount));
  for (const row of [...rows].sort(
    (left, right) =>
      right.exact - Math.floor(right.exact) -
        (left.exact - Math.floor(left.exact)) ||
      left.platform.localeCompare(right.platform),
  )) {
    if (remainder <= 0) break;
    row.amount += 1;
    remainder -= 1;
  }
  return new Map(rows.map((row) => [row.platform, row.amount]));
}

function confidenceFor(
  eligibleCount: number,
  measuredCount: number,
  hasReadError: boolean,
): StrategyConfidence {
  if (hasReadError || measuredCount === 0) return "low";
  if (measuredCount >= 2 && measuredCount === eligibleCount) return "high";
  return "medium";
}

export function createCrossPlatformStrategyPlan(
  request: StrategyPlannerRequest,
  context: StrategyPlannerContext,
): CrossPlatformStrategyPlan {
  if (!Number.isSafeInteger(request.dailyBudgetMinor) || request.dailyBudgetMinor <= 0) {
    throw new Error("Das Tagesbudget muss als positive Minor-Unit vorliegen.");
  }
  if (request.selectedPlatforms.length < 1 || request.selectedPlatforms.length > 10) {
    throw new Error("Der Strategieplan benötigt eine bis zehn Plattformen.");
  }

  const candidates: Candidate[] = request.selectedPlatforms.map((platform) => {
    const profile = getStrategyPlatformProfile(platform);
    const accountIds = context.accounts
      .filter((account) => account.platform === platform && account.connected)
      .map((account) => account.accountId);
    const blockers: string[] = [];
    const reasons: string[] = [];
    const readiness =
      accountIds.length === 0
        ? "not_connected"
        : accountIds.length > 1
          ? "account_selection_required"
          : "connected";

    if (!profile.supportedObjectives.includes(request.objective)) {
      blockers.push("Das gewählte Werbeziel ist für diese Plattform nicht freigegeben.");
    }
    if (readiness === "not_connected") {
      blockers.push("Für diese Plattform ist noch kein Werbekonto verbunden.");
    }
    if (readiness === "account_selection_required") {
      blockers.push("Mehrere Werbekonten sind verbunden; vor einer Allokation ist eine Kontoauswahl nötig.");
    }
    const measuredPerformanceAllowed =
      MEASURED_PERFORMANCE_PLATFORMS.includes(platform);
    const performance =
      readiness === "connected" && measuredPerformanceAllowed
        ? performanceFor(context.performance, platform, accountIds[0])
        : null;
    if (
      performance &&
      performance.currency !== request.currency
    ) {
      blockers.push("Die Performancewährung stimmt nicht mit der Planwährung überein.");
    }

    let metric: number | null = null;
    let signal: StrategySignalKind = "prior";
    if (blockers.length === 0 && !measuredPerformanceAllowed) {
      reasons.push(
        "Der Provider besitzt noch keinen freigegebenen Vollständigkeitsvertrag; es gilt nur der Ziel-Prior.",
      );
    } else if (performance && blockers.length === 0) {
      const age = daysOld(performance.latestDataDate, context.now);
      if (age === null || age > STRATEGY_MAX_DATA_AGE_DAYS) {
        reasons.push("Performance-Daten sind nicht aktuell genug; es gilt nur der Ziel-Prior.");
      } else {
        const measured = efficiencyMetric(request.objective, performance);
        metric = measured.metric;
        signal = measured.signal;
        reasons.push(measured.reason);
      }
    } else if (!performance) {
      reasons.push("Noch keine normalisierten Performance-Daten; Startgewicht nach Ziel-Fit.");
    }

    return {
      platform,
      accounts: accountIds,
      readiness,
      blockers,
      reasons,
      eligible: blockers.length === 0,
      affinity: profile.objectiveAffinity[request.objective],
      metric,
      signal,
      measured: metric !== null,
    };
  });

  const performanceScores = normalizePerformanceScores(candidates);
  const weighted = candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => {
      const performanceScore = performanceScores.get(candidate.platform);
      return {
        platform: candidate.platform,
        minimumShareBps:
          performanceScore === undefined
            ? STRATEGY_EXPLORATION_SHARE_BPS
            : STRATEGY_MIN_SHARE_BPS,
        weight:
          performanceScore === undefined
            ? candidate.affinity
            : Math.round(candidate.affinity * 0.35 + performanceScore * 0.65),
      };
    });
  const shares = allocateShares(weighted);
  const targetAmounts = allocateMinorUnits(request.dailyBudgetMinor, shares);

  const allocations: StrategyPlatformAllocation[] = candidates.map((candidate) => {
    const profile = getStrategyPlatformProfile(candidate.platform);
    const shareBps = shares.get(candidate.platform) ?? 0;
    const target = targetAmounts.get(candidate.platform) ?? 0;
    const performanceScore = performanceScores.get(candidate.platform) ?? null;
    const score =
      performanceScore === null
        ? candidate.affinity
        : Math.round(candidate.affinity * 0.35 + performanceScore * 0.65);
    const reasons = [...candidate.reasons];
    if (candidate.eligible && candidate.metric === null) {
      reasons.push("Der Anteil ist als kontrollierte Exploration gekennzeichnet.");
    }

    return {
      platform: candidate.platform,
      platformName: profile.name,
      accountIds: candidate.accounts,
      eligible: candidate.eligible,
      readiness: candidate.readiness,
      targetDailyBudgetMinor: target,
      shareBps,
      signal: candidate.signal,
      confidence:
        performanceScore === null ? "low" : performanceScores.size >= 2 ? "high" : "medium",
      objectiveAffinity: candidate.affinity,
      performanceScore,
      score,
      exploration: candidate.eligible && candidate.metric === null,
      reasons,
      blockers: candidate.blockers,
    };
  });

  const eligibleAllocations = allocations.filter((allocation) => allocation.eligible);
  const targetAllocated = sum(
    eligibleAllocations.map((allocation) => allocation.targetDailyBudgetMinor),
  );
  const blocked = allocations.filter((allocation) => !allocation.eligible);
  const measuredCount = candidates.filter(
    (candidate) => candidate.eligible && candidate.measured,
  ).length;
  const confidence = confidenceFor(
    eligibleAllocations.length,
    measuredCount,
    Boolean(context.performanceReadErrorCode),
  );
  const blockers = blocked.flatMap((allocation) =>
    allocation.blockers.map((blocker) => `${allocation.platformName}: ${blocker}`),
  );
  const reasons = [
    "Der Zielmix wird exakt auf das bestätigte Gesamt-Tagesbudget verteilt.",
    "Nicht ausreichend gemessene Plattformen werden über transparente Ziel-Priors exploriert.",
    "Diese Version erzeugt weder Provider-Writes noch Mutationspläne.",
  ];
  if (context.performanceReadErrorCode) {
    reasons.push(
      `Performance-Daten konnten nicht vollständig gelesen werden (${context.performanceReadErrorCode}); der Plan nutzt konservative Priors.`,
    );
  }

  return {
    version: CROSS_PLATFORM_STRATEGY_VERSION,
    generatedAt: context.now.toISOString(),
    objective: request.objective,
    currency: request.currency,
    requestedDailyBudgetMinor: request.dailyBudgetMinor,
    targetAllocatedDailyBudgetMinor: targetAllocated,
    status:
      eligibleAllocations.length === 0
        ? "blocked"
        : blocked.length > 0 || Boolean(context.performanceReadErrorCode)
          ? "partial"
          : "ready",
    confidence,
    executionMode: "read_only",
    guardrails: {
      maxBudgetChangeBpsPer24Hours: STRATEGY_MAX_BUDGET_CHANGE_BPS,
      cooldownHours: STRATEGY_COOLDOWN_HOURS,
      requiresFreshReadBeforeWrite: true,
      requiresReadAfterWrite: true,
      providerWritesCreated: false,
    },
    allocations,
    reasons,
    blockers,
  };
}
