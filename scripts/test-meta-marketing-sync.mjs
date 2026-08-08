import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-meta-marketing-sync-"),
);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const emptyUsage = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
  adAccountPercent: null,
  insightsPercent: null,
  retryAfterSeconds: null,
};

try {
  const sourcePath = join(projectRoot, "src/lib/meta/marketing-sync.ts");
  const source = (await readFile(sourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace(
      /import \{\n  getMetaAdAccountSummary,[\s\S]*?\n\} from "\.\/client";/,
      `import {
  getMetaAdAccountSummary,
  getMetaAccountInsights,
  getMetaAdCreatives,
  getMetaAdInsights,
  getMetaAds,
  getMetaAdsByIds,
  getMetaAdSets,
  getMetaAdSetsByIds,
  getMetaCampaignInsights,
  getMetaCampaigns,
  getMetaCampaignsByIds,
  mergeMetaUsage,
  normalizeMetaAdAccountId,
} from "./client.mjs";`,
    )
    .replace('from "../supabase/admin";', 'from "./admin.mjs";');

  const clientStub = `
const usage = ${JSON.stringify(emptyUsage)};

export function normalizeMetaAdAccountId(value) {
  const normalized = String(value).trim();
  return normalized.startsWith("act_") ? normalized : \`act_\${normalized}\`;
}

export function mergeMetaUsage(left, right) {
  return {
    appPercent: left.appPercent ?? right.appPercent,
    pagePercent: left.pagePercent ?? right.pagePercent,
    businessPercent: left.businessPercent ?? right.businessPercent,
    adAccountPercent: left.adAccountPercent ?? right.adAccountPercent,
    insightsPercent: left.insightsPercent ?? right.insightsPercent,
    retryAfterSeconds: left.retryAfterSeconds ?? right.retryAfterSeconds,
  };
}

export async function getMetaAdAccountSummary() {
  return {
    account: {
      id: "123",
      name: "Test Ad Account",
      currency: "EUR",
      timezoneName: "UTC",
      timezoneOffsetHoursUtc: 0,
      accountStatus: 1,
    },
    usage,
  };
}

export async function getMetaCampaigns() {
  return {
    items: [{
      id: "campaign-1",
      accountId: "123",
      name: "Campaign 1",
      objective: "OUTCOME_TRAFFIC",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      dailyBudgetMinor: null,
      lifetimeBudgetMinor: null,
      budgetRemainingMinor: null,
      spendCapMinor: null,
      bidStrategy: null,
      isAdSetBudgetSharingEnabled: false,
      specialAdCategories: [],
      startTime: null,
      stopTime: null,
      createdTime: null,
      updatedTime: null,
    }],
    usage,
  };
}

export async function getMetaAdSets() {
  return {
    items: [{
      id: "ad-set-1",
      campaignId: "campaign-1",
      accountId: "123",
      name: "Ad Set 1",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      optimizationGoal: "LINK_CLICKS",
      billingEvent: "IMPRESSIONS",
      destinationType: "WEBSITE",
      dailyBudgetMinor: null,
      lifetimeBudgetMinor: null,
      budgetRemainingMinor: null,
      bidAmountMinor: null,
      bidStrategy: null,
      startTime: null,
      endTime: null,
      createdTime: null,
      updatedTime: null,
    }],
    usage,
  };
}

export async function getMetaAds() {
  return {
    items: [{
      id: "ad-1",
      campaignId: "campaign-1",
      adSetId: "ad-set-1",
      creativeId: "creative-1",
      accountId: "123",
      name: "Ad 1",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      createdTime: null,
      updatedTime: null,
    }],
    usage,
  };
}

export async function getMetaAdsByIds({ adIds }) {
  globalThis.__marketingSyncTest.historicalRequests.ads.push([...adIds]);
  return {
    items: (
      globalThis.__marketingSyncTest.resolveHistoricalAds &&
      adIds.includes("historical-ad")
    ) ? [{
      id: "historical-ad",
      campaignId: "historical-campaign",
      adSetId: "historical-ad-set",
      creativeId: "historical-creative",
      accountId: "123",
      name: "Historical Ad",
      status: "ARCHIVED",
      effectiveStatus: "ARCHIVED",
      createdTime: null,
      updatedTime: null,
    }] : [],
    usage,
  };
}

export async function getMetaAdSetsByIds({ adSetIds }) {
  globalThis.__marketingSyncTest.historicalRequests.adSets.push([...adSetIds]);
  return {
    items: adSetIds.includes("historical-ad-set") ? [{
      id: "historical-ad-set",
      campaignId: "historical-campaign",
      accountId: "123",
      name: "Historical Ad Set",
      status: "ARCHIVED",
      effectiveStatus: "ARCHIVED",
      optimizationGoal: "LINK_CLICKS",
      billingEvent: "IMPRESSIONS",
      destinationType: "WEBSITE",
      dailyBudgetMinor: null,
      lifetimeBudgetMinor: null,
      budgetRemainingMinor: null,
      bidAmountMinor: null,
      bidStrategy: null,
      startTime: null,
      endTime: null,
      createdTime: null,
      updatedTime: null,
    }] : [],
    usage,
  };
}

export async function getMetaCampaignsByIds({ campaignIds }) {
  globalThis.__marketingSyncTest.historicalRequests.campaigns.push([...campaignIds]);
  return {
    items: campaignIds.includes("historical-campaign") ? [{
      id: "historical-campaign",
      accountId: "123",
      name: "Historical Campaign",
      objective: "OUTCOME_TRAFFIC",
      status: "ARCHIVED",
      effectiveStatus: "ARCHIVED",
      dailyBudgetMinor: null,
      lifetimeBudgetMinor: null,
      budgetRemainingMinor: null,
      spendCapMinor: null,
      bidStrategy: null,
      isAdSetBudgetSharingEnabled: null,
      specialAdCategories: [],
      startTime: null,
      stopTime: null,
      createdTime: null,
      updatedTime: null,
    }] : [],
    usage,
  };
}

export async function getMetaAdCreatives({ creativeIds }) {
  globalThis.__marketingSyncTest.creativeRequests.push([...creativeIds]);
  return {
    items: [
      {
        id: "creative-1",
        accountId: "123",
        name: "Creative 1",
        title: null,
        body: null,
        callToActionType: null,
        thumbnailUrl: null,
        effectiveObjectStoryId: null,
        effectiveInstagramMediaId: null,
        instagramPermalinkUrl: null,
        objectType: null,
        status: "ACTIVE",
      },
      {
        id: "historical-creative",
        accountId: "123",
        name: "Historical Creative",
        title: null,
        body: null,
        callToActionType: null,
        thumbnailUrl: null,
        effectiveObjectStoryId: null,
        effectiveInstagramMediaId: null,
        instagramPermalinkUrl: null,
        objectType: null,
        status: "ARCHIVED",
      },
    ].filter((creative) => creativeIds.includes(creative.id)),
    usage,
  };
}

export async function getMetaAdInsights() {
  const base = {
    campaignId: "campaign-1",
    campaignName: "Campaign 1",
    adSetId: "ad-set-1",
    adSetName: "Ad Set 1",
    adId: "ad-1",
    adName: "Ad 1",
    accountId: "123",
    impressions: "1000",
    reach: "800",
    frequency: "1.25",
    clicks: "40",
    inlineLinkClicks: "30",
    spend: "25.50",
    cpm: "25.50",
    cpc: "0.64",
    ctr: "4.0",
    attributionSetting: "7d_click",
  };

  return {
    items: [
      {
        ...base,
        dateStart: "2026-07-27",
        dateStop: "2026-07-27",
        actions: [
          { actionType: "link_click", value: "30" },
          { actionType: "purchase", value: "2" },
        ],
        actionValues: [{ actionType: "purchase", value: "149.90" }],
        costPerActionType: [{ actionType: "purchase", value: "12.75" }],
      },
      {
        ...base,
        dateStart: "2026-07-28",
        dateStop: "2026-07-28",
        actions: [],
        actionValues: [],
        costPerActionType: [],
      },
      {
        ...base,
        campaignId: "historical-campaign",
        campaignName: "Historical Campaign",
        adSetId: "historical-ad-set",
        adSetName: "Historical Ad Set",
        adId: "historical-ad",
        adName: "Historical Ad",
        dateStart: "2026-07-28",
        dateStop: "2026-07-28",
        actions: [],
        actionValues: [],
        costPerActionType: [],
      },
    ],
    usage,
  };
}

export async function getMetaCampaignInsights() {
  return {
    items: [
      {
        accountId: "123",
        campaignId: "campaign-1",
        campaignName: "Campaign 1",
        dateStart: "2026-07-27",
        dateStop: "2026-07-27",
        impressions: "1000",
        spend: "25.50",
      },
      {
        accountId: "123",
        campaignId: "campaign-1",
        campaignName: "Campaign 1",
        dateStart: "2026-07-28",
        dateStop: "2026-07-28",
        impressions: "1000",
        spend: "25.50",
      },
      {
        accountId: "123",
        campaignId: "historical-campaign",
        campaignName: "Historical Campaign",
        dateStart: "2026-07-28",
        dateStop: "2026-07-28",
        impressions: "1000",
        spend: "25.50",
      },
    ],
    usage,
  };
}

export async function getMetaAccountInsights() {
  return {
    items: [
      {
        accountId: "123",
        dateStart: "2026-07-27",
        dateStop: "2026-07-27",
        impressions: "1000",
        spend: "25.50",
      },
      {
        accountId: "123",
        dateStart: "2026-07-28",
        dateStop: "2026-07-28",
        impressions: "2000",
        spend: "51.00",
      },
      {
        accountId: "123",
        dateStart: "2026-07-29",
        dateStop: "2026-07-29",
        impressions: "100",
        spend: "5.00",
      },
    ],
    usage,
  };
}
`;

  const adminStub = `
export function createAdminClient() {
  return {
    async rpc(name, args) {
      globalThis.__marketingSyncTest.rpcCalls.push({ name, args });
      return {
        data: [{
          campaigns_count: 2,
          ad_sets_count: 2,
          ads_count: 2,
          creatives_count: 2,
          insights_count: 3,
          recommendations_count: 0,
        }],
        error: null,
      };
    },
  };
}
`;

  await writeFile(join(temporaryDirectory, "client.mjs"), clientStub, "utf8");
  await writeFile(join(temporaryDirectory, "admin.mjs"), adminStub, "utf8");
  const modulePath = join(temporaryDirectory, "marketing-sync.mjs");
  await writeFile(modulePath, transpile(source), "utf8");

  globalThis.__marketingSyncTest = {
    rpcCalls: [],
    historicalRequests: { ads: [], adSets: [], campaigns: [] },
    creativeRequests: [],
    resolveHistoricalAds: true,
  };
  const marketingModule = await import(pathToFileURL(modulePath).href);
  const result = await marketingModule.syncMetaMarketingSnapshot({
    platformAccountId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    adAccountId: "act_123",
    accessToken: "test-user-token",
    appSecret: "test-app-secret",
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.equal(result.campaignsCount, 2);
  assert.equal(result.adSetsCount, 2);
  assert.equal(result.adsCount, 2);
  assert.equal(result.creativesCount, 2);
  assert.equal(result.insightsCount, 3);
  assert.equal(result.insightsUntil, "2026-07-29");
  assert.equal(result.insightsSince, "2026-06-23");
  assert.ok(result.spendTotal > 0);
  assert.deepEqual(result.campaignBudgetSharingSnapshot, [
    {
      platform_campaign_id: "campaign-1",
      is_adset_budget_sharing_enabled: false,
    },
    {
      platform_campaign_id: "historical-campaign",
      is_adset_budget_sharing_enabled: null,
    },
  ]);
  assert.deepEqual(globalThis.__marketingSyncTest.historicalRequests, {
    ads: [["historical-ad"]],
    adSets: [["historical-ad-set"]],
    campaigns: [["historical-campaign"]],
  });
  assert.deepEqual(globalThis.__marketingSyncTest.creativeRequests, [[
    "creative-1",
    "historical-creative",
  ]]);
  assert.equal(globalThis.__marketingSyncTest.rpcCalls.length, 2);
  const call = globalThis.__marketingSyncTest.rpcCalls[0];
  assert.equal(call.name, "replace_meta_marketing_snapshot");
  const spendCall = globalThis.__marketingSyncTest.rpcCalls[1];
  assert.equal(spendCall.name, "apply_meta_campaign_insight_spend");
  assert.equal(spendCall.args.p_account_spend_total, 81.5);
  assert.equal(spendCall.args.p_account_spend_today, 5);
  assert.ok(Array.isArray(spendCall.args.p_campaign_insights));
  assert.equal(spendCall.args.p_campaign_insights.length, 3);
  assert.equal(
    call.args.p_campaigns[0].is_adset_budget_sharing_enabled,
    false,
  );
  assert.equal(call.args.p_campaigns.length, 2);
  assert.equal(call.args.p_ad_sets.length, 2);
  assert.equal(call.args.p_ads.length, 2);
  assert.equal(call.args.p_creatives.length, 2);
  assert.equal(call.args.p_insights.length, 3);
  assert.equal(call.args.p_insights_until, "2026-07-29");
  assert.equal(call.args.p_insights_since, "2026-06-23");
  assert.equal(call.args.p_ads[1].platform_ad_id, "historical-ad");
  assert.equal(
    call.args.p_ads[1].platform_ad_set_id,
    "historical-ad-set",
  );
  assert.equal(
    call.args.p_ads[1].platform_campaign_id,
    "historical-campaign",
  );
  assert.deepEqual(call.args.p_insights[0].actions, {
    link_click: "30",
    purchase: "2",
  });
  assert.deepEqual(call.args.p_insights[0].action_values, {
    purchase: "149.90",
  });
  assert.deepEqual(call.args.p_insights[0].cost_per_action_type, {
    purchase: "12.75",
  });
  assert.deepEqual(call.args.p_insights[1].actions, {});
  assert.deepEqual(call.args.p_insights[1].action_values, {});
  assert.deepEqual(call.args.p_insights[1].cost_per_action_type, {});
  assert.equal(Array.isArray(call.args.p_insights[0].actions), false);
  assert.doesNotMatch(JSON.stringify(call.args), /test-user-token|test-app-secret/);

  const diagnostic = marketingModule.classifyMetaInsightSnapshot({
      ads: [{
        id: "ad-1",
        campaignId: "campaign-1",
        adSetId: "ad-set-1",
      }],
      insights: [
        {
          adId: "ad-1",
          campaignId: "wrong-campaign",
          adSetId: "ad-set-1",
          dateStart: "2026-07-27",
          dateStop: "2026-07-27",
        },
        {
          adId: "historical-ad",
          campaignId: "historical-campaign",
          adSetId: "historical-ad-set",
          dateStart: "2026-07-28",
          dateStop: "2026-07-29",
        },
        {
          adId: "ad-1",
          campaignId: "campaign-1",
          adSetId: "ad-set-1",
          dateStart: "2026-06-01",
          dateStop: "2026-06-01",
        },
      ],
      since: "2026-06-21",
      until: "2026-07-28",
    });
  assert.deepEqual(diagnostic, {
    missingAdReferences: 1,
    parentMismatches: 1,
    nonDailyRows: 1,
    outOfRangeRows: 1,
  });

  globalThis.__marketingSyncTest.resolveHistoricalAds = false;
  const persistedRpcCount = globalThis.__marketingSyncTest.rpcCalls.length;
  const creativeRequestCount =
    globalThis.__marketingSyncTest.creativeRequests.length;

  await assert.rejects(
    marketingModule.syncMetaMarketingSnapshot({
      platformAccountId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      adAccountId: "act_123",
      accessToken: "test-user-token",
      appSecret: "test-app-secret",
      now: new Date("2026-07-29T12:00:00.000Z"),
    }),
    (error) => (
      error instanceof marketingModule.MetaMarketingDataError &&
      error.code === "invalid_hierarchy"
    ),
  );
  assert.equal(
    globalThis.__marketingSyncTest.rpcCalls.length,
    persistedRpcCount,
  );
  assert.equal(
    globalThis.__marketingSyncTest.creativeRequests.length,
    creativeRequestCount,
  );

  console.log("Meta Marketing snapshot payload tests passed.");
} finally {
  delete globalThis.__marketingSyncTest;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
