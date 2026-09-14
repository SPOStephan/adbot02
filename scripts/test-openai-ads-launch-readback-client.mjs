import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const source = (await readFile(join(root, "src/lib/openai-ads/client.ts"), "utf8"))
  .replace('import "server-only";\n', "");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-openai-launch-client-"),
);

const accountBody = (overrides = {}) => ({
  id: "account-1",
  name: "OpenAI Account",
  url: "https://ads.openai.com/accounts/account-1",
  preview_url: null,
  status: "active",
  timezone: "Europe/Berlin",
  currency_code: "EUR",
  review: { status: "approved" },
  ...overrides,
});

const campaignBody = (overrides = {}) => ({
  id: "campaign-1",
  name: "Campaign",
  description: null,
  status: "paused",
  bidding_type: "clicks",
  budget: { daily_spend_limit_micros: 25_000_000 },
  start_time: null,
  end_time: null,
  created_at: 1_789_000_000,
  updated_at: 1_789_000_001,
  objective: "website_visits",
  targeting: {
    locations: {
      include: [
        {
          id: "DE",
          name: "Germany",
          type: "country",
          country_code: "DE",
          region_code: null,
        },
      ],
    },
  },
  product_feed_id: null,
  landing_page_configuration: null,
  serving_issues: [],
  ...overrides,
});

const adGroupBody = (overrides = {}) => ({
  id: "group-1",
  name: "Group",
  description: null,
  context_hints: ["hotel"],
  status: "paused",
  landing_page_configuration: null,
  product_set: null,
  bidding_config: {
    billing_event_type: "click",
    strategy: "fixed_bid",
    max_bid_micros: 2_000_000,
    custom_audience_bid_multipliers: [],
  },
  created_at: 1_789_000_000,
  updated_at: 1_789_000_001,
  serving_issues: [],
  ...overrides,
});

const adBody = (overrides = {}) => ({
  id: "ad-1",
  name: "Ad",
  status: "paused",
  review_status: "approved",
  review: { status: "approved" },
  creative: {
    type: "chat_card",
    title: "Title",
    body: "Body",
    file_id: "file-1",
    target_url: "https://example.com/",
  },
  landing_page_configuration: null,
  created_at: 1_789_000_000,
  updated_at: 1_789_000_001,
  serving_issues: [],
  ...overrides,
});

