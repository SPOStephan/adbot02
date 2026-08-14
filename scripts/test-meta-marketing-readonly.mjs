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

function timeoutError() {
  const error = new Error("Meta read timed out");
  error.name = "TimeoutError";
  return error;
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

  assert.match(clientSource, /META_ALLOWED_SCOPES[\s\S]*"ads_management"/);
  assert.doesNotMatch(clientSource, /business_management/);
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
  let timeoutAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    timeoutAttempts += 1;

    if (timeoutAttempts === 1) {
      throw timeoutError();
    }

    return jsonResponse({
      id: "act_123456789",
      name: "Staging Werbekonto",
      currency: "eur",
      timezone_name: "Europe/Berlin",
      timezone_offset_hours_utc: 2,
      account_status: 1,
    });
  };

  const retriedAccountResult = await client.getMetaAdAccountSummary({
    adAccountId: "123456789",
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });

  assert.equal(retriedAccountResult.account.id, "123456789");
  assert.equal(timeoutAttempts, 2);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].init.signal, requests[1].init.signal);

  let exhaustedTimeoutAttempts = 0;
  globalThis.fetch = async () => {
    exhaustedTimeoutAttempts += 1;
    throw timeoutError();
  };

  await assert.rejects(
    client.getMetaAdAccountSummary({
      adAccountId: "123456789",
      accessToken: "read-only-token",
      appSecret: "test-secret",
    }),
    (error) => error instanceof Error && error.name === "TimeoutError",
  );
  assert.equal(exhaustedTimeoutAttempts, 2);

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
  assert.equal(requests[0].url.searchParams.get("limit"), "50");
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
        image_hash: "ABCDEF0123456789ABCDEF0123456789",
        image_url: "https://scontent-fra5-1.xx.fbcdn.net/creative.jpg",
        thumbnail_url: "https://cdn.example.test/creative.jpg",
        effective_object_story_id: "123_456",
        instagram_permalink_url: "javascript:alert(1)",
        object_type: "SHARE",
        status: "ACTIVE",
      },
      "1000": {
        id: "1000",
        account_id: "123456789",
        name: "Unsafe Creative",
        image_hash: "not-a-hash",
        image_url: "javascript:alert(1)",
        thumbnail_url: "https://cdn.example.test/fallback.jpg",
        status: "ACTIVE",
      },
    });
  };

  const creativesResult = await client.getMetaAdCreatives({
    creativeIds: ["999", "1000", "999", "invalid"],
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });
  assert.equal(creativesResult.items.length, 2);
  const creative999 = creativesResult.items.find((item) => item.id === "999");
  const creative1000 = creativesResult.items.find((item) => item.id === "1000");
  assert.ok(creative999);
  assert.ok(creative1000);
  assert.equal(creative999.thumbnailUrl, "https://cdn.example.test/creative.jpg");
  assert.equal(
    creative999.imageHash,
    "abcdef0123456789abcdef0123456789",
  );
  assert.equal(
    creative999.imageUrl,
    "https://scontent-fra5-1.xx.fbcdn.net/creative.jpg",
  );
  assert.equal(creative999.instagramPermalinkUrl, null);
  assert.equal(creative1000.imageHash, null);
  assert.equal(creative1000.imageUrl, null);
  assert.equal(requests[0].url.pathname, "/v25.0/");
  assert.deepEqual(
    new Set(requests[0].url.searchParams.get("ids")?.split(",")),
    new Set(["999", "1000"]),
  );
  assert.match(requests[0].url.searchParams.get("fields"), /image_hash/);
  assert.match(requests[0].url.searchParams.get("fields"), /image_url/);
  assert.equal(requests[0].url.searchParams.get("thumbnail_width"), "640");
  assert.equal(requests[0].init.method, "GET");

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    const ids = url.searchParams.get("ids")?.split(",") ?? [];
    const fields = url.searchParams.get("fields") ?? "";

    if (fields.includes("creative{id}")) {
      return jsonResponse(Object.fromEntries(ids.map((id) => [id, {
        id,
        account_id: "123456789",
        campaign_id: "1",
        adset_id: "11",
        creative: { id: `${id}9` },
        name: `Historical Ad ${id}`,
        status: "ARCHIVED",
        effective_status: "ARCHIVED",
      }])));
    }

    if (fields.includes("optimization_goal")) {
      return jsonResponse(Object.fromEntries(ids.map((id) => [id, {
        id,
        account_id: "123456789",
        campaign_id: "1",
        name: `Historical Ad Set ${id}`,
        status: "ARCHIVED",
        effective_status: "ARCHIVED",
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        destination_type: "WEBSITE",
      }])));
    }

    return jsonResponse(Object.fromEntries(ids.map((id) => [id, {
      id,
      account_id: "123456789",
      name: `Historical Campaign ${id}`,
      objective: "OUTCOME_TRAFFIC",
      status: "ARCHIVED",
      effective_status: "ARCHIVED",
      is_adset_budget_sharing_enabled: false,
      special_ad_categories: [],
    }])));
  };

  const adsByIdResult = await client.getMetaAdsByIds({
    adIds: ["111", "222", "111", "invalid"],
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });
  const adSetsByIdResult = await client.getMetaAdSetsByIds({
    adSetIds: ["11"],
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });
  const campaignsByIdResult = await client.getMetaCampaignsByIds({
    campaignIds: ["1"],
    accessToken: "read-only-token",
    appSecret: "test-secret",
  });

  assert.deepEqual(adsByIdResult.items.map((item) => item.id), ["111", "222"]);
  assert.equal(adsByIdResult.items[0].creativeId, "1119");
  assert.deepEqual(adSetsByIdResult.items.map((item) => item.id), ["11"]);
  assert.equal(adSetsByIdResult.items[0].campaignId, "1");
  assert.deepEqual(campaignsByIdResult.items.map((item) => item.id), ["1"]);
  assert.equal(campaignsByIdResult.items[0].objective, "OUTCOME_TRAFFIC");
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.url.pathname === "/v25.0/"));
  assert.ok(requests.every((request) => request.init.method === "GET"));
  assert.deepEqual(
    new Set(requests[0].url.searchParams.get("ids")?.split(",")),
    new Set(["111", "222"]),
  );
  assert.match(requests[0].url.searchParams.get("fields"), /creative\{id\}/);
  assert.match(requests[1].url.searchParams.get("fields"), /optimization_goal/);
  assert.match(requests[2].url.searchParams.get("fields"), /objective/);

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
  assert.equal(
    requests[0].url.searchParams.get("use_account_attribution_setting"),
    null,
  );
  assert.equal(
    requests[0].url.searchParams.get("fields")?.includes("attribution_setting"),
    false,
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
