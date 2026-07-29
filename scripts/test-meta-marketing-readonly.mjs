import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const clientSourcePath = join(projectRoot, "src/lib/meta/client.ts");
const cryptoSourcePath = join(projectRoot, "src/lib/meta/crypto.ts");

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-marketing-"));
const originalFetch = globalThis.fetch;

try {
  const cryptoSource = (await readFile(cryptoSourcePath, "utf8")).replace(
    'import "server-only";',
    "",
  );
  const clientSource = (await readFile(clientSourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace('from "./crypto";', 'from "./crypto.mjs";');

  assert.doesNotMatch(clientSource, /ads_management/);
  assert.match(clientSource, /method:\s*"GET"/);
  assert.doesNotMatch(clientSource, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);

  const cryptoModulePath = join(temporaryDirectory, "crypto.mjs");
  const clientModulePath = join(temporaryDirectory, "client.mjs");
  await writeFile(cryptoModulePath, transpile(cryptoSource), "utf8");
  await writeFile(clientModulePath, transpile(clientSource), "utf8");

  const client = await import(pathToFileURL(clientModulePath).href);
  const requests = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      id: "act_123456789",
      name: "Staging Werbekonto",
      currency: "eur",
      timezone_name: "Europe/Berlin",
      timezone_offset_hours_utc: 2,
      account_status: 1,
    }, {
      "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 17 }),
    });
  };

  const accountResult = await client.getMetaAdAccountSummary({
    adAccountId: "123456789",
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });

  assert.deepEqual(accountResult.account, {
    id: "123456789",
    name: "Staging Werbekonto",
    currency: "EUR",
    timezoneName: "Europe/Berlin",
    timezoneOffsetHoursUtc: 2,
    accountStatus: 1,
  });
  assert.equal(accountResult.usage.adAccountPercent, 17);
  assert.equal(requests[0].url.pathname, "/v25.0/act_123456789");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.headers.Authorization, "Bearer read-only-token");
  assert.ok(requests[0].url.searchParams.get("appsecret_proof"));

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.searchParams.get("after") === "page-2") {
      return jsonResponse({
        data: [{
          id: "2",
          account_id: "123456789",
          name: "Retargeting",
          objective: "OUTCOME_SALES",
          status: "PAUSED",
          effective_status: "PAUSED",
          special_ad_categories: [],
          created_time: "2026-07-02T10:00:00+0000",
          updated_time: "2026-07-03T10:00:00+0000",
        }],
      });
    }

    return jsonResponse({
      data: [{
        id: "1",
        account_id: "act_123456789",
        name: "Prospecting",
        objective: "OUTCOME_LEADS",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        daily_budget: "2500",
        budget_remaining: "1250",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        special_ad_categories: ["NONE", "NONE"],
        start_time: "2026-07-01T10:00:00+0000",
        created_time: "2026-07-01T09:00:00+0000",
        updated_time: "2026-07-03T09:00:00+0000",
      }],
      paging: {
        next: "https://graph.facebook.com/v25.0/act_123456789/campaigns?after=page-2&access_token=must-not-survive",
      },
    });
  };

  const campaignsResult = await client.getMetaCampaigns({
    adAccountId: "act_123456789",
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });

  assert.equal(campaignsResult.items.length, 2);
  assert.equal(campaignsResult.items[0].dailyBudgetMinor, "2500");
  assert.deepEqual(campaignsResult.items[0].specialAdCategories, ["NONE"]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ init }) => init.method === "GET"));
  assert.equal(requests[1].url.searchParams.get("access_token"), null);
  assert.ok(requests[1].url.searchParams.get("appsecret_proof"));

  globalThis.fetch = async () => jsonResponse({
    data: [{ id: "1", name: "Valid" }],
    paging: { next: "https://attacker.example/v25.0/leak" },
  });

  await assert.rejects(
    client.getMetaCampaigns({
      adAccountId: "act_123456789",
      accessToken: "read-only-token",
      appSecret: "test-secret",
    }),
    (error) =>
      error instanceof client.MetaCollectionLimitError &&
      error.reason === "pagination",
  );

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      data: [{
        id: "11",
        account_id: "123456789",
        campaign_id: "1",
        name: "Broad",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        optimization_goal: "LEAD_GENERATION",
        billing_event: "IMPRESSIONS",
        destination_type: "WEBSITE",
        daily_budget: "1500",
        bid_amount: "250",
        start_time: "2026-07-01T10:00:00+0000",
        created_time: "2026-07-01T09:00:00+0000",
        updated_time: "2026-07-04T09:00:00+0000",
      }],
    });
  };

  const adSetsResult = await client.getMetaAdSets({
    adAccountId: "act_123456789",
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });
  assert.equal(adSetsResult.items[0].campaignId, "1");
  assert.equal(adSetsResult.items[0].optimizationGoal, "LEAD_GENERATION");
  assert.equal(adSetsResult.items[0].bidAmountMinor, "250");

  globalThis.fetch = async () => jsonResponse({
    data: [{
      id: "111",
      account_id: "123456789",
      campaign_id: "1",
      adset_id: "11",
      creative: { id: "999" },
      name: "Image Ad",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      created_time: "2026-07-01T09:00:00+0000",
      updated_time: "2026-07-04T09:00:00+0000",
    }],
  });

  const adsResult = await client.getMetaAds({
    adAccountId: "act_123456789",
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });
  assert.equal(adsResult.items[0].adSetId, "11");
  assert.equal(adsResult.items[0].creativeId, "999");

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      "999": {
        id: "999",
        account_id: "123456789",
        name: "Creative",
        title: "Headline",
        body: "Primary text",
        call_to_action_type: "LEARN_MORE",
        thumbnail_url: "https://cdn.example.test/creative.jpg",
        effective_object_story_id: "123_456",
        instagram_permalink_url: "javascript:alert(1)",
        object_type: "SHARE",
        status: "ACTIVE",
      },
    });
  };

  const creativesResult = await client.getMetaAdCreatives({
    creativeIds: ["999", "999", "invalid"],
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });
  assert.equal(creativesResult.items.length, 1);
  assert.equal(creativesResult.items[0].thumbnailUrl, "https://cdn.example.test/creative.jpg");
  assert.equal(creativesResult.items[0].instagramPermalinkUrl, null);
  assert.equal(requests[0].url.pathname, "/v25.0/");
  assert.equal(requests[0].url.searchParams.get("ids"), "999");
  assert.equal(requests[0].url.searchParams.get("thumbnail_width"), "640");
  assert.equal(requests[0].init.method, "GET");

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      data: [{
        account_id: "123456789",
        campaign_id: "1",
        campaign_name: "Prospecting",
        adset_id: "11",
        adset_name: "Broad",
        ad_id: "111",
        ad_name: "Image Ad",
        date_start: "2026-07-01",
        date_stop: "2026-07-01",
        impressions: "1000",
        reach: "800",
        frequency: "1.25",
        clicks: "40",
        inline_link_clicks: "30",
        spend: "25.50",
        cpm: "25.5",
        cpc: "0.6375",
        ctr: "4.0",
        actions: [
          { action_type: "lead", value: "5" },
          { action_type: "link_click", value: "30" },
          { action_type: "lead", value: "5" },
          { action_type: "invalid", value: "-1" },
        ],
        action_values: [{ action_type: "purchase", value: "123.45" }],
        cost_per_action_type: [{ action_type: "lead", value: "5.10" }],
        attribution_setting: "7D_CLICK_1D_VIEW",
      }],
    }, {
      "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 44 }),
      "x-fb-ads-insights-throttle": JSON.stringify({
        app_id_util_pct: 55,
        acc_id_util_pct: 33,
      }),
    });
  };

  const insightsResult = await client.getMetaAdInsights({
    adAccountId: "act_123456789",
    accessToken: "read-only-token",
    appSecret: "test-secret",
    since: "2026-07-01",
    until: "2026-07-31",
  });

  assert.equal(insightsResult.items.length, 1);
  assert.deepEqual(insightsResult.items[0].actions, [
    { actionType: "lead", value: "5" },
    { actionType: "link_click", value: "30" },
  ]);
  assert.equal(insightsResult.items[0].actionValues[0].value, "123.45");
  assert.equal(insightsResult.usage.adAccountPercent, 44);
  assert.equal(insightsResult.usage.insightsPercent, 55);
  assert.equal(requests[0].url.pathname, "/v25.0/act_123456789/insights");
  assert.equal(requests[0].url.searchParams.get("level"), "ad");
  assert.equal(requests[0].url.searchParams.get("time_increment"), "1");
  assert.equal(
    requests[0].url.searchParams.get("time_range"),
    JSON.stringify({ since: "2026-07-01", until: "2026-07-31" }),
  );
  assert.equal(requests[0].init.method, "GET");

  await assert.rejects(
    Promise.resolve().then(() => client.getMetaAdInsights({
      adAccountId: "act_123456789",
      accessToken: "read-only-token",
      appSecret: "test-secret",
      since: "2026-01-01",
      until: "2026-07-31",
    })),
    RangeError,
  );

  assert.throws(() => client.normalizeMetaAdAccountId("../../me"), TypeError);

  console.log("Meta Marketing read-only checks passed");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { force: true, recursive: true });
}
