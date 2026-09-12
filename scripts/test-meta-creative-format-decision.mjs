import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const source = await readFile(join(root, "src/lib/meta/creative-format-decision.ts"), "utf8");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-creative-decision-"));

try {
  const modulePath = join(temporaryDirectory, "creative-format-decision.mjs");
  await writeFile(modulePath, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText, "utf8");
  const decision = await import(pathToFileURL(modulePath).href);

  const dates = [
    "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
    "2026-09-05", "2026-09-06", "2026-09-07",
  ];
  const daily = ({ clicks = 240, impressions = 2_000, spendMinor = 1_000 } = {}) =>
    dates.map((date) => ({ date, impressions, inlineLinkClicks: clicks, spendMinor }));
  const candidate = (overrides = {}) => ({
    adId: "00000000-0000-4000-8000-000000000001",
    platformAdId: "1001",
    adSetId: "00000000-0000-4000-8000-000000000010",
    platformAdSetId: "2001",
    campaignId: "00000000-0000-4000-8000-000000000020",
    platformCampaignId: "3001",
    objective: "OUTCOME_TRAFFIC",
    optimizationGoal: "LINK_CLICKS",
    currency: "EUR",
    sourceSyncId: "00000000-0000-4000-8000-000000000030",
    attributionContract: decision.META_CREATIVE_ATTRIBUTION_CONTRACT,
    assetId: "00000000-0000-4000-8000-000000000040",
    assetSha256: "a".repeat(64),
    formatKey: "square_1_1",
    rows: daily(),
    ...overrides,
  });

  assert.deepEqual(
    decision.decideMetaCreativeOptimization({ candidates: [], matureThrough: "2026-09-10" }),
    { status: "WAIT_FOR_EVIDENCE", reason: "no_active_ads" },
  );
  assert.equal(decision.decideMetaCreativeOptimization({
    candidates: [candidate()], matureThrough: "2026-09-10",
  }).status, "START_TEST");
  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [candidate({ objective: "OUTCOME_SALES" })],
      matureThrough: "2026-09-10",
    }),
    { status: "UNSUPPORTED", reason: "unsupported_objective_or_optimization_goal" },
  );

  const winner = candidate();
  const loser = candidate({
    adId: "00000000-0000-4000-8000-000000000002",
    platformAdId: "1002",
    assetId: "00000000-0000-4000-8000-000000000041",
    assetSha256: "b".repeat(64),
    rows: daily({ clicks: 160, impressions: 1_600, spendMinor: 800 }),
  });

  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [winner, loser], matureThrough: "2026-09-10",
    }),
    { status: "WAIT_FOR_EVIDENCE", reason: "fixed_window_required" },
  );
  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [winner, loser], requiredDates: dates, matureThrough: "2026-09-06",
    }),
    { status: "WAIT_FOR_EVIDENCE", reason: "fixed_window_not_mature" },
  );

  const clear = decision.decideMetaCreativeOptimization({
    candidates: [winner, loser], requiredDates: dates, matureThrough: "2026-09-10",
  });
  assert.equal(clear.status, "PAUSE_LOSER");
  assert.equal(clear.winnerAdId, winner.adId);
  assert.equal(clear.loserAdId, loser.adId);
  assert.equal(clear.evidence.contract, "meta_creative_format_operational_evidence_v2");
  assert.equal(clear.evidence.successKind, "traffic");
  assert.equal(clear.evidence.dailyWins, 7);
  assert.equal(clear.evidence.deliveryAgreement, true);
  assert.deepEqual(clear.evidence.commonDates, dates);
  assert.doesNotMatch(JSON.stringify(clear.evidence), /zScore|oneSidedP|lead|purchase|7d_click|1d_view/);

  const fiveWinRows = daily();
  fiveWinRows[5] = { ...fiveWinRows[5], inlineLinkClicks: 100 };
  fiveWinRows[6] = { ...fiveWinRows[6], inlineLinkClicks: 100 };
  const inconsistent = decision.decideMetaCreativeOptimization({
    candidates: [candidate({ rows: fiveWinRows }), loser],
    requiredDates: dates,
    matureThrough: "2026-09-10",
  });
  assert.equal(inconsistent.status, "COMPLETE_NO_WINNER");
  assert.equal(inconsistent.reason, "no_consistent_lift");
  assert.equal(inconsistent.evidence.dailyWins, 5);

  const imbalanced = decision.decideMetaCreativeOptimization({
    candidates: [winner, candidate({
      ...loser,
      rows: daily({ clicks: 160, impressions: 900, spendMinor: 800 }),
    })],
    requiredDates: dates,
    matureThrough: "2026-09-10",
  });
  assert.equal(imbalanced.status, "COMPLETE_NO_WINNER");
  assert.equal(imbalanced.reason, "imbalanced_delivery");
  assert.equal(imbalanced.evidence.commonDates.length, 7);

  const zeroDelivery = decision.decideMetaCreativeOptimization({
    candidates: [winner, candidate({
      ...loser,
      rows: [],
    })],
    requiredDates: dates,
    matureThrough: "2026-09-10",
  });
  assert.equal(zeroDelivery.status, "COMPLETE_NO_WINNER");
  assert.equal(zeroDelivery.reason, "insufficient_volume");
  assert.equal(zeroDelivery.evidence.loser.impressions, 0);
  assert.equal(zeroDelivery.evidence.loser.rate, 0);

  const noAgreement = decision.decideMetaCreativeOptimization({
    candidates: [
      candidate({ rows: daily({ clicks: 240, impressions: 1_600, spendMinor: 800 }) }),
      candidate({ ...loser, rows: daily({ clicks: 160, impressions: 2_000, spendMinor: 1_000 }) }),
    ],
    requiredDates: dates,
    matureThrough: "2026-09-10",
  });
  assert.equal(noAgreement.status, "COMPLETE_NO_WINNER");
  assert.equal(noAgreement.reason, "no_delivery_agreement");
  assert.equal(noAgreement.evidence.deliveryAgreement, false);

  const incomplete = daily();
  incomplete[3] = { ...incomplete[3], inlineLinkClicks: null };
  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [candidate({ rows: incomplete }), loser],
      requiredDates: dates,
      matureThrough: "2026-09-10",
    }),
    { status: "WAIT_FOR_EVIDENCE", reason: "incomplete_daily_metrics" },
  );
  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [candidate({ rows: [...daily(), daily()[0]] }), loser],
      requiredDates: dates,
      matureThrough: "2026-09-10",
    }),
    { status: "WAIT_FOR_EVIDENCE", reason: "incomplete_daily_metrics" },
  );
  const bothMissingLastDay = decision.decideMetaCreativeOptimization({
    candidates: [
      candidate({ rows: daily().slice(0, 6) }),
      candidate({
        ...loser,
        rows: daily({ clicks: 160, impressions: 1_600, spendMinor: 900 }).slice(0, 6),
      }),
    ],
    requiredDates: dates,
    matureThrough: "2026-09-10",
  });
  assert.equal(bothMissingLastDay.status, "PAUSE_LOSER");
  assert.equal(bothMissingLastDay.evidence.dailyWins, 6);
  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [candidate({ objective: "OUTCOME_SALES" }), loser],
      requiredDates: dates,
      matureThrough: "2026-09-10",
    }),
    { status: "UNSUPPORTED", reason: "unsupported_objective_or_optimization_goal" },
  );
  assert.deepEqual(
    decision.decideMetaCreativeOptimization({
      candidates: [winner, loser, candidate({ adId: "x", platformAdId: "1003" })],
      requiredDates: dates,
      matureThrough: "2026-09-10",
    }),
    { status: "WAIT_FOR_EVIDENCE", reason: "too_many_active_ads" },
  );

  console.log("test-meta-creative-format-decision: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
