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
      meta_asset_id: "instagram-1",
      parent_meta_asset_id: "page-1",
      baseline_completed_at: baselineCompletedAt,
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
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
  MetaGraphError,
} from "./client.mjs";`)
    .replace('from "./crypto";', 'from "./crypto.mjs";')
    .replace('from "./env";', 'from "./env.mjs";')
    .replace('from "../supabase/admin";', 'from "./admin.mjs";');

  const clientStub = `
const emptyUsage = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
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
    retryAfterSeconds: maximum(left.retryAfterSeconds, right.retryAfterSeconds),
  };
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
  await writeFile(join(temporaryDirectory, "crypto.mjs"), cryptoStub, "utf8");
  await writeFile(join(temporaryDirectory, "env.mjs"), envStub, "utf8");
  await writeFile(join(temporaryDirectory, "admin.mjs"), adminStub, "utf8");
  const syncModulePath = join(temporaryDirectory, "sync.mjs");
  await writeFile(syncModulePath, transpile(syncSource), "utf8");

  const syncModule = await import(pathToFileURL(syncModulePath).href);

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
              id: "instagram-1",
              name: "Test Instagram",
              username: "test_account",
            },
          },
        ],
        usage: emptyUsage,
      },
      facebookResult: { items: [facebookItem], usage: emptyUsage },
      instagramResult: { items: [instagramItem], usage: emptyUsage },
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
  assert.equal(globalThis.__metaTest.decryptInput.value.ciphertext, "ciphertext");
  assert.equal(
    globalThis.__metaTest.calls.find(
      (call) => call.name === "getFacebookPublishedPosts",
    ).input.pageAccessToken,
    "ephemeral-page-token",
  );
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
  assert.equal(
    "last_sync_seen_count" in expiredHarness.state.updates.at(-1).values,
    false,
  );
  assert.equal(
    "last_sync_new_count" in expiredHarness.state.updates.at(-1).values,
    false,
  );
  assert.equal(globalThis.__metaTest.calls.length, 0);

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
  assert.match(cronRouteSource, /private, no-store/);
  assert.match(manualRouteSource, /mode: "manual"/);
  assert.match(manualRouteSource, /userId: user\.id/);
  assert.match(manualRouteSource, /headers\["Retry-After"\]/);
  assert.match(manualRouteSource, /Number\.isFinite\(retryTimestamp\)/);
  assert.match(envSource, /requiredSecret\("CRON_SECRET", process\.env\.CRON_SECRET\)/);
  assert.deepEqual(vercelConfig.crons, [
    { path: "/api/cron/meta-sync", schedule: "0 * * * *" },
  ]);

  console.log("Meta content sync checks passed");
} finally {
  delete globalThis.__metaTest;
  await rm(temporaryDirectory, { force: true, recursive: true });
}
