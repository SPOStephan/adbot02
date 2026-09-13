import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const source = await readFile(
  join(root, "src/lib/openai-ads/launch-safety.ts"),
  "utf8",
);
const inputSource = await readFile(
  join(root, "src/lib/openai-ads/input.ts"),
  "utf8",
);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-openai-launch-safety-"),
);

try {
  const modulePath = join(temporaryDirectory, "launch-safety.mjs");
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
  const inputModulePath = join(temporaryDirectory, "input.mjs");
  await writeFile(
    inputModulePath,
    ts.transpileModule(inputSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf8",
  );
  const safety = await import(pathToFileURL(modulePath).href);
  const launchInput = await import(pathToFileURL(inputModulePath).href);

  const validInput = {
    platformAccountId: "22000000-0000-4000-8000-000000000001",
    confirmation: "create_paused_openai_ads_campaign",
    campaignName: "Campaign",
    campaignDescription: "Description",
    biddingType: "clicks",
    dailyBudget: "25.00",
    maxBid: "2.00",
    startDate: "",
    endDate: "",
    locationIds: ["DE"],
    adGroupName: "Group",
    contextHints: ["hotel"],
    adName: "Ad name",
    title: "Title",
    body: "Body",
    targetUrl: "https://example.com",
    imageUrl: "https://example.com/image.jpg",
  };
  assert.deepEqual(
    {
      confirmation: validInput.confirmation,
      dailyBudgetMicros:
        launchInput.parseOpenAIAdsLaunchInput(validInput).dailyBudgetMicros,
    },
    {
      confirmation: "create_paused_openai_ads_campaign",
      dailyBudgetMicros: 25_000_000,
    },
  );
  assert.equal(
    launchInput.parseOpenAIAdsLaunchInput({
      ...validInput,
      campaignDescription: "   ",
    }).campaignDescription,
    null,
  );
  assert.throws(
    () =>
      launchInput.parseOpenAIAdsLaunchInput({
        ...validInput,
        confirmation: "create_active_openai_ads_campaign",
      }),
    (error) => error?.code === "confirmation_required",
  );
  assert.throws(
    () =>
      launchInput.parseOpenAIAdsLaunchInput({
        ...validInput,
        lifetimeBudget: "100.00",
      }),
    (error) => error?.code === "legacy_budget_not_supported",
  );
  assert.throws(
    () =>
      launchInput.parseOpenAIAdsLaunchInput({
        ...validInput,
        maxBid: "30400000.000001",
      }),
    (error) => error?.code === "amount_out_of_range",
  );
  for (const startDate of ["1999-12-31", "2100-01-02", "2500-01-01"]) {
    assert.throws(
      () =>
        launchInput.parseOpenAIAdsLaunchInput({
          ...validInput,
          startDate,
        }),
      (error) => error?.code === "invalid_date",
    );
  }
  assert.throws(
    () =>
      launchInput.parseOpenAIAdsActivationInput({
        launchId: validInput.platformAccountId,
        confirmation: "activate_openai_ads_campaign",
      }),
    (error) => error?.code === "invalid_text",
  );

  const contract = safety.parseStoredOpenAIAdsLaunchContract({
    contractVersion: safety.OPENAI_ADS_LAUNCH_CONTRACT,
    remoteAccountId: "account-123",
    currency: "eur",
    accountTimezone: "Europe/Berlin",
    campaignName: "Campaign [adbot:1234567890]",
    campaignDescription: "Description",
    biddingType: "clicks",
    billingEventType: "click",
    dailyBudgetMicros: 25_000_000,
    maxBidMicros: 2_000_000,
    startTime: null,
    endTime: null,
    locationIds: ["DE"],
    adGroupName: "Group [adbot:1234567890]",
    contextHints: ["hotel"],
    adName: "Ad [adbot:1234567890]",
    title: "Title",
    body: "Body",
    targetUrl: "https://example.com/",
    imageUrl: "https://example.com/image.png",
  });
  assert.ok(contract);
  assert.equal(contract.currency, "EUR");
  assert.equal(
    safety.accountLocalDateToUnix("2026-09-12", "Europe/Berlin"),
    1_789_164_000,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2026-01-12", "Europe/Berlin"),
    1_768_172_400,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2026-03-29", "Europe/Berlin"),
    1_774_738_800,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2026-10-25", "Europe/Berlin"),
    1_792_879_200,
  );
  assert.equal(safety.accountLocalDateToUnix("1999-12-31", "UTC"), null);
  assert.equal(safety.accountLocalDateToUnix("2000-01-01", "Europe/Berlin"), null);
  assert.equal(
    safety.accountLocalDateToUnix("2000-01-01", "America/New_York"),
    946_702_800,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2100-01-01", "Europe/Berlin"),
    4_102_441_200,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2000-01-01", "Europe/Berlin"),
    null,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2000-01-01", "UTC"),
    safety.OPENAI_ADS_MIN_TIMESTAMP,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2100-01-01", "UTC"),
    safety.OPENAI_ADS_MAX_TIMESTAMP,
  );
  assert.equal(
    safety.accountLocalDateToUnix("2100-01-01", "Pacific/Kiritimati"),
    4_102_394_400,
  );
  assert.equal(safety.accountLocalDateToUnix("2100-01-02", "Europe/Berlin"), null);
  assert.equal(safety.accountLocalDateToUnix("2500-01-01", "UTC"), null);
  assert.equal(safety.accountLocalDateToUnix("2026-09-12", "invalid/zone"), null);
  assert.equal(
    safety.parseStoredOpenAIAdsLaunchContract({
      lifetimeBudgetMicros: 100_000_000,
      dailyBudgetMicros: 25_000_000,
    }),
    null,
    "legacy/direct launches must never pass the new activation contract",
  );
  assert.equal(
    safety.parseStoredOpenAIAdsLaunchContract({
      ...contract,
      billingEventType: "impression",
    }),
    null,
    "bidding and billing event must remain compatible",
  );
  for (const timestampOverride of [
    { startTime: safety.OPENAI_ADS_MIN_TIMESTAMP - 1 },
    { endTime: safety.OPENAI_ADS_MAX_TIMESTAMP + 1 },
    { startTime: 2_000_000_000, endTime: 2_000_000_000 },
  ]) {
    assert.equal(
      safety.parseStoredOpenAIAdsLaunchContract({
        ...contract,
        ...timestampOverride,
      }),
      null,
    );
  }
  for (const amountOverride of [
    { dailyBudgetMicros: safety.OPENAI_ADS_MIN_DAILY_BUDGET_MICROS - 1 },
    { maxBidMicros: safety.OPENAI_ADS_MAX_BID_MICROS + 1 },
  ]) {
    assert.equal(
      safety.parseStoredOpenAIAdsLaunchContract({
        ...contract,
        ...amountOverride,
      }),
      null,
    );
  }

  const campaignPayload = safety.buildPausedCampaignPayload({
    name: "Campaign",
    description: null,
    biddingType: "clicks",
    dailyBudgetMicros: 25_000_000,
    startTime: null,
    endTime: null,
    locationIds: ["DE"],
  });
  assert.equal(campaignPayload.status, "paused");
  assert.equal("description" in campaignPayload, false);
  assert.deepEqual(campaignPayload.budget, {
    daily_spend_limit_micros: 25_000_000,
  });
  assert.equal("lifetime_spend_limit_micros" in campaignPayload.budget, false);

  const adGroupPayload = safety.buildPausedAdGroupPayload({
    campaignId: "campaign-123",
    name: "Group",
    description: null,
    contextHints: ["hotel"],
    billingEventType: "click",
    maxBidMicros: 2_000_000,
  });
  assert.equal(adGroupPayload.status, "paused");
  assert.equal("description" in adGroupPayload, false);
  assert.equal(adGroupPayload.bidding_config.strategy, "fixed_bid");
  assert.equal(adGroupPayload.bidding_config.max_bid_micros, 2_000_000);

  const adPayload = safety.buildPausedAdPayload({
    adGroupId: "group-123",
    name: "Ad",
    title: "Title",
    body: "Body",
    targetUrl: "https://example.com",
    fileId: "file-123",
  });
  assert.equal(adPayload.status, "paused");

  const summary = safety.budgetSummary({
    currency: "eur",
    dailyBudgetMicros: 25_000_000,
  });
  assert.deepEqual(summary, {
    currency: "EUR",
    dailyBudgetMicros: 25_000_000,
  });
  assert.equal(
    safety.budgetSummary({
      currency: "EUR",
      dailyBudgetMicros: 0,
    }),
    null,
  );
  const contractHash = safety.openAIAdsLaunchContractHash(contract);
  const providerPreviewHash = safety.openAIAdsProviderPreviewHash([
    "<html><body>Provider preview</body></html>",
  ]);
  assert.ok(contractHash);
  assert.ok(providerPreviewHash);
  assert.equal(safety.openAIAdsProviderPreviewHash([]), null);
  const previewToken = safety.issueOpenAIAdsActivationPreviewToken({
    secret: "test-secret-with-sufficient-entropy",
    userId: "user-123",
    launchId: "launch-123",
    remoteAccountId: "account-123",
    campaignId: "campaign-123",
    adGroupId: "group-123",
    adId: "ad-123",
    budget: summary,
    contractHash,
    providerPreviewHash,
    nowMs: 1_000_000,
  });
  const verifyPreview = (overrides = {}) =>
    safety.verifyOpenAIAdsActivationPreviewToken({
      token: previewToken,
      secret: "test-secret-with-sufficient-entropy",
      userId: "user-123",
      launchId: "launch-123",
      remoteAccountId: "account-123",
      campaignId: "campaign-123",
      adGroupId: "group-123",
      adId: "ad-123",
      budget: summary,
      contractHash,
      nowMs: 1_000_001,
      ...overrides,
    });
  assert.equal(verifyPreview(), true);
  assert.equal(
    verifyPreview({
      nowMs: 1_000_000 + safety.OPENAI_ADS_ACTIVATION_PREVIEW_TTL_MS + 1,
    }),
    false,
  );
  assert.equal(verifyPreview({ token: `${previewToken}x` }), false);
  assert.equal(verifyPreview({ userId: "other-user" }), false);
  assert.equal(verifyPreview({ launchId: "other-launch" }), false);
  assert.equal(verifyPreview({ remoteAccountId: "other-account" }), false);
  assert.equal(verifyPreview({ campaignId: "other-campaign" }), false);
  assert.equal(verifyPreview({ adGroupId: "other-group" }), false);
  assert.equal(verifyPreview({ adId: "other-ad" }), false);
  assert.equal(
    verifyPreview({ budget: { ...summary, currency: "USD" } }),
    false,
  );
  assert.equal(
    verifyPreview({
      budget: { ...summary, dailyBudgetMicros: summary.dailyBudgetMicros + 1 },
    }),
    false,
  );
  assert.equal(verifyPreview({ contractHash: "changed-contract" }), false);
  assert.equal(verifyPreview({ providerPreviewHash }), true);
  assert.equal(verifyPreview({ providerPreviewHash: "changed-preview" }), false);

  const readback = {
    account: {
      id: "account-123",
      status: "active",
      currency_code: "EUR",
      timezone: "Europe/Berlin",
      review: { status: "approved" },
    },
    campaign: {
      id: "campaign-123",
      name: "Campaign [adbot:1234567890]",
      description: "Description",
      status: "paused",
      bidding_type: "clicks",
      budget: {
        lifetime_spend_limit_micros_present: false,
        daily_spend_limit_micros: 25_000_000,
      },
      start_time: null,
      end_time: null,
      targeting: { locations: { include: [{ id: "DE" }] } },
      product_feed_id: null,
      landing_page_configuration: null,
      serving_issues: [],
      serving_issues_observed: true,
    },
    adGroup: {
      id: "group-123",
      name: "Group [adbot:1234567890]",
      description: "Description",
      status: "paused",
      bidding_config: {
        billing_event_type: "click",
        strategy: "fixed_bid",
        max_bid_micros: 2_000_000,
        custom_audience_bid_multipliers: [],
      },
      context_hints: ["hotel"],
      product_set: null,
      landing_page_configuration: null,
      serving_issues: [],
      serving_issues_observed: true,
    },
    ad: {
      id: "ad-123",
      name: "Ad [adbot:1234567890]",
      status: "paused",
      review_status: "approved",
      creative: {
        type: "chat_card",
        title: "Title",
        body: "Body",
        price: null,
        file_id: "file-123",
        image_crop: null,
        target_url: "https://example.com/",
      },
      landing_page_configuration: null,
      serving_issues: [],
      serving_issues_observed: true,
    },
    parentageVerified: true,
  };
  const validate = (overrides = {}) =>
    safety.validateOpenAIAdsLaunchReadback({
      contract,
      expectedCampaignId: "campaign-123",
      expectedAdGroupId: "group-123",
      expectedAdId: "ad-123",
      expectedFileId: "file-123",
      readback,
      expectedStatus: "paused",
      requireApprovedAd: true,
      ...overrides,
    });
  assert.deepEqual(validate(), { ok: true });
  assert.deepEqual(
    validate({
      readback: {
        ...readback,
        account: {
          ...readback.account,
          account_integrity_review: { review: { status: "approved" } },
        },
      },
    }),
    { ok: true },
  );
  for (const status of ["in_review", "rejected"]) {
    assert.equal(
      validate({
        readback: {
          ...readback,
          account: {
            ...readback.account,
            account_integrity_review: { review: { status } },
          },
        },
      }).code,
      "account_not_serving_ready",
    );
  }
  const pausedStatusIssuesReadback = {
    ...readback,
    campaign: {
      ...readback.campaign,
      serving_issues: [{ code: "campaign_not_active" }],
    },
    adGroup: {
      ...readback.adGroup,
      serving_issues: [{ code: "ad_group_not_active" }],
    },
    ad: {
      ...readback.ad,
      serving_issues: [{ code: "ad_not_active" }],
    },
  };
  assert.deepEqual(
    validate({ readback: pausedStatusIssuesReadback }),
    { ok: true },
  );
  assert.equal(
    validate({
      readback: {
        ...pausedStatusIssuesReadback,
        campaign: { ...pausedStatusIssuesReadback.campaign, status: "active" },
        adGroup: { ...pausedStatusIssuesReadback.adGroup, status: "active" },
        ad: { ...pausedStatusIssuesReadback.ad, status: "active" },
      },
      expectedStatus: "active",
    }).code,
    "provider_serving_issue",
  );
  assert.deepEqual(
    validate({
      readback: {
        ...readback,
        ad: {
          ...readback.ad,
          review_status: "in_review",
          serving_issues: [{ code: "ad_in_review" }],
        },
      },
      requireApprovedAd: false,
    }),
    { ok: true },
  );

  const activeReadback = {
    ...readback,
    campaign: { ...readback.campaign, status: "active" },
    adGroup: { ...readback.adGroup, status: "active" },
    ad: { ...readback.ad, status: "active" },
  };
  assert.deepEqual(
    validate({ readback: activeReadback, expectedStatus: "active" }),
    { ok: true },
  );

  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: {
          ...readback.campaign,
          budget: {
            lifetime_spend_limit_micros_present: false,
            daily_spend_limit_micros: 24_999_999,
          },
        },
      },
    }).code,
    "campaign_budget_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: {
          ...readback.campaign,
          budget: {
            lifetime_spend_limit_micros: 100_000_000,
            lifetime_spend_limit_micros_present: true,
            daily_spend_limit_micros: 25_000_000,
          },
        },
      },
    }).code,
    "campaign_budget_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: {
          ...readback.campaign,
          budget: {
            lifetime_spend_limit_micros: null,
            lifetime_spend_limit_micros_present: true,
            daily_spend_limit_micros: 25_000_000,
          },
        },
      },
    }).code,
    "campaign_budget_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        account: { ...readback.account, id: "other-account" },
      },
    }).code,
    "remote_account_mismatch",
  );
  assert.equal(
    validate({
      readback: { ...readback, parentageVerified: false },
    }).code,
    "remote_chain_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        account: { ...readback.account, currency_code: "USD" },
      },
    }).code,
    "remote_currency_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        adGroup: {
          ...readback.adGroup,
          bidding_config: {
            billing_event_type: "click",
            max_bid_micros: 2_000_001,
          },
        },
      },
    }).code,
    "ad_group_bid_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: {
          ...readback.campaign,
          targeting: { locations: { include: [{ id: "US" }] } },
        },
      },
    }).code,
    "campaign_scope_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: {
          ...readback.campaign,
          targeting: {
            locations: { include: [{ id: "DE" }] },
            excluded_locations: { countries: ["FR"] },
          },
        },
      },
    }).code,
    "campaign_scope_readback_mismatch",
  );
  for (const campaignOverride of [
    { product_feed_id: "feed-123" },
    {
      landing_page_configuration: {
        query_string_template: "utm_source=openai",
      },
    },
  ]) {
    assert.equal(
      validate({
        readback: {
          ...readback,
          campaign: { ...readback.campaign, ...campaignOverride },
        },
      }).code,
      "campaign_scope_readback_mismatch",
    );
  }
  assert.equal(
    validate({
      readback: {
        ...readback,
        adGroup: {
          ...readback.adGroup,
          product_set: { product_ids: ["product-1"] },
        },
      },
    }).code,
    "ad_group_product_scope_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        adGroup: {
          ...readback.adGroup,
          landing_page_configuration: {
            query_string_template: "utm_source=openai",
          },
        },
      },
    }).code,
    "ad_group_landing_scope_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        ad: {
          ...readback.ad,
          landing_page_configuration: {
            query_string_template: "utm_source=openai",
          },
        },
      },
    }).code,
    "ad_creative_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        ad: {
          ...readback.ad,
          creative: { ...readback.ad.creative, file_id: "different-file" },
        },
      },
    }).code,
    "ad_creative_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        ad: {
          ...readback.ad,
          creative: { ...readback.ad.creative, body: "" },
        },
      },
    }).code,
    "ad_creative_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: { ...readback.campaign, serving_issues: ["blocked"] },
      },
    }).code,
    "provider_serving_issue",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        campaign: {
          ...readback.campaign,
          serving_issues_observed: false,
        },
      },
    }).code,
    "provider_serving_issue",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        adGroup: {
          ...readback.adGroup,
          bidding_config: {
            ...readback.adGroup.bidding_config,
            strategy: "maximize_clicks",
          },
        },
      },
    }).code,
    "ad_group_bid_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        ad: {
          ...readback.ad,
          creative: { ...readback.ad.creative, price: "9.99" },
        },
      },
    }).code,
    "ad_creative_readback_mismatch",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        ad: { ...readback.ad, review_status: "in_review" },
      },
    }).code,
    "ad_in_review",
  );
  assert.equal(
    validate({
      readback: {
        ...readback,
        ad: { ...readback.ad, status: "active" },
      },
    }).code,
    "launch_status_readback_mismatch",
  );

  console.log("test-openai-ads-launch-safety: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