try {
  const modulePath = join(temporaryDirectory, "client.mjs");
  await writeFile(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf8",
  );
  const { OpenAIAdsClient } = await import(pathToFileURL(modulePath).href);

  const getCampaignPath = "/campaigns/campaign-1?include%5B%5D=serving_issues";
  const getAdGroupPath = "/ad_groups/group-1?include%5B%5D=serving_issues";
  const getAdPath = "/ads/ad-1?include%5B%5D=serving_issues";
  const previewPath = "/ads/ad-1/preview";
  const requests = [];
  const payloads = new Map([
    ["/ad_account", accountBody()],
    [getCampaignPath, campaignBody()],
    [getAdGroupPath, adGroupBody()],
    [getAdPath, adBody()],
    [previewPath, { data: [{ body: "<html><body>Preview A</body></html>" }] }],
    [
      "/campaigns?include%5B%5D=serving_issues&limit=500",
      {
        object: "list",
        data: [campaignBody({ id: "campaign-other" })],
        first_id: "campaign-other",
        last_id: "campaign-other",
        has_more: true,
      },
    ],
    [
      "/campaigns?include%5B%5D=serving_issues&limit=500&after=campaign-other",
      {
        object: "list",
        data: [campaignBody()],
        first_id: "campaign-1",
        last_id: "campaign-1",
        has_more: false,
      },
    ],
    [
      "/ad_groups?campaign_id=campaign-1&include%5B%5D=serving_issues&limit=500",
      {
        object: "list",
        data: [adGroupBody({ id: "group-other" })],
        first_id: "group-other",
        last_id: "group-other",
        has_more: true,
      },
    ],
    [
      "/ad_groups?campaign_id=campaign-1&include%5B%5D=serving_issues&limit=500&after=group-other",
      {
        object: "list",
        data: [adGroupBody()],
        first_id: "group-1",
        last_id: "group-1",
        has_more: false,
      },
    ],
    [
      "/ads?ad_group_id=group-1&include%5B%5D=serving_issues&limit=500",
      {
        object: "list",
        data: [adBody({ id: "ad-other" })],
        first_id: "ad-other",
        last_id: "ad-other",
        has_more: true,
      },
    ],
    [
      "/ads?ad_group_id=group-1&include%5B%5D=serving_issues&limit=500&after=ad-other",
      {
        object: "list",
        data: [adBody()],
        first_id: "ad-1",
        last_id: "ad-1",
        has_more: false,
      },
    ],
  ]);
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    requests.push({ path, init });
    const body = payloads.get(path);
    return new Response(JSON.stringify(body), {
      status: body ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new OpenAIAdsClient({
    apiKey: "test-key",
    baseUrl: "https://api.ads.openai.com",
    fetchImpl,
  });

  const account = await client.getAdAccount();
  const campaign = await client.getCampaign("campaign-1");
  const adGroup = await client.getAdGroup("group-1");
  const ad = await client.getAd("ad-1");
  const preview = await client.previewAd("ad-1");
  const listedCampaigns = await client.listCampaigns();
  const listedAdGroups = await client.listAdGroups("campaign-1");
  const listedAds = await client.listAds("group-1");

  assert.equal(account.preview_url, null);
  assert.equal(account.account_integrity_review, null);
  assert.equal(campaign.serving_issues_observed, true);
  assert.equal(campaign.budget.lifetime_spend_limit_micros_present, false);
  assert.equal(campaign.product_feed_id, null);
  assert.equal(campaign.landing_page_configuration, null);
  assert.equal(adGroup.serving_issues_observed, true);
  assert.equal(adGroup.product_set, null);
  assert.equal(ad.serving_issues_observed, true);
  assert.equal(adGroup.bidding_config.strategy, "fixed_bid");
  assert.deepEqual(adGroup.bidding_config.custom_audience_bid_multipliers, []);
  assert.equal(ad.creative.file_id, "file-1");
  assert.deepEqual(preview.bodies, ["<html><body>Preview A</body></html>"]);
  assert.deepEqual(listedCampaigns.map((item) => item.id), [
    "campaign-other",
    "campaign-1",
  ]);
  assert.deepEqual(listedAdGroups.map((item) => item.id), ["group-other", "group-1"]);
  assert.deepEqual(listedAds.map((item) => item.id), ["ad-other", "ad-1"]);
  assert.equal(
    requests.find((item) => item.path === previewPath)?.init.method,
    "POST",
  );
  assert.ok(
    [getCampaignPath, getAdGroupPath, getAdPath].every((path) =>
      requests.some((item) => item.path === path),
    ),
  );
  assert.ok(
    requests.every(
      (item) => item.init.cache === "no-store" && item.init.redirect === "error",
    ),
  );

  for (const malformedAccount of [
    (() => {
      const value = accountBody();
      delete value.preview_url;
      return value;
    })(),
    accountBody({ preview_url: 42 }),
    accountBody({ preview_url: {} }),
    accountBody({ status: null }),
    accountBody({ review: { status: "approved", reason: null } }),
  ]) {
    payloads.set("/ad_account", malformedAccount);
    await assert.rejects(
      () => client.getAdAccount(),
      (error) => error?.code === "invalid_provider_response",
    );
  }
  payloads.set("/ad_account", accountBody());
  for (const status of ["approved", "in_review", "rejected"]) {
    payloads.set(
      "/ad_account",
      accountBody({
        account_integrity_review: {
          review: { status },
          details: {
            decision: "decision",
            reason: "reason",
            status_updated_at: "2026-09-13T00:00:00Z",
          },
        },
      }),
    );
    assert.equal(
      (await client.getAdAccount()).account_integrity_review.review.status,
      status,
    );
  }
  for (const malformedIntegrity of [
    null,
    {},
    { review: {} },
    { review: { status: "unknown" } },
    { review: { status: "approved" }, details: null },
  ]) {
    payloads.set(
      "/ad_account",
      accountBody({ account_integrity_review: malformedIntegrity }),
    );
    await assert.rejects(
      () => client.getAdAccount(),
      (error) => error?.code === "invalid_provider_response" ||
        error?.code === "unknown_review_status",
    );
  }
  payloads.set("/ad_account", accountBody());

  payloads.set(
    getCampaignPath,
    campaignBody({
      budget: {
        daily_spend_limit_micros: 25_000_000.5,
      },
    }),
  );
  await assert.rejects(
    () => client.getCampaign("campaign-1"),
    (error) => error?.code === "invalid_provider_response",
  );

  payloads.set(
    getCampaignPath,
    campaignBody({
      budget: {
        daily_spend_limit_micros: 25_000_000,
        lifetime_spend_limit_micros: null,
      },
    }),
  );
  await assert.rejects(
    () => client.getCampaign("campaign-1"),
    (error) => error?.code === "invalid_provider_response",
  );

  for (const requiredField of [
    "description",
    "product_feed_id",
    "start_time",
    "end_time",
    "created_at",
    "updated_at",
  ]) {
    const malformed = campaignBody();
    delete malformed[requiredField];
    payloads.set(getCampaignPath, malformed);
    await assert.rejects(
      () => client.getCampaign("campaign-1"),
      (error) => error?.code === "invalid_provider_response",
      `missing CampaignItemBody.${requiredField} must fail closed`,
    );
  }

  for (const malformedTargeting of [
    null,
    { locations: null },
    { locations: { countries: "DE" } },
    { locations: { include: [null] } },
    { locations: { include: [{ id: "DE" }] } },
    {
      locations: {
        include: [
          {
            id: "DE",
            name: "Germany",
            type: "country",
            country_code: "DE",
          },
        ],
      },
    },
    { custom_audiences: {} },
    { excluded_custom_audiences: { ids: [42] } },
    { platforms: { included: [42] } },
  ]) {
    payloads.set(getCampaignPath, campaignBody({ targeting: malformedTargeting }));
    await assert.rejects(
      () => client.getCampaign("campaign-1"),
      (error) => error?.code === "invalid_provider_response",
    );
  }

  payloads.set(
    getCampaignPath,
    campaignBody({ landing_page_configuration: {} }),
  );
  await assert.rejects(
    () => client.getCampaign("campaign-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  payloads.set(
    getCampaignPath,
    campaignBody({
      landing_page_configuration: { query_string_template: "utm_source=openai" },
    }),
  );
  assert.equal(
    (await client.getCampaign("campaign-1")).landing_page_configuration
      .query_string_template,
    "utm_source=openai",
  );

  const missingAdGroupDescription = adGroupBody();
  delete missingAdGroupDescription.description;
  payloads.set(getAdGroupPath, missingAdGroupDescription);
  await assert.rejects(
    () => client.getAdGroup("group-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  payloads.set(
    getAdGroupPath,
    adGroupBody({
      bidding_config: {
        billing_event_type: "click",
        strategy: "fixed_bid",
        max_bid_micros: null,
        custom_audience_bid_multipliers: [],
      },
    }),
  );
  await assert.rejects(
    () => client.getAdGroup("group-1"),
    (error) => error?.code === "invalid_provider_response",
  );

  const missingAdReview = adBody();
  delete missingAdReview.review;
  payloads.set(getAdPath, missingAdReview);
  await assert.rejects(
    () => client.getAd("ad-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  payloads.set(
    getAdPath,
    adBody({ review: { status: "in_review" } }),
  );
  await assert.rejects(
    () => client.getAd("ad-1"),
    (error) => error?.code === "invalid_provider_response",
  );

  payloads.set(
    getAdPath,
    adBody({ creative: { ...adBody().creative, body: "" } }),
  );
  assert.equal((await client.getAd("ad-1")).creative.body, "");
  payloads.set(
    getAdPath,
    adBody({
      creative: {
        ...adBody().creative,
        image_crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
      },
    }),
  );
  assert.deepEqual((await client.getAd("ad-1")).creative.image_crop, {
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.5,
  });

  for (const malformedCreative of [
    { ...adBody().creative, price: null },
    { ...adBody().creative, file_id: null },
    { ...adBody().creative, image_crop: null },
    { ...adBody().creative, image_crop: { x: 0, y: 0, width: 1 } },
    {
      ...adBody().creative,
      image_crop: { x: "0", y: 0, width: 1, height: 1 },
    },
    {
      ...adBody().creative,
      image_crop: { x: 0.5, y: 0, width: 0.6, height: 1 },
    },
    {
      ...adBody().creative,
      image_crop: { x: 0, y: 0, width: 0.8, height: 0.6 },
    },
  ]) {
    payloads.set(getAdPath, adBody({ creative: malformedCreative }));
    await assert.rejects(
      () => client.getAd("ad-1"),
      (error) => error?.code === "invalid_provider_response",
    );
  }

  for (const malformedPreview of [
    { data: [] },
    { data: [{ body: "   " }] },
    { data: [{}] },
    { data: Array.from({ length: 11 }, () => ({ body: "preview" })) },
    { data: [{ body: "x".repeat(1_000_001) }] },
  ]) {
    payloads.set(previewPath, malformedPreview);
    await assert.rejects(
      () => client.previewAd("ad-1"),
      (error) => error?.code === "invalid_provider_response",
    );
  }

  for (const status of [401, 403, 404, 500, 503]) {
    const failingPreviewClient = new OpenAIAdsClient({
      apiKey: "test-key",
      baseUrl: "https://api.ads.openai.com",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { message: `provider ${status}` } }),
          { status, headers: { "content-type": "application/json" } },
        ),
    });
    await assert.rejects(
      () => failingPreviewClient.previewAd("ad-1"),
      (error) => error?.status === status,
    );
  }
  const nonJsonPreviewClient = new OpenAIAdsClient({
    apiKey: "test-key",
    baseUrl: "https://api.ads.openai.com",
    fetchImpl: async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
  });
  await assert.rejects(
    () => nonJsonPreviewClient.previewAd("ad-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  const timeoutPreviewClient = new OpenAIAdsClient({
    apiKey: "test-key",
    baseUrl: "https://api.ads.openai.com",
    deadlineAtMs: Date.now() + 1_100,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  });
  await assert.rejects(
    () => timeoutPreviewClient.previewAd("ad-1"),
    (error) => error?.code === "provider_timeout",
  );

  payloads.set(getCampaignPath, campaignBody({ serving_issues: "not-an-array" }));
  await assert.rejects(
    () => client.getCampaign("campaign-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  const missingServingIssues = campaignBody();
  delete missingServingIssues.serving_issues;
  payloads.set(getCampaignPath, missingServingIssues);
  await assert.rejects(
    () => client.getCampaign("campaign-1"),
    (error) => error?.code === "invalid_provider_response",
  );

  for (const malformedProductSet of [
    {},
    { product_feed_id: "feed-1" },
    { product_feed_id: "feed-1", filters: [{}] },
  ]) {
    payloads.set(getAdGroupPath, adGroupBody({ product_set: malformedProductSet }));
    await assert.rejects(
      () => client.getAdGroup("group-1"),
      (error) => error?.code === "invalid_provider_response",
    );
  }
  payloads.set(
    getAdGroupPath,
    adGroupBody({
      bidding_config: {
        billing_event_type: "click",
        strategy: 123,
        max_bid_micros: 2_000_000,
        custom_audience_bid_multipliers: [],
      },
    }),
  );
  await assert.rejects(
    () => client.getAdGroup("group-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  payloads.set(
    getAdGroupPath,
    adGroupBody({
      bidding_config: {
        billing_event_type: "click",
        strategy: "fixed_bid",
        max_bid_micros: 2_000_000,
        custom_audience_bid_multipliers: [{}],
      },
    }),
  );
  await assert.rejects(
    () => client.getAdGroup("group-1"),
    (error) => error?.code === "invalid_provider_response",
  );
  payloads.set(getAdPath, adBody({ serving_issues: [{}] }));
  await assert.rejects(
    () => client.getAd("ad-1"),
    (error) => error?.code === "invalid_provider_response",
  );

  const firstCampaignListPath =
    "/campaigns?include%5B%5D=serving_issues&limit=500";
  const validEnvelope = {
    object: "list",
    data: [campaignBody()],
    first_id: "campaign-1",
    last_id: "campaign-1",
    has_more: false,
  };
  for (const malformedEnvelope of [
    { ...validEnvelope, object: undefined },
    { ...validEnvelope, first_id: undefined },
    { ...validEnvelope, last_id: undefined },
    { ...validEnvelope, has_more: undefined },
    { ...validEnvelope, has_more: "false" },
    { ...validEnvelope, has_more: true, last_id: null },
  ]) {
    payloads.set(firstCampaignListPath, malformedEnvelope);
    await assert.rejects(
      () => client.listCampaigns(),
      (error) =>
        error?.code === "invalid_provider_response" ||
        error?.code === "invalid_pagination",
    );
  }
  payloads.set(firstCampaignListPath, {
    ...validEnvelope,
    has_more: true,
  });
  payloads.set(
    "/campaigns?include%5B%5D=serving_issues&limit=500&after=campaign-1",
    { ...validEnvelope, has_more: true },
  );
  await assert.rejects(
    () => client.listCampaigns(),
    (error) => error?.code === "invalid_pagination",
  );

  const validInsight = {
    id: "insight-1",
    start_time: 1_789_000_000,
    end_time: 1_789_086_400,
    readable_time: "2026-09-10",
    campaign_id: "campaign-1",
    campaign_name: "Campaign One",
    impressions: 10,
    clicks: 1,
    spend: 2.5,
  };
  const validInsightEnvelope = {
    object: "list",
    data: [validInsight],
    count: 1,
    first_id: "insight-1",
    last_id: "insight-1",
    has_more: false,
  };
  const validConversionEnvelope = {
    object: "list",
    data: [{ entity_id: "campaign-1", conversions: 2 }],
    count: 1,
  };
  let reportPayload = validInsightEnvelope;
  let lastReportRequest = null;
  let lastReportUrl = null;
  const reportClient = new OpenAIAdsClient({
    apiKey: "test-key",
    baseUrl: "https://api.ads.openai.com",
    fetchImpl: async (url, init) => {
      lastReportUrl = url;
      lastReportRequest = init;
      return new Response(JSON.stringify(reportPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(
    (
      await reportClient.listDailyCampaignInsights({
        startUnix: 1_789_000_000,
        endUnix: 1_789_086_400,
      })
    )[0].start_time,
    validInsight.start_time,
  );
  assert.deepEqual(
    new URL(lastReportUrl).searchParams.getAll("includes[]"),
    ["zero_impression_items"],
  );
  for (const malformedEnvelope of [
    { ...validInsightEnvelope, object: undefined },
    { ...validInsightEnvelope, count: undefined },
    { ...validInsightEnvelope, count: -1 },
  ]) {
    reportPayload = malformedEnvelope;
    await assert.rejects(
      () =>
        reportClient.listDailyCampaignInsights({
          startUnix: 1_789_000_000,
          endUnix: 1_789_086_400,
        }),
      (error) => error?.code === "invalid_provider_response",
    );
  }
  for (const [field, value] of [
    ["start_time", undefined],
    ["start_time", null],
    ["start_time", "1789000000"],
    ["start_time", 1.5],
    ["start_time", -1],
    ["end_time", undefined],
    ["end_time", null],
    ["end_time", "1789086400"],
    ["end_time", 1.5],
    ["end_time", -1],
    ["campaign_id", undefined],
    ["campaign_id", null],
    ["campaign_name", undefined],
    ["campaign_name", null],
    ["impressions", undefined],
    ["impressions", null],
    ["impressions", -1],
    ["impressions", 1.5],
    ["clicks", undefined],
    ["clicks", null],
    ["clicks", -1],
    ["clicks", 1.5],
    ["spend", undefined],
    ["spend", null],
    ["spend", -1],
    ["spend", Number.NaN],
  ]) {
    reportPayload = {
      ...validInsightEnvelope,
      data: [{ ...validInsight, [field]: value }],
    };
    await assert.rejects(
      () =>
        reportClient.listDailyCampaignInsights({
          startUnix: 1_789_000_000,
          endUnix: 1_789_086_400,
        }),
      (error) => error?.code === "invalid_provider_response",
    );
  }
  reportPayload = validConversionEnvelope;
  assert.equal(
    (
      await reportClient.listDailyCampaignConversions({
        date: "2026-09-10",
        startUnix: 1_789_000_000,
        endUnix: 1_789_086_400,
        campaignIds: ["campaign-1"],
      })
    )[0].conversions,
    2,
  );
  assert.equal(JSON.parse(lastReportRequest.body).include_zero_rows, true);
  for (const malformedEnvelope of [
    { ...validConversionEnvelope, object: undefined },
    { ...validConversionEnvelope, count: undefined },
    { ...validConversionEnvelope, count: -1 },
    { ...validConversionEnvelope, count: 2 },
  ]) {
    reportPayload = malformedEnvelope;
    await assert.rejects(
      () =>
        reportClient.listDailyCampaignConversions({
          date: "2026-09-10",
          startUnix: 1_789_000_000,
          endUnix: 1_789_086_400,
          campaignIds: ["campaign-1"],
        }),
      (error) => error?.code === "invalid_provider_response",
    );
  }
  for (const value of [undefined, null, "2", -1, 1.5, Number.NaN]) {
    reportPayload = {
      ...validConversionEnvelope,
      data: [{ entity_id: "campaign-1", conversions: value }],
    };
    await assert.rejects(
      () =>
        reportClient.listDailyCampaignConversions({
          date: "2026-09-10",
          startUnix: 1_789_000_000,
          endUnix: 1_789_086_400,
          campaignIds: ["campaign-1"],
        }),
      (error) => error?.code === "invalid_provider_response",
    );
  }
  for (const data of [
    [],
    [
      { entity_id: "campaign-1", conversions: 1 },
      { entity_id: "campaign-1", conversions: 1 },
    ],
    [{ entity_id: "foreign-campaign", conversions: 1 }],
  ]) {
    reportPayload = { ...validConversionEnvelope, data, count: data.length };
    await assert.rejects(
      () =>
        reportClient.listDailyCampaignConversions({
          date: "2026-09-10",
          startUnix: 1_789_000_000,
          endUnix: 1_789_086_400,
          campaignIds: ["campaign-1"],
        }),
      (error) => error?.code === "invalid_provider_response",
    );
  }

  console.log("test-openai-ads-launch-readback-client: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
