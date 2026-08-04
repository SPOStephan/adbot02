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
  getMetaAdCreatives,
  getMetaAdInsights,
  getMetaAds,
  getMetaAdSets,
  getMetaCampaigns,
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

export async function getMetaAdCreatives() {
  return {
    items: [{
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
    }],
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
          campaigns_count: 1,
          ad_sets_count: 1,
          ads_count: 1,
          creatives_count: 1,
          insights_count: 2,
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

  globalThis.__marketingSyncTest = { rpcCalls: [] };
  const marketingModule = await import(pathToFileURL(modulePath).href);
  const result = await marketingModule.syncMetaMarketingSnapshot({
    platformAccountId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    adAccountId: "act_123",
    accessToken: "test-user-token",
    appSecret: "test-app-secret",
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.equal(result.insightsCount, 2);
  assert.deepEqual(result.campaignBudgetSharingSnapshot, [{
    platform_campaign_id: "campaign-1",
    is_adset_budget_sharing_enabled: false,
  }]);
  assert.equal(globalThis.__marketingSyncTest.rpcCalls.length, 1);
  const call = globalThis.__marketingSyncTest.rpcCalls[0];
  assert.equal(call.name, "replace_meta_marketing_snapshot");
  assert.equal(
    call.args.p_campaigns[0].is_adset_budget_sharing_enabled,
    false,
  );
  assert.equal(call.args.p_insights.length, 2);
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

  assert.deepEqual(
    marketingModule.classifyMetaInsightSnapshot({
      ads: [{ id: "ad-1" }],
      insights: [
        {
          adId: "ad-1",
          dateStart: "2026-07-27",
          dateStop: "2026-07-27",
        },
        {
          adId: "historical-ad",
          dateStart: "2026-07-28",
          dateStop: "2026-07-29",
        },
        {
          adId: "ad-1",
          dateStart: "2026-06-01",
          dateStop: "2026-06-01",
        },
      ],
      since: "2026-06-21",
      until: "2026-07-28",
    }),
    {
      missingAdReferences: 1,
      nonDailyRows: 1,
      outOfRangeRows: 1,
    },
  );

  console.log("Meta Marketing snapshot payload tests passed.");
} finally {
  delete globalThis.__marketingSyncTest;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
