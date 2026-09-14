import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-openai-launch-saga-"));

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

try {
  const safetySource = await readFile(
    join(root, "src/lib/openai-ads/launch-safety.ts"),
    "utf8",
  );
  let launchSource = await readFile(join(root, "src/lib/openai-ads/launch.ts"), "utf8");
  launchSource = launchSource
    .replace('import "server-only";\n', "")
    .replaceAll('"@/lib/openai-ads/client"', '"./client.mjs"')
    .replaceAll('"@/lib/openai-ads/connection"', '"./connection.mjs"')
    .replaceAll('"@/lib/openai-ads/input"', '"./input.mjs"')
    .replaceAll('"@/lib/openai-ads/env"', '"./env.mjs"')
    .replaceAll('"@/lib/openai-ads/launch-safety"', '"./launch-safety.mjs"')
    .replaceAll('"@/lib/supabase/admin"', '"./admin.mjs"');

  await Promise.all([
    writeFile(join(temporaryDirectory, "launch-safety.mjs"), transpile(safetySource)),
    writeFile(join(temporaryDirectory, "launch.mjs"), transpile(launchSource)),
    writeFile(join(temporaryDirectory, "input.mjs"), "export {};\n"),
    writeFile(
      join(temporaryDirectory, "state.mjs"),
      `export const harness = {
  row: null,
  clients: [],
  loadCalls: [],
  failUpdateField: null,
  claimMode: "normal",
  claimMutation: null,
  finishMode: "normal",
  tokenCounter: 0,
};
export function resetHarness() {
  harness.row = null;
  harness.clients = [];
  harness.loadCalls = [];
  harness.failUpdateField = null;
  harness.claimMode = "normal";
  harness.claimMutation = null;
  harness.finishMode = "normal";
  harness.tokenCounter = 0;
}
`,
    ),
    writeFile(
      join(temporaryDirectory, "client.mjs"),
      `export class OpenAIAdsApiError extends Error {
  constructor(input) {
    super(input.message);
    this.code = input.code ?? null;
    this.status = input.status;
  }
}
`,
    ),
    writeFile(
      join(temporaryDirectory, "connection.mjs"),
      `import { harness } from "./state.mjs";
export class OpenAIAdsServiceError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export async function loadOpenAIAdsClient(input) {
  harness.loadCalls.push(input);
  const client = harness.clients.length > 1 ? harness.clients.shift() : harness.clients[0];
  if (!client) throw new OpenAIAdsServiceError("no_test_client", 500, "No test client");
  return {
    client,
    connection: {
      user_id: input.userId ?? "user-1",
      platform_account_id: "remote-account-1",
    },
  };
}
`,
    ),
    writeFile(
      join(temporaryDirectory, "env.mjs"),
      `export function getOpenAIAdsEnv() {
  return { tokenEncryptionKey: "test-secret-with-sufficient-entropy" };
}
`,
    ),
    writeFile(
      join(temporaryDirectory, "admin.mjs"),
      `import { harness } from "./state.mjs";

function rowMatches(filters) {
  if (!harness.row) return false;
  return filters.every(({ kind, field, value }) => {
    if (kind === "eq") return harness.row[field] === value;
    if (kind === "in") return value.includes(harness.row[field]);
    return true;
  });
}

function query() {
  let action = "select";
  let values = null;
  const filters = [];
  let forcedError = null;
  const builder = {
    select() { return builder; },
    insert(input) {
      action = "insert";
      values = input;
      harness.row = {
        id: "launch-1",
        remote_campaign_id: null,
        remote_ad_group_id: null,
        remote_ad_id: null,
        remote_file_id: null,
        review_status: null,
        operation_token: null,
        operation_started_at: null,
        activated_at: null,
        error_code: null,
        updated_at: new Date().toISOString(),
        ...input,
      };
      return builder;
    },
    update(input) {
      action = "update";
      values = input;
      if (
        harness.failUpdateField &&
        Object.prototype.hasOwnProperty.call(input, harness.failUpdateField)
      ) {
        forcedError = { code: "test_update_failed" };
        harness.failUpdateField = null;
      }
      return builder;
    },
    eq(field, value) { filters.push({ kind: "eq", field, value }); return builder; },
    in(field, value) { filters.push({ kind: "in", field, value }); return builder; },
    lt(field, value) { filters.push({ kind: "lt", field, value }); return builder; },
    order() { return builder; },
    range() { return builder; },
    limit() { return builder; },
    async maybeSingle() {
      if (forcedError) return { data: null, error: forcedError };
      if (action === "update" && rowMatches(filters)) {
        Object.assign(harness.row, values);
      }
      return { data: rowMatches(filters) ? { ...harness.row } : null, error: null };
    },
    async single() {
      if (forcedError) return { data: null, error: forcedError };
      if (action === "update" && rowMatches(filters)) Object.assign(harness.row, values);
      return { data: harness.row ? { ...harness.row } : null, error: null };
    },
    then(resolve, reject) {
      const result = action === "select"
        ? { data: rowMatches(filters) ? [{ ...harness.row }] : [], error: null }
        : action === "update" && rowMatches(filters)
          ? (Object.assign(harness.row, values), { data: { ...harness.row }, error: null })
          : { data: null, error: forcedError };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

export function createAdminClient() {
  return {
    from() { return query(); },
    async rpc(name, args) {
      if (name === "claim_openai_ads_launch_operation") {
        if (harness.claimMutation) {
          Object.assign(harness.row, harness.claimMutation);
          harness.claimMutation = null;
        }
        if (harness.claimMode === "none" || !harness.row) return { data: null, error: null };
        const sameTarget = harness.row.status === args.p_to_status;
        const permitted = args.p_from_statuses.includes(harness.row.status) || sameTarget;
        if (!permitted || (sameTarget && harness.row.operation_token)) {
          return { data: null, error: null };
        }
        harness.tokenCounter += 1;
        Object.assign(harness.row, {
          status: args.p_to_status,
          operation_token: "token-" + harness.tokenCounter,
          operation_started_at: new Date().toISOString(),
          error_code: null,
        });
        return { data: [{ ...harness.row }], error: null };
      }
      if (name === "finish_openai_ads_launch_operation") {
        if (harness.finishMode === "none") return { data: false, error: null };
        if (!harness.row || harness.row.operation_token !== args.p_operation_token) {
          return { data: false, error: null };
        }
        Object.assign(harness.row, args.p_values, {
          operation_token: null,
          operation_started_at: null,
          updated_at: new Date().toISOString(),
        });
        return { data: true, error: null };
      }
      throw new Error("Unexpected RPC " + name);
    },
  };
}
`,
    ),
  ]);

  const launch = await import(pathToFileURL(join(temporaryDirectory, "launch.mjs")).href);
  const { OpenAIAdsApiError } = await import(
    pathToFileURL(join(temporaryDirectory, "client.mjs")).href
  );
  const safety = await import(
    pathToFileURL(join(temporaryDirectory, "launch-safety.mjs")).href
  );
  const { harness, resetHarness } = await import(
    pathToFileURL(join(temporaryDirectory, "state.mjs")).href
  );

  const contract = {
    contractVersion: safety.OPENAI_ADS_LAUNCH_CONTRACT,
    remoteAccountId: "remote-account-1",
    currency: "EUR",
    accountTimezone: "Europe/Berlin",
    campaignName: "Campaign [adbot:fixture]",
    campaignDescription: "Description",
    biddingType: "clicks",
    billingEventType: "click",
    dailyBudgetMicros: 25_000_000,
    maxBidMicros: 2_000_000,
    startTime: null,
    endTime: null,
    locationIds: ["DE"],
    adGroupName: "Group [adbot:fixture]",
    contextHints: ["hotel"],
    adName: "Ad [adbot:fixture]",
    title: "Title",
    body: "Body",
    targetUrl: "https://example.com/",
    imageUrl: "https://example.com/image.jpg",
  };

  const row = (overrides = {}) => ({
    id: "launch-1",
    user_id: "user-1",
    platform_account_id: "account-1",
    platform: "openai_ads",
    status: "ready_to_activate",
    idempotency_key: "fixture-key",
    request_payload: contract,
    remote_campaign_id: "campaign-1",
    remote_ad_group_id: "group-1",
    remote_ad_id: "ad-1",
    remote_file_id: "file-1",
    review_status: "approved",
    operation_token: null,
    operation_started_at: null,
    activated_at: null,
    error_code: null,
    updated_at: new Date(0).toISOString(),
    ...overrides,
  });

  function provider(options = {}) {
    const state = {
      campaignStatus: options.campaignStatus ?? "paused",
      groupStatus: options.groupStatus ?? "paused",
      adStatus: options.adStatus ?? "paused",
      previewBody: options.previewBody ?? "<html><body>Preview A</body></html>",
      calls: [],
      postReadFailure: options.postReadFailure ?? false,
      postReadFailureConsumed: false,
      activated: false,
    };
    const account = {
      id: "remote-account-1",
      name: "Account",
      url: "https://ads.openai.com/account",
      preview_url: null,
      status: "active",
      timezone: "Europe/Berlin",
      currency_code: "EUR",
      review: { status: "approved" },
      account_integrity_review: options.integrityStatus
        ? { review: { status: options.integrityStatus }, details: null }
        : null,
    };
    const campaign = () => ({
      id: "campaign-1",
      name: contract.campaignName,
      description: contract.campaignDescription,
      status: state.campaignStatus,
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
    });
    const group = () => ({
      id: "group-1",
      name: contract.adGroupName,
      description: contract.campaignDescription,
      status: state.groupStatus,
      context_hints: ["hotel"],
      product_set: null,
      landing_page_configuration: null,
      bidding_config: {
        billing_event_type: "click",
        strategy: "fixed_bid",
        max_bid_micros: 2_000_000,
        custom_audience_bid_multipliers: [],
      },
      serving_issues: [],
      serving_issues_observed: true,
    });
    const ad = () => ({
      id: "ad-1",
      name: contract.adName,
      status: state.adStatus,
      review_status: options.reviewStatus ?? "approved",
      creative: {
        type: "chat_card",
        title: "Title",
        body: "Body",
        price: null,
        file_id: "file-1",
        image_crop: null,
        target_url: "https://example.com/",
      },
      landing_page_configuration: null,
      serving_issues: [],
      serving_issues_observed: true,
    });
    const maybeFailPostRead = () => {
      if (state.postReadFailure && state.activated && !state.postReadFailureConsumed) {
        state.postReadFailureConsumed = true;
        throw new Error("lost provider response after ACTIVE");
      }
    };
    const client = {
      state,
      async getAdAccount() { state.calls.push("getAccount"); return account; },
      async getCampaign() { state.calls.push("getCampaign"); maybeFailPostRead(); return campaign(); },
      async getAdGroup() { state.calls.push("getAdGroup"); return group(); },
      async getAd() { state.calls.push("getAd"); return ad(); },
      async listAdGroups() { state.calls.push("listAdGroups"); return [group()]; },
      async listAds() { state.calls.push("listAds"); return [ad()]; },
      async previewAd() { state.calls.push("previewAd"); return { bodies: [state.previewBody] }; },
      async activateAd() { state.calls.push("activateAd"); state.adStatus = "active"; state.activated = true; return ad(); },
      async activateAdGroup() { state.calls.push("activateAdGroup"); state.groupStatus = "active"; state.activated = true; return group(); },
      async activateCampaign() { state.calls.push("activateCampaign"); state.campaignStatus = "active"; state.activated = true; return campaign(); },
      async pauseAd() { state.calls.push("pauseAd"); state.adStatus = "paused"; return ad(); },
      async pauseAdGroup() { state.calls.push("pauseAdGroup"); state.groupStatus = "paused"; return group(); },
      async pauseCampaign() { state.calls.push("pauseCampaign"); state.campaignStatus = "paused"; return campaign(); },
    };
    return client;
  }

  const issueToken = (previewBody = "<html><body>Preview A</body></html>") =>
    safety.issueOpenAIAdsActivationPreviewToken({
      secret: "test-secret-with-sufficient-entropy",
      userId: "user-1",
      launchId: "launch-1",
      remoteAccountId: contract.remoteAccountId,
      campaignId: "campaign-1",
      adGroupId: "group-1",
      adId: "ad-1",
      budget: { currency: "EUR", dailyBudgetMicros: 25_000_000 },
      contractHash: safety.openAIAdsLaunchContractHash(contract),
      providerPreviewHash: safety.openAIAdsProviderPreviewHash([previewBody]),
    });

  // Provider returned a campaign ID, but the DB write failed. The ID remains in
  // the saga, a separate safety client pauses it, and the final CAS stores it.
  resetHarness();
  const createProvider = provider();
  createProvider.uploadImageUrl = async () => {
    createProvider.state.calls.push("uploadImage");
    return "file-1";
  };
  createProvider.createCampaign = async (payload) => {
    createProvider.state.calls.push("createCampaign");
    assert.equal(payload.status, "paused");
    return { id: "campaign-1", status: "paused" };
  };
  createProvider.createAdGroup = async () => {
    throw new Error("must not create ad group after failed campaign persistence");
  };
  createProvider.createAd = async () => {
    throw new Error("must not create ad after failed campaign persistence");
  };
  harness.clients = [createProvider, createProvider];
  harness.failUpdateField = "remote_campaign_id";
  const command = {
    platformAccountId: "account-1",
    campaignName: "Campaign",
    campaignDescription: "Description",
    biddingType: "clicks",
    billingEventType: "click",
    dailyBudgetMicros: 25_000_000,
    maxBidMicros: 2_000_000,
    startDate: null,
    endDate: null,
    locationIds: ["DE"],
    adGroupName: "Group",
    contextHints: ["hotel"],
    adName: "Ad",
    title: "Title",
    body: "Body",
    targetUrl: "https://example.com/",
    imageUrl: "https://example.com/image.jpg",
  };
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "launch_claim_lost",
  );
  assert.equal(harness.row.status, "failed");
  assert.equal(harness.row.remote_campaign_id, "campaign-1");
  assert.equal(createProvider.state.campaignStatus, "paused");
  assert.ok(createProvider.state.calls.includes("pauseCampaign"));
  assert.ok(!createProvider.state.calls.includes("activateCampaign"));
  assert.equal(harness.loadCalls.length, 2);
  assert.ok(harness.loadCalls[0].deadlineAtMs - Date.now() <= 120_000);
  assert.ok(harness.loadCalls[1].deadlineAtMs - Date.now() <= 45_000);

  resetHarness();
  const integrityPendingProvider = provider({ integrityStatus: "in_review" });
  harness.clients = [integrityPendingProvider];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "account_integrity_review_required",
  );
  assert.ok(
    !integrityPendingProvider.state.calls.some((call) =>
      call.startsWith("create"),
    ),
  );

  resetHarness();
  const exhaustedMainProvider = provider();
  exhaustedMainProvider.uploadImageUrl = async () => "file-1";
  exhaustedMainProvider.createCampaign = async () => ({
    id: "campaign-1",
    status: "paused",
  });
  exhaustedMainProvider.getCampaign = async () => {
    throw new OpenAIAdsApiError({
      message: "main deadline exhausted",
      status: 503,
      code: "sync_deadline_exceeded",
    });
  };
  const reservedSafetyProvider = provider();
  harness.clients = [exhaustedMainProvider, reservedSafetyProvider];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "sync_deadline_exceeded",
  );
  assert.equal(harness.row.status, "failed");
  assert.equal(reservedSafetyProvider.state.campaignStatus, "paused");
  assert.equal(harness.loadCalls.length, 2);
  assert.ok(harness.loadCalls[1].deadlineAtMs - Date.now() <= 45_000);

  resetHarness();
  const successfulCreateProvider = provider();
  let createdCampaignPayload;
  let createdGroupPayload;
  let createdAdPayload;
  successfulCreateProvider.uploadImageUrl = async () => {
    successfulCreateProvider.state.calls.push("uploadImage");
    return "file-1";
  };
  successfulCreateProvider.createCampaign = async (payload) => {
    successfulCreateProvider.state.calls.push("createCampaign");
    assert.equal(payload.status, "paused");
    createdCampaignPayload = payload;
    return { id: "campaign-1", status: "paused" };
  };
  successfulCreateProvider.getCampaign = async (id) => {
    successfulCreateProvider.state.calls.push("getCampaign");
    assert.equal(id, "campaign-1");
    return {
      id,
      name: createdCampaignPayload.name,
      description: createdCampaignPayload.description,
      status: "paused",
      bidding_type: createdCampaignPayload.bidding_type,
      budget: {
        ...createdCampaignPayload.budget,
        lifetime_spend_limit_micros_present: false,
      },
      start_time: createdCampaignPayload.start_time ?? null,
      end_time: createdCampaignPayload.end_time ?? null,
      targeting: createdCampaignPayload.targeting,
      product_feed_id: null,
      landing_page_configuration: null,
      serving_issues: [],
      serving_issues_observed: true,
    };
  };
  successfulCreateProvider.createAdGroup = async (payload) => {
    successfulCreateProvider.state.calls.push("createAdGroup");
    assert.equal(payload.status, "paused");
    assert.equal(payload.campaign_id, "campaign-1");
    createdGroupPayload = payload;
    return { id: "group-1", status: "paused" };
  };
  successfulCreateProvider.getAdGroup = async (id) => {
    successfulCreateProvider.state.calls.push("getAdGroup");
    assert.equal(id, "group-1");
    return {
      id,
      name: createdGroupPayload.name,
      description: createdGroupPayload.description,
      status: "paused",
      context_hints: createdGroupPayload.context_hints,
      product_set: null,
      landing_page_configuration: null,
      bidding_config: createdGroupPayload.bidding_config,
      serving_issues: [],
      serving_issues_observed: true,
    };
  };
  successfulCreateProvider.createAd = async (payload) => {
    successfulCreateProvider.state.calls.push("createAd");
    assert.equal(payload.status, "paused");
    assert.equal(payload.ad_group_id, "group-1");
    createdAdPayload = payload;
    return { id: "ad-1", status: "paused", review_status: "approved" };
  };
  successfulCreateProvider.getAd = async (id) => {
    successfulCreateProvider.state.calls.push("getAd");
    assert.equal(id, "ad-1");
    return {
      id,
      name: createdAdPayload.name,
      status: "paused",
      review_status: "approved",
      creative: createdAdPayload.creative,
      landing_page_configuration: null,
      serving_issues: [],
      serving_issues_observed: true,
    };
  };
  successfulCreateProvider.listAdGroups = async () => {
    successfulCreateProvider.state.calls.push("listAdGroups");
    return [await successfulCreateProvider.getAdGroup("group-1")];
  };
  successfulCreateProvider.listAds = async () => {
    successfulCreateProvider.state.calls.push("listAds");
    return [await successfulCreateProvider.getAd("ad-1")];
  };
  harness.clients = [successfulCreateProvider];
  const successfulCreate = await launch.createPausedOpenAIAdsLaunch({
    userId: "user-1",
    command,
  });
  assert.equal(successfulCreate.status, "ready_to_activate");
  assert.equal(harness.row.status, "ready_to_activate");
  const successfulCreateCalls = successfulCreateProvider.state.calls;
  assert.ok(
    successfulCreateCalls.indexOf("createCampaign") <
      successfulCreateCalls.indexOf("getCampaign") &&
      successfulCreateCalls.indexOf("getCampaign") <
        successfulCreateCalls.indexOf("createAdGroup") &&
      successfulCreateCalls.indexOf("createAdGroup") <
        successfulCreateCalls.indexOf("getAdGroup") &&
      successfulCreateCalls.indexOf("getAdGroup") <
        successfulCreateCalls.indexOf("createAd") &&
      successfulCreateCalls.indexOf("createAd") <
        successfulCreateCalls.indexOf("getAd"),
  );
  const replayRow = { ...harness.row };
  Object.assign(contract, replayRow.request_payload);

  resetHarness();
  harness.row = { ...replayRow };
  const validReadyReplayProvider = provider();
  harness.clients = [validReadyReplayProvider];
  const validReadyReplay = await launch.createPausedOpenAIAdsLaunch({
    userId: "user-1",
    command,
  });
  assert.equal(validReadyReplay.alreadyExisted, true);
  assert.equal(validReadyReplay.status, "ready_to_activate");
  assert.ok(
    !validReadyReplayProvider.state.calls.some((call) =>
      call.startsWith("create"),
    ),
  );

  for (const replayStatus of ["paused", "in_review"]) {
    resetHarness();
    harness.row = { ...replayRow, status: replayStatus };
    const pendingReplayProvider = provider({ reviewStatus: "in_review" });
    harness.clients = [pendingReplayProvider];
    const pendingReplay = await launch.createPausedOpenAIAdsLaunch({
      userId: "user-1",
      command,
    });
    assert.equal(pendingReplay.alreadyExisted, true);
    assert.equal(pendingReplay.status, "in_review");
  }

  resetHarness();
  harness.row = { ...replayRow, status: "in_review" };
  const rejectedReplayProvider = provider({ reviewStatus: "rejected" });
  harness.clients = [rejectedReplayProvider];
  const rejectedReplay = await launch.createPausedOpenAIAdsLaunch({
    userId: "user-1",
    command,
  });
  assert.equal(rejectedReplay.alreadyExisted, true);
  assert.equal(rejectedReplay.status, "blocked");

  resetHarness();
  harness.row = { ...replayRow, status: "blocked" };
  const blockedReplayProvider = provider({ reviewStatus: "rejected" });
  harness.clients = [blockedReplayProvider];
  const blockedReplay = await launch.createPausedOpenAIAdsLaunch({
    userId: "user-1",
    command,
  });
  assert.equal(blockedReplay.alreadyExisted, true);
  assert.equal(blockedReplay.status, "blocked");

  resetHarness();
  harness.row = { ...replayRow, status: "blocked" };
  const blockedDriftProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
    reviewStatus: "rejected",
  });
  const blockedDriftSafety = provider({ reviewStatus: "rejected" });
  harness.clients = [blockedDriftProvider, blockedDriftSafety];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "launch_status_readback_mismatch",
  );
  assert.equal(harness.row.status, "failed");
  assert.equal(blockedDriftSafety.state.campaignStatus, "paused");

  resetHarness();
  harness.row = { ...replayRow };
  const activeDriftReplayProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  const activeDriftReplaySafety = provider();
  harness.clients = [activeDriftReplayProvider, activeDriftReplaySafety];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "launch_status_readback_mismatch",
  );
  assert.equal(harness.row.status, "failed");
  assert.equal(activeDriftReplaySafety.state.campaignStatus, "paused");

  resetHarness();
  harness.row = { ...replayRow };
  const foreignReadyReplayProvider = provider();
  const originalReadyReplayGetCampaign =
    foreignReadyReplayProvider.getCampaign.bind(foreignReadyReplayProvider);
  foreignReadyReplayProvider.getCampaign = async (...args) => ({
    ...(await originalReadyReplayGetCampaign(...args)),
    id: "foreign-campaign",
  });
  const foreignReadyReplaySafety = provider();
  const originalReadySafetyGetCampaign =
    foreignReadyReplaySafety.getCampaign.bind(foreignReadyReplaySafety);
  foreignReadyReplaySafety.getCampaign = async (...args) => ({
    ...(await originalReadySafetyGetCampaign(...args)),
    id: "foreign-campaign",
  });
  harness.clients = [foreignReadyReplayProvider, foreignReadyReplaySafety];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "activation_uncertain_manual_check_required",
  );
  assert.equal(harness.row.status, "activation_uncertain");

  resetHarness();
  harness.row = { ...replayRow, status: "active" };
  const validActiveReplayProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  harness.clients = [validActiveReplayProvider];
  const validActiveReplay = await launch.createPausedOpenAIAdsLaunch({
    userId: "user-1",
    command,
  });
  assert.equal(validActiveReplay.alreadyExisted, true);
  assert.equal(validActiveReplay.status, "active");

  resetHarness();
  harness.row = { ...replayRow, status: "active" };
  const driftedActiveReplayProvider = provider({
    campaignStatus: "active",
    groupStatus: "paused",
    adStatus: "active",
  });
  const driftedActiveReplaySafety = provider();
  harness.clients = [driftedActiveReplayProvider, driftedActiveReplaySafety];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "launch_status_readback_mismatch",
  );
  assert.equal(harness.row.status, "failed");

  // The ad-group request may have succeeded remotely before its HTTP response
  // was lost. Pausing the known campaign is necessary but not sufficient proof.
  resetHarness();
  const unknownChildProvider = provider();
  unknownChildProvider.uploadImageUrl = async () => "file-1";
  unknownChildProvider.createCampaign = async () => ({
    id: "campaign-1",
    status: "paused",
  });
  unknownChildProvider.createAdGroup = async () => {
    throw new Error("provider timeout after unknown ad-group create outcome");
  };
  unknownChildProvider.createAd = async () => {
    throw new Error("must not create ad after unknown ad-group outcome");
  };
  harness.clients = [unknownChildProvider, unknownChildProvider];
  await assert.rejects(
    () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
    (error) => error?.code === "activation_uncertain_manual_check_required",
  );
  assert.equal(harness.row.status, "activation_uncertain");
  assert.equal(harness.row.remote_campaign_id, "campaign-1");
  assert.equal(harness.row.remote_ad_group_id, null);
  assert.ok(unknownChildProvider.state.calls.includes("pauseCampaign"));

  for (const activeLevel of ["campaign", "ad_group", "ad"]) {
    resetHarness();
    const unexpectedActiveProvider = provider();
    unexpectedActiveProvider.uploadImageUrl = async () => "file-1";
    unexpectedActiveProvider.createCampaign = async () => {
      const status = activeLevel === "campaign" ? "active" : "paused";
      unexpectedActiveProvider.state.campaignStatus = status;
      return { id: "campaign-1", status };
    };
    unexpectedActiveProvider.createAdGroup = async () => {
      const status = activeLevel === "ad_group" ? "active" : "paused";
      unexpectedActiveProvider.state.groupStatus = status;
      return { id: "group-1", status };
    };
    unexpectedActiveProvider.createAd = async () => {
      const status = activeLevel === "ad" ? "active" : "paused";
      unexpectedActiveProvider.state.adStatus = status;
      return { id: "ad-1", status, review_status: "approved" };
    };
    harness.clients = [unexpectedActiveProvider, unexpectedActiveProvider];
    await assert.rejects(
      () => launch.createPausedOpenAIAdsLaunch({ userId: "user-1", command }),
      (error) => error?.code === `${activeLevel}_create_not_paused`,
    );
    assert.equal(harness.row.status, "failed");
    assert.equal(unexpectedActiveProvider.state.campaignStatus, "paused");
    assert.equal(unexpectedActiveProvider.state.groupStatus, "paused");
    assert.equal(unexpectedActiveProvider.state.adStatus, "paused");
  }

  // Full success: real preview -> signed token -> fresh preview -> ACTIVE chain -> read-back.
  resetHarness();
  harness.row = row();
  const successProvider = provider();
  harness.clients = [successProvider];
  const preview = await launch.previewOpenAIAdsActivation({ userId: "user-1", launchId: "launch-1" });
  assert.deepEqual(preview.providerPreviewBodies, ["<html><body>Preview A</body></html>"]);
  const success = await launch.activateOpenAIAdsLaunch({
    userId: "user-1",
    launchId: "launch-1",
    previewToken: preview.previewToken,
  });
  assert.deepEqual(success, { status: "active", alreadyActive: false });
  assert.equal(harness.row.status, "active");
  assert.ok(successProvider.state.calls.indexOf("previewAd") < successProvider.state.calls.indexOf("activateAd"));
  assert.ok(successProvider.state.calls.indexOf("activateAd") < successProvider.state.calls.indexOf("activateCampaign"));

  // Lost HTTP response replay: ACTIVE is freshly read and no second write occurs, even with an expired/garbage token.
  const activationWritesBeforeReplay = successProvider.state.calls.filter((call) => call.startsWith("activate")).length;
  const replay = await launch.activateOpenAIAdsLaunch({
    userId: "user-1",
    launchId: "launch-1",
    previewToken: "expired-token",
  });
  assert.deepEqual(replay, { status: "active", alreadyActive: true });
  assert.equal(
    successProvider.state.calls.filter((call) => call.startsWith("activate")).length,
    activationWritesBeforeReplay,
  );

  // A later replay that observes partial ACTIVE drift contains it instead of only reporting an error.
  successProvider.state.groupStatus = "paused";
  await assert.rejects(
    () =>
      launch.activateOpenAIAdsLaunch({
        userId: "user-1",
        launchId: "launch-1",
        previewToken: "expired-token",
      }),
    (error) => error?.code === "active_replay_drift_safely_paused",
  );
  assert.equal(harness.row.status, "failed");
  assert.equal(successProvider.state.campaignStatus, "paused");

  // The provider preview changed after user review: no ACTIVE or safety write; return to READY.
  resetHarness();
  harness.row = row();
  const previewDriftProvider = provider({ previewBody: "<html><body>Preview B</body></html>" });
  harness.clients = [previewDriftProvider];
  await assert.rejects(
    () =>
      launch.activateOpenAIAdsLaunch({
        userId: "user-1",
        launchId: "launch-1",
        previewToken: issueToken(),
      }),
    (error) => error?.code === "provider_preview_changed",
  );
  assert.equal(harness.row.status, "ready_to_activate");
  assert.ok(!previewDriftProvider.state.calls.some((call) => call.startsWith("activate")));
  assert.ok(!previewDriftProvider.state.calls.some((call) => call.startsWith("pause")));

  // A provider preview failure cannot issue a token and never writes ACTIVE.
  resetHarness();
  harness.row = row();
  const previewFailureProvider = provider();
  previewFailureProvider.previewAd = async () => {
    previewFailureProvider.state.calls.push("previewAd");
    throw new Error("provider preview unavailable");
  };
  harness.clients = [previewFailureProvider];
  await assert.rejects(() =>
    launch.previewOpenAIAdsActivation({ userId: "user-1", launchId: "launch-1" }),
  );
  assert.equal(harness.row.status, "ready_to_activate");
  assert.ok(!previewFailureProvider.state.calls.some((call) => call.startsWith("activate")));

  for (const previewDrift of ["active", "foreign_id"]) {
    resetHarness();
    harness.row = row();
    const unsafePreviewProvider = provider({
      campaignStatus: previewDrift === "active" ? "active" : "paused",
    });
    if (previewDrift === "foreign_id") {
      const originalUnsafePreviewGetCampaign =
        unsafePreviewProvider.getCampaign.bind(unsafePreviewProvider);
      unsafePreviewProvider.getCampaign = async (...args) => ({
        ...(await originalUnsafePreviewGetCampaign(...args)),
        id: "foreign-campaign",
      });
    }
    harness.clients = [unsafePreviewProvider];
    await assert.rejects(() =>
      launch.previewOpenAIAdsActivation({
        userId: "user-1",
        launchId: "launch-1",
      }),
    );
    assert.ok(!unsafePreviewProvider.state.calls.includes("previewAd"));
  }

  // A fresh preview failure after the activation claim is safety-paused, never activated.
  resetHarness();
  harness.row = row();
  const prewritePreviewFailureProvider = provider();
  prewritePreviewFailureProvider.previewAd = async () => {
    prewritePreviewFailureProvider.state.calls.push("previewAd");
    throw new Error("provider preview unavailable");
  };
  const prewritePreviewSafetyProvider = provider();
  harness.clients = [prewritePreviewFailureProvider, prewritePreviewSafetyProvider];
  await assert.rejects(() =>
    launch.activateOpenAIAdsLaunch({
      userId: "user-1",
      launchId: "launch-1",
      previewToken: issueToken(),
    }),
  );
  assert.ok(["failed", "blocked"].includes(harness.row.status));
  assert.ok(
    !prewritePreviewFailureProvider.state.calls.some((call) =>
      call.startsWith("activate"),
    ),
  );
  assert.equal(prewritePreviewSafetyProvider.state.campaignStatus, "paused");

  resetHarness();
  harness.row = row();
  const foreignPrecheckProvider = provider();
  const originalForeignPrecheckGetCampaign =
    foreignPrecheckProvider.getCampaign.bind(foreignPrecheckProvider);
  foreignPrecheckProvider.getCampaign = async (...args) => ({
    ...(await originalForeignPrecheckGetCampaign(...args)),
    id: "foreign-campaign",
  });
  const foreignPrecheckSafety = provider();
  const originalForeignPrecheckSafetyGetCampaign =
    foreignPrecheckSafety.getCampaign.bind(foreignPrecheckSafety);
  foreignPrecheckSafety.getCampaign = async (...args) => ({
    ...(await originalForeignPrecheckSafetyGetCampaign(...args)),
    id: "foreign-campaign",
  });
  harness.clients = [foreignPrecheckProvider, foreignPrecheckSafety];
  await assert.rejects(
    () =>
      launch.activateOpenAIAdsLaunch({
        userId: "user-1",
        launchId: "launch-1",
        previewToken: issueToken(),
      }),
    (error) => error?.code === "activation_uncertain_manual_check_required",
  );
  assert.equal(harness.row.status, "activation_uncertain");
  assert.ok(
    !foreignPrecheckProvider.state.calls.some((call) =>
      call.startsWith("activate"),
    ),
  );

  // ACTIVE drift immediately before writes is synchronously safety-paused and never activated again.
  resetHarness();
  harness.row = row();
  const prewriteDriftProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  harness.clients = [prewriteDriftProvider, prewriteDriftProvider];
  await assert.rejects(
    () =>
      launch.activateOpenAIAdsLaunch({
        userId: "user-1",
        launchId: "launch-1",
        previewToken: issueToken(),
      }),
    (error) => error?.code === "launch_status_readback_mismatch",
  );
  assert.equal(harness.row.status, "blocked");
  assert.equal(prewriteDriftProvider.state.campaignStatus, "paused");
  assert.ok(!prewriteDriftProvider.state.calls.some((call) => call.startsWith("activate")));

  // Provider response is lost after ACTIVE: a separate safety client pauses and final CAS is fail-closed.
  resetHarness();
  harness.row = row();
  const postwriteFailureProvider = provider({ postReadFailure: true });
  harness.clients = [postwriteFailureProvider, postwriteFailureProvider];
  await assert.rejects(() =>
    launch.activateOpenAIAdsLaunch({
      userId: "user-1",
      launchId: "launch-1",
      previewToken: issueToken(),
    }),
  );
  assert.equal(harness.row.status, "failed");
  assert.equal(postwriteFailureProvider.state.campaignStatus, "paused");
  assert.equal(postwriteFailureProvider.state.groupStatus, "paused");
  assert.equal(postwriteFailureProvider.state.adStatus, "paused");

  // A parallel claimant wins between initial read and claim: this request performs no provider write.
  resetHarness();
  harness.row = row();
  const concurrentProvider = provider();
  harness.clients = [concurrentProvider];
  harness.claimMode = "none";
  harness.claimMutation = { status: "activating", operation_token: "other-worker" };
  await assert.rejects(
    () =>
      launch.activateOpenAIAdsLaunch({
        userId: "user-1",
        launchId: "launch-1",
        previewToken: issueToken(),
      }),
    (error) => error?.code === "activation_not_available",
  );
  assert.equal(concurrentProvider.state.calls.length, 0);

  // A remote ID disappears in the claim race: known ancestors are paused, but status remains uncertain.
  resetHarness();
  harness.row = row();
  const missingIdProvider = provider();
  harness.clients = [missingIdProvider, missingIdProvider];
  harness.claimMutation = { remote_ad_id: null };
  await assert.rejects(
    () =>
      launch.activateOpenAIAdsLaunch({
        userId: "user-1",
        launchId: "launch-1",
        previewToken: issueToken(),
      }),
    (error) => error?.code === "remote_chain_incomplete_manual_check_required",
  );
  assert.equal(harness.row.status, "activation_uncertain");
  assert.ok(missingIdProvider.state.calls.includes("pauseCampaign"));
  assert.ok(missingIdProvider.state.calls.includes("pauseAdGroup"));
  assert.ok(!missingIdProvider.state.calls.includes("pauseAd"));

  // Snapshot-detected ACTIVE drift is contained immediately, without waiting for staleness.
  resetHarness();
  harness.row = row({
    status: "activation_uncertain",
    error_code: "snapshot_launch_contract_not_verified",
    updated_at: new Date().toISOString(),
  });
  const snapshotDriftProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  harness.clients = [snapshotDriftProvider];
  const contained = await launch.containUncertainOpenAIAdsLaunchesForAccount({
    platformAccountId: "account-1",
    expectedCount: 1,
  });
  assert.deepEqual(contained, { scanned: 1, safelyPaused: 1, uncertain: 0 });
  assert.equal(harness.row.status, "failed");
  assert.equal(snapshotDriftProvider.state.campaignStatus, "paused");

  resetHarness();
  harness.row = row({
    status: "activation_uncertain",
    error_code: "snapshot_launch_contract_not_verified",
    updated_at: new Date().toISOString(),
  });
  const wrongIdentityProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  const originalGetCampaign = wrongIdentityProvider.getCampaign.bind(
    wrongIdentityProvider,
  );
  wrongIdentityProvider.getCampaign = async (...args) => ({
    ...(await originalGetCampaign(...args)),
    id: "different-campaign",
    status: "paused",
  });
  harness.clients = [wrongIdentityProvider];
  const wrongIdentityContainment =
    await launch.containUncertainOpenAIAdsLaunchesForAccount({
      platformAccountId: "account-1",
      expectedCount: 1,
    });
  assert.deepEqual(wrongIdentityContainment, {
    scanned: 1,
    safelyPaused: 0,
    uncertain: 1,
  });
  assert.equal(harness.row.status, "activation_uncertain");

  resetHarness();
  harness.row = row({
    status: "activation_uncertain",
    error_code: "snapshot_launch_contract_not_verified",
    remote_ad_id: null,
    updated_at: new Date().toISOString(),
  });
  const incompleteSnapshotProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
  });
  harness.clients = [incompleteSnapshotProvider];
  const incompleteContainment =
    await launch.containUncertainOpenAIAdsLaunchesForAccount({
      platformAccountId: "account-1",
      expectedCount: 1,
    });
  assert.deepEqual(incompleteContainment, {
    scanned: 1,
    safelyPaused: 0,
    uncertain: 1,
  });
  assert.equal(harness.row.status, "activation_uncertain");

  // Periodic control-plane verification contains ACTIVE drift before reporting.
  resetHarness();
  harness.row = row({ status: "active" });
  const periodicDriftProvider = provider({
    campaignStatus: "active",
    groupStatus: "paused",
    adStatus: "active",
  });
  const [periodicAccount, periodicCampaign, periodicGroup, periodicAd] =
    await Promise.all([
      periodicDriftProvider.getAdAccount(),
      periodicDriftProvider.getCampaign(),
      periodicDriftProvider.getAdGroup(),
      periodicDriftProvider.getAd(),
    ]);
  harness.clients = [periodicDriftProvider];
  const periodicControl = await launch.reconcileOpenAIAdsLaunchControlPlane({
    platformAccountId: "account-1",
    account: periodicAccount,
    campaigns: [periodicCampaign],
    adGroups: [{ campaignId: "campaign-1", item: periodicGroup }],
    ads: [{ adGroupId: "group-1", item: periodicAd }],
  });
  assert.deepEqual(periodicControl, {
    scanned: 1,
    safelyPaused: 1,
    uncertain: 0,
  });
  assert.equal(harness.row.status, "failed");
  assert.equal(periodicDriftProvider.state.campaignStatus, "paused");

  // A stale worker is reclaimed, safety-paused, and completed fail-closed.
  resetHarness();
  harness.row = row({
    status: "activating",
    operation_token: null,
    operation_started_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });
  const staleProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  harness.clients = [staleProvider];
  const recovered = await launch.recoverStaleOpenAIAdsLaunchOperations(1);
  assert.deepEqual(recovered, { scanned: 1, safelyPaused: 1, uncertain: 0 });
  assert.equal(harness.row.status, "failed");
  assert.equal(staleProvider.state.campaignStatus, "paused");

  resetHarness();
  harness.row = row({
    status: "activating",
    operation_token: null,
    operation_started_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });
  const staleFinishFailureProvider = provider({
    campaignStatus: "active",
    groupStatus: "active",
    adStatus: "active",
  });
  harness.clients = [staleFinishFailureProvider];
  harness.finishMode = "none";
  const staleFinishFailure =
    await launch.recoverStaleOpenAIAdsLaunchOperations(1);
  assert.deepEqual(staleFinishFailure, {
    scanned: 1,
    safelyPaused: 0,
    uncertain: 1,
  });
  assert.equal(harness.row.status, "activating");
  assert.equal(staleFinishFailureProvider.state.campaignStatus, "paused");

  for (const staleStatus of ["creating", "activation_uncertain"]) {
    resetHarness();
    harness.row = row({
      status: staleStatus,
      operation_token: null,
      operation_started_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    });
    const fullStaleProvider = provider({
      campaignStatus: "active",
      groupStatus: "active",
      adStatus: "active",
    });
    harness.clients = [fullStaleProvider];
    const fullStaleRecovery =
      await launch.recoverStaleOpenAIAdsLaunchOperations(1);
    assert.deepEqual(fullStaleRecovery, {
      scanned: 1,
      safelyPaused: 1,
      uncertain: 0,
    });
    assert.equal(harness.row.status, "failed");
  }

  for (const staleStatus of [
    "creating",
    "activating",
    "activation_uncertain",
  ]) {
    resetHarness();
    harness.row = row({
      status: staleStatus,
      remote_ad_id: null,
      operation_token: null,
      operation_started_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    });
    const incompleteStaleProvider = provider({
      campaignStatus: "active",
      groupStatus: "active",
    });
    harness.clients = [incompleteStaleProvider];
    const incompleteStaleRecovery =
      await launch.recoverStaleOpenAIAdsLaunchOperations(1);
    assert.deepEqual(incompleteStaleRecovery, {
      scanned: 1,
      safelyPaused: 0,
      uncertain: 1,
    });
    assert.equal(harness.row.status, "activation_uncertain");
  }

  console.log("test-openai-ads-launch-saga: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
