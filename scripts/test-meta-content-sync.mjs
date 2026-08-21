import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-sync-"));

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function isoOffset(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function connector(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    access_token_encrypted: "ciphertext",
    token_iv: "iv",
    token_auth_tag: "auth-tag",
    expires_at: isoOffset(3600),
    data_access_expires_at: isoOffset(7200),
    sync_lock_until: null,
    sync_backoff_until: null,
    last_sync_started_at: null,
    sync_consecutive_failures: 0,
    instagram_account_ids: ["178414000000001"],
    marketing_meta_ad_account_id: null,
    marketing_sync_id: "20000000-0000-4000-8000-000000000099",
    marketing_sync_status: "idle",
    marketing_sync_error_code: null,
    marketing_currency: "EUR",
    marketing_last_success_at: isoOffset(-60),
    ...overrides,
  };
}

function defaultAssets(baselineCompletedAt = null) {
  return [
    {
      id: "10000000-0000-4000-8000-000000000001",
      asset_type: "facebook_page",
      meta_asset_id: "page-1",
      parent_meta_asset_id: null,
      baseline_completed_at: baselineCompletedAt,
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      asset_type: "instagram_account",
      meta_asset_id: "178414000000001",
      parent_meta_asset_id: "page-1",
      baseline_completed_at: baselineCompletedAt,
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      asset_type: "instagram_account",
      meta_asset_id: "178414000000002",
      parent_meta_asset_id: "page-1",
      baseline_completed_at: baselineCompletedAt,
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      asset_type: "ad_account",
      meta_asset_id: "ad-account-1",
      parent_meta_asset_id: null,
      baseline_completed_at: null,
    },
  ];
}

