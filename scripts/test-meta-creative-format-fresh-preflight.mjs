import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourcePath = join(
  root,
  "src/lib/meta/creative-format-fresh-preflight.ts",
);
const original = await readFile(sourcePath, "utf8");
const source = original
  .replace('import "server-only";\n\n', "")
  .replace(
    /import \{[\s\S]*?\} from "@\/lib\/meta\/write-client";\n/,
    "const getMetaAdSetAdsSnapshot = async () => { throw new Error('not used'); };\nconst getMetaWriteObjectSnapshot = async () => { throw new Error('not used'); };\n",
  );
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-creative-fresh-"));

try {
  const modulePath = join(temporaryDirectory, "fresh-preflight.mjs");
  await writeFile(modulePath, ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText, "utf8");
  const fresh = await import(pathToFileURL(modulePath).href);

  const ids = {
    account: "123456789",
    sync: "39000000-0000-4000-8000-000000000001",
    campaign: "900000001",
    adSet: "900000002",
    baseline: "900000003",
    winner: "900000003",
    loser: "900000004",
    newAd: "900000005",
    creative: "900000006",
  };
  const base = (overrides = {}) => ({
    plannedPayload: {
      contract: "meta_existing_adset_creative_test_v1",
      platform_campaign_id: ids.campaign,
      platform_ad_set_id: ids.adSet,
      baseline_platform_ad_id: ids.baseline,
      meta_ad_account_id: ids.account,
      source_marketing_sync_id: ids.sync,
      max_active_ads: 3,
    },
    expectedBefore: {
      campaign_daily_budget_minor: null,
      campaign_lifetime_budget_minor: null,
      ad_set_daily_budget_minor: 10_000,
      ad_set_lifetime_budget_minor: null,
    },
    operation: "CREATE_CREATIVE",
    objectType: "CREATIVE",
    plannedRequest: {},
    bindings: [],
    currentAdAccountId: ids.account,
    currentMarketingSyncId: ids.sync,
    currentTime: "2026-09-12T10:00:00.000Z",
    campaign: {
      id: ids.campaign,
      account_id: ids.account,
      status: "ACTIVE",
      effective_status: "ACTIVE",
      daily_budget: null,
      lifetime_budget: null,
    },
    adSet: {
      id: ids.adSet,
      account_id: ids.account,
      campaign_id: ids.campaign,
      status: "ACTIVE",
      effective_status: "ACTIVE",
      daily_budget: "10000",
      lifetime_budget: null,
    },
    ads: [{
      id: ids.baseline,
      account_id: ids.account,
      adset_id: ids.adSet,
      status: "ACTIVE",
      effective_status: "ACTIVE",
      creative: { id: "800000001" },
    }],
    ...overrides,
  });

  assert.equal(fresh.needsMetaCreativeFreshPreflight({
    plannedPayload: base().plannedPayload,
    operation: "CREATE_CREATIVE",
    objectType: "CREATIVE",
    stepOperation: "VALIDATE",
  }), false);
  assert.equal(fresh.needsMetaCreativeFreshPreflight({
    plannedPayload: base().plannedPayload,
    operation: "UPLOAD_IMAGE",
    objectType: "IMAGE",
    stepOperation: "CREATE",
  }), true);
  assert.equal(fresh.needsMetaCreativeFreshPreflight({
    plannedPayload: base().plannedPayload,
    operation: "CREATE_CREATIVE",
    objectType: "CREATIVE",
    stepOperation: "CREATE",
  }), true);
  assert.doesNotThrow(() => fresh.validateMetaCreativeFreshState(base()));

  assert.throws(
    () => fresh.validateMetaCreativeFreshState(base({ currentAdAccountId: "999999999" })),
    (error) => error.code === "selected_ad_account_changed",
  );
  assert.throws(
    () => fresh.validateMetaCreativeFreshState(base({ currentMarketingSyncId: "changed" })),
    (error) => error.code === "source_marketing_sync_changed",
  );
  assert.throws(
    () => fresh.validateMetaCreativeFreshState(base({
      campaign: { ...base().campaign, account_id: "999999999" },
    })),
    (error) => error.code === "remote_ad_account_mismatch",
  );

  assert.throws(
    () => fresh.validateMetaCreativeFreshState(base({
      adSet: { ...base().adSet, daily_budget: "11000" },
    })),
    (error) => error.code === "parent_budget_changed",
  );
  assert.throws(
    () => fresh.validateMetaCreativeFreshState(base({
      campaign: { ...base().campaign, effective_status: "PAUSED" },
    })),
    (error) => error.code === "campaign_not_active",
  );
  assert.throws(
    () => fresh.validateMetaCreativeFreshState(base({
      ads: [
        ...base().ads,
        { id: "10", account_id: ids.account, adset_id: ids.adSet, effective_status: "ACTIVE" },
        { id: "11", account_id: ids.account, adset_id: ids.adSet, effective_status: "PENDING_REVIEW" },
      ],
    })),
    (error) => error.code === "single_active_baseline_required",
  );

  const activation = base({
    operation: "UPDATE_STATUS",
    objectType: "AD",
    bindings: [
      { stepId: "a", objectType: "CREATIVE", remoteObjectId: ids.creative },
      { stepId: "b", objectType: "AD", remoteObjectId: ids.newAd },
    ],
    ads: [
      ...base().ads,
      {
        id: ids.newAd,
        account_id: ids.account,
        adset_id: ids.adSet,
        status: "PAUSED",
        effective_status: "PAUSED",
        creative: { id: ids.creative },
      },
    ],
  });
  assert.doesNotThrow(() => fresh.validateMetaCreativeFreshState(activation));
  assert.throws(
    () => fresh.validateMetaCreativeFreshState({
      ...activation,
      ads: activation.ads.map((ad) => ad.id === ids.newAd
        ? { ...ad, creative: { id: "999999999" } }
        : ad),
    }),
    (error) => error.code === "new_ad_shadow_mismatch",
  );

  assert.equal(fresh.needsMetaCreativeFreshPreflight({
    plannedPayload: base().plannedPayload,
    operation: "READ",
    objectType: "AD",
    stepOperation: "READ",
    plannedRequest: { expected_status: "ACTIVE" },
  }), true);
  const activeReadback = {
    ...activation,
    operation: "READ",
    plannedRequest: { expected_status: "ACTIVE" },
    ads: activation.ads.map((ad) => ad.id === ids.newAd
      ? { ...ad, status: "ACTIVE", effective_status: "ACTIVE" }
      : ad),
  };
  assert.doesNotThrow(() => fresh.validateMetaCreativeFreshState(activeReadback));
  assert.throws(
    () => fresh.validateMetaCreativeFreshState({
      ...activeReadback,
      ads: [
        ...activeReadback.ads,
        {
          id: "900000099",
          account_id: ids.account,
          adset_id: ids.adSet,
          status: "ACTIVE",
          effective_status: "ACTIVE",
          creative: { id: "800000099" },
        },
      ],
    }),
    (error) => error.code === "single_active_baseline_required",
  );

  const pause = base({
    plannedPayload: {
      contract: "meta_creative_evidence_pause_v1",
      platform_campaign_id: ids.campaign,
      platform_ad_set_id: ids.adSet,
      baseline_platform_ad_id: ids.winner,
      winner_platform_ad_id: ids.winner,
      loser_platform_ad_id: ids.loser,
      meta_ad_account_id: ids.account,
      source_marketing_sync_id: ids.sync,
      evidence_valid_until: "2026-09-12T10:10:00.000Z",
    },
    operation: "UPDATE_STATUS",
    objectType: "AD",
    ads: [
      ...base().ads,
      {
        id: ids.loser,
        account_id: ids.account,
        adset_id: ids.adSet,
        status: "ACTIVE",
        effective_status: "ACTIVE",
        creative: { id: "800000002" },
      },
    ],
  });
  assert.doesNotThrow(() => fresh.validateMetaCreativeFreshState(pause));
  assert.throws(
    () => fresh.validateMetaCreativeFreshState({
      ...pause,
      ads: [
        ...pause.ads,
        {
          id: "900000007",
          account_id: ids.account,
          adset_id: ids.adSet,
          status: "ACTIVE",
          effective_status: "ACTIVE",
          creative: { id: "800000003" },
        },
      ],
    }),
    (error) => error.code === "comparison_cardinality_changed",
  );
  assert.throws(
    () => fresh.validateMetaCreativeFreshState({
      ...pause,
      ads: pause.ads.map((ad) => ad.id === ids.loser
        ? { ...ad, effective_status: "PAUSED" }
        : ad),
    }),
    (error) => error.code === "comparison_ads_not_active",
  );
  assert.throws(
    () => fresh.validateMetaCreativeFreshState({
      ...pause,
      currentTime: "2026-09-12T10:10:00.001Z",
    }),
    (error) => error.code === "creative_evidence_expired",
  );

  assert.doesNotThrow(() => fresh.validateMetaCreativeFreshState({
    ...base(),
    plannedPayload: { contract: "other_feature" },
  }));

  console.log("test-meta-creative-format-fresh-preflight: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