function makeAdminHarness(input = {}) {
  const state = {
    connector: input.connector ?? connector(),
    assets: input.assets ?? defaultAssets(),
    dueRows: input.dueRows ?? [],
    claim: input.claim ?? true,
    recordNewCount: input.recordNewCount ?? 0,
    updates: [],
    rpcCalls: [],
  };

  function queryBuilder(table) {
    let operation = "select";
    let selectedColumns = "";
    let updateValues = null;

    const builder = {
      select(columns) {
        operation = "select";
        selectedColumns = columns;
        return builder;
      },
      update(values) {
        operation = "update";
        updateValues = values;
        return builder;
      },
      eq() {
        return builder;
      },
      is() {
        return builder;
      },
      neq() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        return { data: state.connector, error: null };
      },
      then(resolve, reject) {
        let result;

        if (operation === "update") {
          state.updates.push({ table, values: updateValues });
          result = { data: null, error: null };
        } else if (table === "meta_assets") {
          result = { data: state.assets, error: null };
        } else if (selectedColumns.includes("next_sync_at")) {
          result = { data: state.dueRows, error: null };
        } else {
          result = { data: [], error: null };
        }

        return Promise.resolve(result).then(resolve, reject);
      },
    };

    return builder;
  }

  const admin = {
    from(table) {
      return queryBuilder(table);
    },
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });

      if (name === "claim_meta_sync") {
        return { data: state.claim, error: null };
      }

      if (name === "record_meta_content_candidates") {
        const seenCount = Array.isArray(args.p_items) ? args.p_items.length : 0;
        return {
          data: [
            {
              seen_count: seenCount,
              inserted_count: seenCount,
              new_count: args.p_is_baseline ? 0 : state.recordNewCount,
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },
  };

  return { admin, state };
}

const syncSourcePath = join(projectRoot, "src/lib/meta/sync.ts");
const scheduleSourcePath = join(projectRoot, "src/lib/meta/schedule.ts");
const migrationPath = join(
  projectRoot,
  "supabase/migrations/20260727133000_meta_content_sync.sql",
);
const reconnectPersistenceMigrationPath = join(
  projectRoot,
  "supabase/migrations/20260729070000_preserve_meta_history_on_reconnect.sql",
);
const cronRoutePath = join(projectRoot, "src/app/api/cron/meta-sync/route.ts");
const manualRoutePath = join(
  projectRoot,
  "src/app/api/connectors/meta/sync/route.ts",
);
const envPath = join(projectRoot, "src/lib/meta/env.ts");
const vercelPath = join(projectRoot, "vercel.json");

try {
  const syncSource = (await readFile(syncSourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace(/import \{[\s\S]*?\} from "\.\/client";/, `import {
  getFacebookPublishedPosts,
  getInstagramMedia,
  getMetaPageAssets,
  mergeMetaUsage,
  MetaCollectionLimitError,
  MetaGraphError,
} from "./client.mjs";`)
    .replace('from "./crypto";', 'from "./crypto.mjs";')
    .replace('from "./env";', 'from "./env.mjs";')
    .replace('from "./marketing-sync";', 'from "./marketing-sync.mjs";')
    .replace('from "./organic-boost-ensure";', 'from "./organic-boost-ensure.mjs";')
    .replace('from "./organic-boost-runner";', 'from "./organic-boost-runner.mjs";')
    .replace('from "./planner";', 'from "./planner.mjs";')
    .replace('from "./executor";', 'from "./executor.mjs";')
    .replace('from "./schedule";', 'from "./schedule.mjs";')
    .replace('from "./ad-account";', 'from "./ad-account.mjs";')
    .replace('from "../supabase/admin";', 'from "./admin.mjs";');

  const scheduleSource = await readFile(scheduleSourcePath, "utf8");
  const adAccountSourcePath = join(projectRoot, "src/lib/meta/ad-account.ts");
  const adAccountSource = await readFile(adAccountSourcePath, "utf8");

  const clientStub = `
const emptyUsage = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
  adAccountPercent: null,
  insightsPercent: null,
  retryAfterSeconds: null,
};

function maximum(left, right) {
  const values = [left, right].filter((value) => typeof value === "number");
  return values.length ? Math.max(...values) : null;
}

export function mergeMetaUsage(left, right) {
  return {
    appPercent: maximum(left.appPercent, right.appPercent),
    pagePercent: maximum(left.pagePercent, right.pagePercent),
    businessPercent: maximum(left.businessPercent, right.businessPercent),
    adAccountPercent: maximum(left.adAccountPercent, right.adAccountPercent),
    insightsPercent: maximum(left.insightsPercent, right.insightsPercent),
    retryAfterSeconds: maximum(left.retryAfterSeconds, right.retryAfterSeconds),
  };
}

export class MetaCollectionLimitError extends Error {
  constructor(reason, usage = emptyUsage) {
    super(\`Meta collection could not be completed: \${reason}\`);
    this.reason = reason;
    this.usage = usage;
  }
}

export class MetaGraphError extends Error {
  constructor(status, body = {}, usage = emptyUsage) {
    super("Meta Graph API request failed");
    this.status = status;
    this.code = body.error?.code ?? null;
    this.subcode = body.error?.error_subcode ?? null;
    this.usage = usage;
  }

  get rateLimited() {
    return this.status === 429 || [4, 17, 32, 80001].includes(this.code);
  }

  get reconnectRequired() {
    return this.code === 190;
  }
}

export async function getMetaPageAssets(input) {
  globalThis.__metaTest.calls.push({ name: "getMetaPageAssets", input });
  if (globalThis.__metaTest.pageError) throw globalThis.__metaTest.pageError;
  return globalThis.__metaTest.pagesResult;
}

export async function getFacebookPublishedPosts(input) {
  globalThis.__metaTest.calls.push({ name: "getFacebookPublishedPosts", input });
  if (globalThis.__metaTest.facebookError) throw globalThis.__metaTest.facebookError;
  return globalThis.__metaTest.facebookResult;
}

export async function getInstagramMedia(input) {
  globalThis.__metaTest.calls.push({ name: "getInstagramMedia", input });
  if (globalThis.__metaTest.instagramError) throw globalThis.__metaTest.instagramError;
  return globalThis.__metaTest.instagramResult;
}
`;

  const marketingStub = `
export class MetaMarketingDataError extends Error {
  constructor(code) {
    super(\`Meta Marketing snapshot rejected: \${code}\`);
    this.code = code;
  }
}

export async function syncMetaMarketingSnapshot(input) {
  globalThis.__metaTest.calls.push({ name: "syncMetaMarketingSnapshot", input });
  if (globalThis.__metaTest.marketingError) throw globalThis.__metaTest.marketingError;
  return globalThis.__metaTest.marketingResult;
}
`;

  const plannerStub = `
export class MetaBudgetPlannerError extends Error {
  constructor(code) {
    super(\`Meta budget planner failed: \${code}\`);
    this.code = code;
  }
}

export async function claimMetaReadOperation(input) {
  globalThis.__metaTest.calls.push({ name: "claimMetaReadOperation", input });
  if (globalThis.__metaTest.plannerClaimError) {
    throw globalThis.__metaTest.plannerClaimError;
  }
  return globalThis.__metaTest.readLeaseToken;
}

export async function runMetaBudgetPlannerAfterSnapshot(input) {
  globalThis.__metaTest.calls.push({
    name: "runMetaBudgetPlannerAfterSnapshot",
    input,
  });
  if (globalThis.__metaTest.plannerError) {
    throw globalThis.__metaTest.plannerError;
  }
  return globalThis.__metaTest.plannerResult;
}

export async function runMetaOrganicBoostPlannerAfterSnapshot(input) {
  globalThis.__metaTest.calls.push({
    name: "runMetaOrganicBoostPlannerAfterSnapshot",
    input,
  });
  return (
    globalThis.__metaTest.organicBoostResult ?? {
      status: "PLANNED",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError: null,
    }
  );
}

export async function releaseMetaAccountOperation(input) {
  globalThis.__metaTest.calls.push({ name: "releaseMetaAccountOperation", input });
  if (globalThis.__metaTest.plannerReleaseError) {
    throw globalThis.__metaTest.plannerReleaseError;
  }
}
`;

  const organicBoostEnsureStub = `
export async function planAndDrainOrganicBoostForAccount(input) {
  globalThis.__metaTest.calls.push({
    name: "planAndDrainOrganicBoostForAccount",
    input,
  });
  return {
    skippedRecent: true,
    planner: null,
    drain: null,
  };
}
`;

  const organicBoostRunnerStub = `
export async function runOrganicBoostPlannerForAccount(input) {
  globalThis.__metaTest.calls.push({
    name: "runOrganicBoostPlannerForAccount",
    input,
  });
  return (
    globalThis.__metaTest.independentOrganicBoostResult ?? {
      status: "LEASE_REQUIRED",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError: "read_lease_locked",
    }
  );
}
`;

  const executorStub = `
export async function processNextMetaMutation(workerId) {
  globalThis.__metaTest.calls.push({ name: "processNextMetaMutation", workerId });
  return globalThis.__metaTest.executorResult ?? {
    processed: false,
    outcome: "idle",
    stepsProcessed: 0,
  };
}
`;

  const cryptoStub = `
export function decryptAccessToken(value, key) {
  globalThis.__metaTest.decryptInput = { value, key };
  return "decrypted-user-token";
}
`;
  const envStub = `
export function getMetaSyncEnv() {
  return {
    appId: "meta-app-id",
    appSecret: "meta-app-secret",
    tokenEncryptionKey: "test-encryption-key",
  };
}
`;
  const adminStub = `
export function createAdminClient() {
  return globalThis.__metaTest.admin;
}
`;

  await writeFile(join(temporaryDirectory, "client.mjs"), clientStub, "utf8");
  await writeFile(
    join(temporaryDirectory, "marketing-sync.mjs"),
    marketingStub,
    "utf8",
  );
  await writeFile(join(temporaryDirectory, "planner.mjs"), plannerStub, "utf8");
  await writeFile(
    join(temporaryDirectory, "organic-boost-ensure.mjs"),
    organicBoostEnsureStub,
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "organic-boost-runner.mjs"),
    organicBoostRunnerStub,
    "utf8",
  );
  await writeFile(join(temporaryDirectory, "executor.mjs"), executorStub, "utf8");
  await writeFile(join(temporaryDirectory, "crypto.mjs"), cryptoStub, "utf8");
  await writeFile(join(temporaryDirectory, "env.mjs"), envStub, "utf8");
  await writeFile(join(temporaryDirectory, "admin.mjs"), adminStub, "utf8");
  const scheduleModulePath = join(temporaryDirectory, "schedule.mjs");
  await writeFile(scheduleModulePath, transpile(scheduleSource), "utf8");
  const adAccountModulePath = join(temporaryDirectory, "ad-account.mjs");
  await writeFile(adAccountModulePath, transpile(adAccountSource), "utf8");
  const syncModulePath = join(temporaryDirectory, "sync.mjs");
  await writeFile(syncModulePath, transpile(syncSource), "utf8");

  const syncModule = await import(pathToFileURL(syncModulePath).href);
  const adAccountModule = await import(pathToFileURL(adAccountModulePath).href);
  const scheduleModule = await import(pathToFileURL(scheduleModulePath).href);
  const plannerModule = await import(
    pathToFileURL(join(temporaryDirectory, "planner.mjs")).href,
  );

  const referenceTime = new Date("2026-08-01T05:08:24.000Z");
  assert.equal(
    scheduleModule.nextHourlyRun(referenceTime).toISOString(),
    "2026-08-01T06:00:00.000Z",
  );
  assert.equal(
    scheduleModule.resolveCustomerNextSyncAt(
      "2026-07-30T05:14:50.317Z",
      referenceTime,
    ),
    "2026-08-01T06:00:00.000Z",
  );
  assert.equal(
    scheduleModule.resolveCustomerNextSyncAt(
      "2026-08-01T05:08:24.000Z",
      referenceTime,
    ),
    "2026-08-01T06:00:00.000Z",
  );
  assert.equal(
    scheduleModule.resolveCustomerNextSyncAt(
      "2026-08-01T07:14:00.000Z",
      referenceTime,
    ),
    "2026-08-01T07:14:00.000Z",
  );
  assert.equal(
    scheduleModule.resolveCustomerNextSyncAt("not-a-date", referenceTime),
    "2026-08-01T06:00:00.000Z",
  );
  assert.equal(
    scheduleModule.nextHourlyRun(
      new Date("2026-08-01T06:00:00.000Z"),
    ).toISOString(),
    "2026-08-01T07:00:00.000Z",
  );
  assert.throws(
    () => scheduleModule.resolveCustomerNextSyncAt(null, new Date("invalid")),
    /Invalid display reference time/,
  );

  assert.equal(syncModule.calculateSyncBackoffSeconds(0), 300);
  assert.equal(syncModule.calculateSyncBackoffSeconds(1), 600);
  assert.equal(syncModule.calculateSyncBackoffSeconds(20), 19_200);
  assert.equal(syncModule.calculateSyncBackoffSeconds(0, 5), 60);
  assert.equal(syncModule.calculateSyncBackoffSeconds(0, 120), 120);
  assert.equal(syncModule.calculateSyncBackoffSeconds(0, 999_999), 21_600);

  const emptyUsage = {
    appPercent: null,
    pagePercent: null,
    businessPercent: null,
    adAccountPercent: null,
    insightsPercent: null,
    retryAfterSeconds: null,
  };
  const facebookItem = {
    source: "facebook",
    id: "facebook-post-1",
    contentType: "image",
    captionExcerpt: "Facebook baseline",
    permalinkUrl: "https://facebook.example.test/post/1",
    previewUrl: "https://cdn.example.test/facebook.jpg",
    publishedAt: "2026-07-27T10:00:00.000Z",
  };
  const instagramItem = {
    source: "instagram",
    id: "instagram-media-1",
    contentType: "reel",
    captionExcerpt: "Instagram baseline",
    permalinkUrl: "https://instagram.example.test/p/1",
    previewUrl: "https://cdn.example.test/instagram.jpg",
    publishedAt: "2026-07-27T11:00:00.000Z",
  };

  function configureMeta(admin, overrides = {}) {
    globalThis.__metaTest = {
      admin,
      calls: [],
      decryptInput: null,
      pagesResult: {
        pages: [
          {
            id: "page-1",
            name: "Test Page",
            accessToken: "ephemeral-page-token",
            instagramAccount: {
              id: "178414000000001",
              name: "Test Instagram",
              username: "test_account",
            },
          },
        ],
        usage: emptyUsage,
      },
      facebookResult: { items: [facebookItem], usage: emptyUsage },
      instagramResult: { items: [instagramItem], usage: emptyUsage },
      marketingResult: {
        syncId: "20000000-0000-4000-8000-000000000001",
        campaignBudgetSharingSnapshot: [
          {
            platform_campaign_id: "30000000000000001",
            is_adset_budget_sharing_enabled: false,
          },
          {
            platform_campaign_id: "30000000000000002",
            is_adset_budget_sharing_enabled: null,
          },
        ],
        campaignsCount: 2,
        adSetsCount: 3,
        adsCount: 4,
        creativesCount: 4,
        insightsCount: 37,
        spendTotal: 125.5,
        recommendationsCount: 1,
        insightsSince: "2026-06-20",
        insightsUntil: "2026-07-26",
        usage: emptyUsage,
      },
      marketingError: null,
      readLeaseToken: "30000000-0000-4000-8000-000000000001",
      plannerResult: {
        status: "PLANNED",
        snapshotId: "40000000-0000-4000-8000-000000000001",
        accountDay: "2026-07-29",
        observedBudgetOwnerCount: 2,
        reservedExposureMinor: 26250,
        plansCreated: 1,
        plansExisting: 0,
        candidatesBlocked: 0,
        hardCapBreach: false,
      },
      plannerClaimError: null,
      plannerError: null,
      plannerReleaseError: null,
      ...overrides,
    };
  }

  const baselineHarness = makeAdminHarness();
  configureMeta(baselineHarness.admin);
  const baselineResult = await syncModule.syncMetaConnector({
    platformAccountId: baselineHarness.state.connector.id,
    userId: baselineHarness.state.connector.user_id,
    mode: "manual",
  });

  assert.equal(baselineResult.outcome, "completed");
  assert.equal(baselineResult.status, "success");
  assert.equal(baselineResult.seenCount, 2);
  assert.equal(baselineResult.newCount, 0);
  assert.equal(baselineResult.syncedAssetCount, 2);
  assert.equal(baselineResult.failedAssetCount, 0);
  assert.equal(baselineResult.marketingStatus, "success");
  assert.equal(baselineResult.campaignsCount, 2);
  assert.equal(baselineResult.insightsCount, 37);
  assert.equal(baselineResult.plannerStatus, "PLANNED");
  assert.equal(baselineResult.plannerPlansCreated, 1);
  assert.equal(baselineResult.plannerReservedExposureMinor, 26250);
  assert.equal(globalThis.__metaTest.decryptInput.value.ciphertext, "ciphertext");
  assert.equal(
    globalThis.__metaTest.calls.find(
      (call) => call.name === "getFacebookPublishedPosts",
    ).input.pageAccessToken,
    "ephemeral-page-token",
  );
  const instagramCalls = globalThis.__metaTest.calls.filter(
    (call) => call.name === "getInstagramMedia",
  );
  assert.equal(instagramCalls.length, 1);
  assert.equal(instagramCalls[0].input.instagramAccountId, "178414000000001");
  assert.equal(instagramCalls[0].input.accessToken, "decrypted-user-token");
  assert.equal(instagramCalls[0].input.pageAccessToken, undefined);
  assert.notEqual(instagramCalls[0].input.instagramAccountId, "178414000000002");
  const baselineRecords = baselineHarness.state.rpcCalls.filter(
    (call) => call.name === "record_meta_content_candidates",
  );
  assert.equal(baselineRecords.length, 2);
  assert.ok(baselineRecords.every((call) => call.args.p_is_baseline === true));
  assert.doesNotMatch(JSON.stringify(baselineRecords), /ephemeral-page-token/);
  assert.doesNotMatch(
    JSON.stringify(baselineRecords),
    /access_token|token_iv|token_auth_tag/,
  );
  assert.equal(
    baselineHarness.state.updates.at(-1).values.sync_status,
    "success",
  );
  assert.equal(
    typeof baselineHarness.state.updates.at(-1).values.baseline_completed_at,
    "string",
  );
  const marketingCall = globalThis.__metaTest.calls.find(
    (call) => call.name === "syncMetaMarketingSnapshot",
  );
  assert.equal(marketingCall.input.adAccountId, "ad-account-1");
  assert.equal(marketingCall.input.accessToken, "decrypted-user-token");
  assert.equal(marketingCall.input.appSecret, "meta-app-secret");
  const controlCalls = globalThis.__metaTest.calls.filter((call) =>
    [
      "claimMetaReadOperation",
      "syncMetaMarketingSnapshot",
      "runMetaBudgetPlannerAfterSnapshot",
      "releaseMetaAccountOperation",
    ].includes(call.name),
  );
  assert.deepEqual(
    controlCalls.map((call) => call.name),
    [
      "claimMetaReadOperation",
      "syncMetaMarketingSnapshot",
      "runMetaBudgetPlannerAfterSnapshot",
      "releaseMetaAccountOperation",
    ],
  );
  assert.equal(
    controlCalls[2].input.marketingSyncId,
    "20000000-0000-4000-8000-000000000001",
  );
  assert.equal(controlCalls[2].input.campaignBudgetSharingSnapshot.length, 2);
  assert.equal(
    controlCalls[2].input.readLeaseToken,
    "30000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    baselineHarness.state.updates.at(-1).values.automation_planner_status,
    "success",
  );

  const marketingPartialHarness = makeAdminHarness();
  configureMeta(marketingPartialHarness.admin, {
    marketingError: new Error("temporary Marketing API failure"),
  });
  const marketingPartialResult = await syncModule.syncMetaConnector({
    platformAccountId: marketingPartialHarness.state.connector.id,
    mode: "cron",
  });

  assert.equal(marketingPartialResult.status, "partial");
  assert.equal(marketingPartialResult.marketingStatus, "error");
  assert.equal(marketingPartialResult.campaignsCount, 0);
  assert.equal(marketingPartialResult.plannerStatus, "not_run");
  assert.equal(
    globalThis.__metaTest.calls.some(
      (call) => call.name === "runMetaBudgetPlannerAfterSnapshot",
    ),
    false,
  );
  assert.equal(
    globalThis.__metaTest.calls.at(-1).name,
    "releaseMetaAccountOperation",
  );
  assert.equal(
    marketingPartialHarness.state.updates.at(-1).values.sync_error_code,
    "marketing_sync_failed",
  );
  assert.equal(
    marketingPartialHarness.state.updates.at(-1).values.marketing_sync_status,
    "error",
  );
  assert.equal(
    typeof marketingPartialHarness.state.updates.at(-1).values.baseline_completed_at,
    "string",
  );

  const operationLockedHarness = makeAdminHarness({
    connector: connector({
      marketing_sync_id: "20000000-0000-4000-8000-000000000099",
      marketing_sync_status: "success",
    }),
  });
  configureMeta(operationLockedHarness.admin, { readLeaseToken: null });
  const operationLockedResult = await syncModule.syncMetaConnector({
    platformAccountId: operationLockedHarness.state.connector.id,
    mode: "cron",
  });
  // Lease contention must not poison a previously successful marketing snapshot
  // or block Beitrag-Push (independent runner still runs).
  assert.equal(operationLockedResult.status, "success");
  assert.equal(operationLockedResult.marketingStatus, "not_run");
  assert.equal(operationLockedResult.plannerStatus, "not_run");
  assert.equal(
    operationLockedHarness.state.updates.at(-1).values.sync_error_code,
    null,
  );
  assert.equal(
    operationLockedHarness.state.updates.at(-1).values.marketing_sync_status,
    "success",
  );
  assert.equal(
    operationLockedHarness.state.updates.at(-1).values.marketing_sync_error_code,
    null,
  );
  assert.deepEqual(
    globalThis.__metaTest.calls
      .filter((call) =>
        [
          "claimMetaReadOperation",
          "syncMetaMarketingSnapshot",
          "runMetaBudgetPlannerAfterSnapshot",
          "runOrganicBoostPlannerForAccount",
          "releaseMetaAccountOperation",
        ].includes(call.name),
      )
      .map((call) => call.name),
    ["claimMetaReadOperation", "runOrganicBoostPlannerForAccount"],
  );

  const plannerFailureHarness = makeAdminHarness();
  configureMeta(plannerFailureHarness.admin, {
    plannerError: new plannerModule.MetaBudgetPlannerError("planner_failed"),
  });
  const plannerFailureResult = await syncModule.syncMetaConnector({
    platformAccountId: plannerFailureHarness.state.connector.id,
    mode: "cron",
  });
  assert.equal(plannerFailureResult.status, "partial");
  assert.equal(plannerFailureResult.marketingStatus, "success");
  assert.equal(plannerFailureResult.plannerStatus, "error");
  assert.equal(
    plannerFailureHarness.state.updates.at(-1).values.sync_error_code,
    "planner_failed",
  );
  assert.equal(
    plannerFailureHarness.state.updates.at(-1).values.automation_planner_status,
    "error",
  );
  assert.deepEqual(
    globalThis.__metaTest.calls
      .filter((call) =>
        [
          "claimMetaReadOperation",
          "syncMetaMarketingSnapshot",
          "runMetaBudgetPlannerAfterSnapshot",
          "releaseMetaAccountOperation",
        ].includes(call.name),
      )
      .map((call) => call.name),
    [
      "claimMetaReadOperation",
      "syncMetaMarketingSnapshot",
      "runMetaBudgetPlannerAfterSnapshot",
      "releaseMetaAccountOperation",
    ],
  );

  const newContentHarness = makeAdminHarness({
    assets: defaultAssets("2026-07-27T09:00:00.000Z"),
    recordNewCount: 1,
  });
  configureMeta(newContentHarness.admin);
  const newContentResult = await syncModule.syncMetaConnector({
    platformAccountId: newContentHarness.state.connector.id,
    mode: "cron",
  });

  assert.equal(newContentResult.status, "success");
  assert.equal(newContentResult.newCount, 2);
  const newContentRecords = newContentHarness.state.rpcCalls.filter(
    (call) => call.name === "record_meta_content_candidates",
  );
  assert.ok(newContentRecords.every((call) => call.args.p_is_baseline === false));

  const cooldownHarness = makeAdminHarness({
    connector: connector({ last_sync_started_at: isoOffset(-20) }),
    claim: false,
  });
  configureMeta(cooldownHarness.admin);
  const cooldownResult = await syncModule.syncMetaConnector({
    platformAccountId: cooldownHarness.state.connector.id,
    userId: cooldownHarness.state.connector.user_id,
    mode: "manual",
  });

  assert.equal(cooldownResult.outcome, "blocked");
  assert.equal(cooldownResult.blockedReason, "cooldown");
  assert.ok(new Date(cooldownResult.retryAt).getTime() > Date.now());
  assert.equal(globalThis.__metaTest.calls.length, 0);

  const expiredHarness = makeAdminHarness({
    connector: connector({ expires_at: isoOffset(-1) }),
  });
  configureMeta(expiredHarness.admin);
  const expiredResult = await syncModule.syncMetaConnector({
    platformAccountId: expiredHarness.state.connector.id,
    mode: "cron",
  });

  assert.equal(expiredResult.status, "reconnect_required");
  assert.equal(
    expiredHarness.state.updates.at(-1).values.sync_error_code,
    "token_expired",
  );
  assert.equal(expiredResult.errorCode, "token_expired");

  const missingAssetsHarness = makeAdminHarness({
    assets: defaultAssets().filter((asset) => asset.asset_type !== "instagram_account"),
  });
  configureMeta(missingAssetsHarness.admin);
  const missingAssetsResult = await syncModule.syncMetaConnector({
    platformAccountId: missingAssetsHarness.state.connector.id,
    mode: "manual",
  });
  assert.equal(missingAssetsResult.status, "error");
  assert.equal(missingAssetsResult.errorCode, "assets_missing");
  assert.equal(
    missingAssetsHarness.state.updates.at(-1).values.sync_status,
    "error",
  );
  assert.equal(
    missingAssetsHarness.state.updates.at(-1).values.sync_error_code,
    "assets_missing",
  );
  assert.notEqual(missingAssetsResult.status, "reconnect_required");

  assert.equal(
    adAccountModule.resolveMarketingAdAccountId({
      selectedAdAccountId: null,
      adAccountAssetIds: ["act_111"],
    }),
    "act_111",
  );
  assert.equal(
    adAccountModule.resolveMarketingAdAccountId({
      selectedAdAccountId: null,
      adAccountAssetIds: ["act_111", "act_222"],
    }),
    null,
  );
  assert.equal(
    adAccountModule.resolveMarketingAdAccountId({
      selectedAdAccountId: "222",
      adAccountAssetIds: ["act_111", "act_222"],
    }),
    "act_222",
  );

  const multiAdHarness = makeAdminHarness({
    assets: [
      ...defaultAssets("2026-07-27T09:00:00.000Z"),
      {
        id: "10000000-0000-4000-8000-000000000005",
        asset_type: "ad_account",
        meta_asset_id: "ad-account-2",
        parent_meta_asset_id: null,
        baseline_completed_at: null,
      },
    ],
  });
  configureMeta(multiAdHarness.admin);
  const multiAdResult = await syncModule.syncMetaConnector({
    platformAccountId: multiAdHarness.state.connector.id,
    mode: "manual",
  });
  assert.equal(multiAdResult.status, "success");
  assert.equal(multiAdResult.errorCode, null);
  assert.equal(
    multiAdHarness.state.updates.at(-1).values.marketing_sync_error_code,
    "ad_account_selection_required",
  );
  assert.equal(
    multiAdHarness.state.updates.at(-1).values.sync_status,
    "success",
  );

  const multiAdSelectedHarness = makeAdminHarness({
    connector: connector({
      marketing_meta_ad_account_id: "ad-account-2",
    }),
    assets: [
      ...defaultAssets("2026-07-27T09:00:00.000Z"),
      {
        id: "10000000-0000-4000-8000-000000000005",
        asset_type: "ad_account",
        meta_asset_id: "ad-account-2",
        parent_meta_asset_id: null,
        baseline_completed_at: null,
      },
    ],
  });
  configureMeta(multiAdSelectedHarness.admin);
  const multiAdSelectedResult = await syncModule.syncMetaConnector({
    platformAccountId: multiAdSelectedHarness.state.connector.id,
    mode: "manual",
  });
  assert.equal(multiAdSelectedResult.status, "success");
  const selectedMarketingCall = globalThis.__metaTest.calls.find(
    (call) => call.name === "syncMetaMarketingSnapshot",
  );
  assert.equal(selectedMarketingCall.input.adAccountId, "ad-account-2");
  assert.equal(
    multiAdSelectedHarness.state.updates.at(-1).values.marketing_sync_error_code,
    null,
  );

  const partialHarness = makeAdminHarness({
    assets: defaultAssets("2026-07-27T09:00:00.000Z"),
  });
  configureMeta(partialHarness.admin, {
    instagramError: new Error("temporary Instagram failure"),
  });
  const partialResult = await syncModule.syncMetaConnector({
    platformAccountId: partialHarness.state.connector.id,
    mode: "cron",
  });

  assert.equal(partialResult.status, "partial");
  assert.equal(partialResult.syncedAssetCount, 1);
  assert.equal(partialResult.failedAssetCount, 1);
  assert.equal(partialHarness.state.updates.at(-1).values.sync_error_code, "asset_partial");

  const rateLimitUsage = {
    appPercent: 100,
    pagePercent: null,
    businessPercent: null,
    retryAfterSeconds: 120,
  };
  const rateLimitHarness = makeAdminHarness();
  configureMeta(rateLimitHarness.admin, {
    pageError: new (await import(pathToFileURL(join(temporaryDirectory, "client.mjs")).href)).MetaGraphError(
      429,
      { error: { code: 4 } },
      rateLimitUsage,
    ),
  });
  const rateLimitResult = await syncModule.syncMetaConnector({
    platformAccountId: rateLimitHarness.state.connector.id,
    mode: "cron",
  });

  assert.equal(rateLimitResult.status, "rate_limited");
  assert.ok(new Date(rateLimitResult.retryAt).getTime() >= Date.now() + 115_000);
  assert.equal(
    rateLimitHarness.state.updates.at(-1).values.sync_error_code,
    "meta_rate_limited",
  );
  assert.equal(
    "last_sync_seen_count" in rateLimitHarness.state.updates.at(-1).values,
    false,
  );
  assert.equal(
    "last_sync_new_count" in rateLimitHarness.state.updates.at(-1).values,
    false,
  );

  const reconnectHarness = makeAdminHarness();
  configureMeta(reconnectHarness.admin, {
    pageError: new (await import(pathToFileURL(join(temporaryDirectory, "client.mjs")).href)).MetaGraphError(
      400,
      { error: { code: 190 } },
      emptyUsage,
    ),
  });
  const reconnectResult = await syncModule.syncMetaConnector({
    platformAccountId: reconnectHarness.state.connector.id,
    mode: "cron",
  });

  assert.equal(reconnectResult.status, "reconnect_required");
  assert.equal(
    reconnectHarness.state.updates.at(-1).values.sync_error_code,
    "meta_token_invalid",
  );

  const dueHarness = makeAdminHarness({
    dueRows: [
      {
        id: "due",
        next_sync_at: isoOffset(-60),
        sync_lock_until: null,
        sync_backoff_until: null,
        sync_status: "success",
      },
      {
        id: "locked",
        next_sync_at: isoOffset(-60),
        sync_lock_until: isoOffset(60),
        sync_backoff_until: null,
        sync_status: "syncing",
      },
      {
        id: "backoff",
        next_sync_at: isoOffset(-60),
        sync_lock_until: null,
        sync_backoff_until: isoOffset(60),
        sync_status: "rate_limited",
      },
      {
        id: "future",
        next_sync_at: isoOffset(60),
        sync_lock_until: null,
        sync_backoff_until: null,
        sync_status: "success",
      },
    ],
  });
  configureMeta(dueHarness.admin);
  assert.deepEqual(await syncModule.getDueMetaConnectorIds(10), ["due"]);

  const migrationSource = await readFile(migrationPath, "utf8");
  const reconnectPersistenceMigrationSource = await readFile(
    reconnectPersistenceMigrationPath,
    "utf8",
  );
  const cronRouteSource = await readFile(cronRoutePath, "utf8");
  const manualRouteSource = await readFile(manualRoutePath, "utf8");
  const envSource = await readFile(envPath, "utf8");
  const vercelConfig = JSON.parse(await readFile(vercelPath, "utf8"));

  const metaAssetsDefinition = migrationSource.slice(
    migrationSource.indexOf("create table if not exists public.meta_assets"),
    migrationSource.indexOf(
      "create table if not exists public.meta_content_candidates",
    ),
  );
  assert.doesNotMatch(
    metaAssetsDefinition,
    /access_token|page_token|token_iv|token_auth_tag|refresh_token/,
  );
  assert.match(migrationSource, /enable row level security/);
  assert.match(migrationSource, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(
    migrationSource,
    /unique \(platform_account_id, source, meta_content_id\)/,
  );
  assert.match(migrationSource, /not p_is_baseline/);
  assert.match(
    migrationSource,
    /on conflict \(platform_account_id, source, meta_content_id\)[\s\S]*?do nothing/,
  );
  assert.match(migrationSource, /sync_lock_until is null or sync_lock_until <= now\(\)/);
  assert.match(migrationSource, /sync_backoff_until is null or sync_backoff_until <= now\(\)/);
  assert.match(migrationSource, /last_sync_started_at <= now\(\) - make_interval/);
  assert.match(
    migrationSource,
    /revoke all on function public\.claim_meta_sync[\s\S]*?from public, anon, authenticated/,
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.claim_meta_sync[\s\S]*?to service_role/,
  );
  assert.match(
    migrationSource,
    /access_token = null,[\s\S]*?refresh_token = null/,
  );

  assert.match(
    reconnectPersistenceMigrationSource,
    /alter column meta_asset_id drop not null/,
  );
  assert.match(
    reconnectPersistenceMigrationSource,
    /foreign key \(meta_asset_id\)[\s\S]*?on delete set null/,
  );
  assert.match(
    reconnectPersistenceMigrationSource,
    /baseline_completed_at = existing\.baseline_completed_at/,
  );
  assert.match(
    reconnectPersistenceMigrationSource,
    /last_sync_seen_count = existing\.last_sync_seen_count/,
  );
  assert.match(
    reconnectPersistenceMigrationSource,
    /last_sync_new_count = existing\.last_sync_new_count/,
  );
  assert.match(
    reconnectPersistenceMigrationSource,
    /on conflict \(platform_account_id, asset_type, meta_asset_id\)[\s\S]*?do update set/,
  );
  assert.match(
    reconnectPersistenceMigrationSource,
    /delete from public\.meta_assets existing_asset[\s\S]*?and not exists/,
  );
  assert.doesNotMatch(
    reconnectPersistenceMigrationSource,
    /delete from public\.meta_assets\s+where platform_account_id = v_platform_account_id/,
  );
  assert.match(
    migrationSource,
    /update public\.meta_content_candidates[\s\S]*?meta_asset_id = p_meta_asset_id/,
  );

  assert.match(cronRouteSource, /constantTimeEqual/);
  assert.match(cronRouteSource, /`Bearer \$\{cronSecret\}`/);
  assert.match(cronRouteSource, /getMetaCronEnv\(\)/);
  assert.match(cronRouteSource, /getDueMetaConnectorIds\(META_CRON_BATCH_SIZE\)/);
  assert.match(cronRouteSource, /mode: "cron"/);
  assert.match(cronRouteSource, /export const maxDuration = 180/);
  assert.match(cronRouteSource, /private, no-store/);
  assert.match(manualRouteSource, /mode: "manual"/);
  assert.match(manualRouteSource, /userId: user\.id/);
  assert.match(manualRouteSource, /headers\["Retry-After"\]/);
  assert.match(manualRouteSource, /Number\.isFinite\(retryTimestamp\)/);
  assert.match(envSource, /requiredSecret\("CRON_SECRET", process\.env\.CRON_SECRET\)/);
  assert.deepEqual(vercelConfig.crons, [
    { path: "/api/cron/meta-sync", schedule: "0 * * * *" },
    { path: "/api/cron/creative-assets", schedule: "*/5 * * * *" },
    { path: "/api/cron/meta-executor", schedule: "* * * * *" },
    { path: "/api/cron/organic-boost-delivery", schedule: "*/15 * * * *" },
  ]);

  console.log("Meta content sync checks passed");
} finally {
  delete globalThis.__metaTest;
  await rm(temporaryDirectory, { force: true, recursive: true });
}
