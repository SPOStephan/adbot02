import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const migrationsDirectory = join(projectRoot, "supabase", "migrations");
const bootstrapPath = join(scriptsDirectory, "bootstrap-local-supabase.sql");
const regressionPath = join(scriptsDirectory, "test-openai-ads-connector.sql");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, PGTZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          [
            `${basename(command)} failed with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`,
            stdout.trim(),
            stderr.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local PostgreSQL test port"));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolve(address.port),
      );
    });
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "adbot02-openai-ads-"));
const dataDirectory = join(temporaryRoot, "postgres");
const socketDirectory = join(temporaryRoot, "socket");
const logPath = join(temporaryRoot, "postgres.log");
let pgCtlPath;
let serverStarted = false;

try {
  const { stdout: bindirOutput } = await run("pg_config", ["--bindir"]);
  const postgresBin = bindirOutput.trim();
  const initdbPath = join(postgresBin, "initdb");
  pgCtlPath = join(postgresBin, "pg_ctl");
  const psqlPath = join(postgresBin, "psql");
  const port = await getFreePort();
  await mkdir(socketDirectory, { recursive: true });

  await run(initdbPath, [
    "--pgdata",
    dataDirectory,
    "--username",
    "adbot_test",
    "--auth",
    "trust",
    "--no-locale",
    "--encoding",
    "UTF8",
  ]);
  await run(pgCtlPath, [
    "--pgdata",
    dataDirectory,
    "--log",
    logPath,
    "--options",
    `-F -p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
    "--wait",
    "start",
  ]);
  serverStarted = true;

  const psqlBase = [
    "--no-psqlrc",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--username",
    "adbot_test",
    "--dbname",
    "postgres",
    "--set",
    "ON_ERROR_STOP=1",
  ];
  await run(psqlPath, [...psqlBase, "--file", bootstrapPath]);

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const migrationName of migrationNames) {
    try {
      await run(psqlPath, [
        ...psqlBase,
        "--file",
        join(migrationsDirectory, migrationName),
      ]);
    } catch (error) {
      throw new Error(`Migration ${migrationName} failed\n${error.message}`);
    }
  }

  const { stdout } = await run(psqlPath, [
    ...psqlBase,
    "--file",
    regressionPath,
  ]);
  if (!stdout.includes("OpenAI Ads connector database checks passed")) {
    throw new Error("OpenAI Ads database regression did not emit its success marker");
  }

  const upgradeDatabase = "adbot_openai_upgrade";
  await run(psqlPath, [
    ...psqlBase,
    "--command",
    `create database ${upgradeDatabase}`,
  ]);
  const upgradePsqlBase = [...psqlBase];
  upgradePsqlBase[upgradePsqlBase.indexOf("postgres")] = upgradeDatabase;
  await run(psqlPath, [...upgradePsqlBase, "--file", bootstrapPath]);
  const safetyMigration = "20260912170000_openai_ads_paused_daily_launch_safety.sql";
  for (const migrationName of migrationNames.filter(
    (name) => name !== safetyMigration,
  )) {
    await run(psqlPath, [
      ...upgradePsqlBase,
      "--file",
      join(migrationsDirectory, migrationName),
    ]);
  }
  await run(psqlPath, [
    ...upgradePsqlBase,
    "--command",
    `
      insert into auth.users (id, email) values
        ('31000000-0000-4000-8000-000000000001', 'upgrade@example.com');
      insert into public.platform_accounts (
        id, user_id, platform, platform_account_id, account_id, account_name,
        access_token_encrypted, token_iv, token_auth_tag, token_version,
        credential_kind, provider_metadata, connected_at, updated_at
      ) values (
        '32000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        'openai_ads', 'upgrade-account', 'upgrade-account', 'Upgrade account',
        'cipher', 'iv', 'tag', 1, 'api_key',
        '{"currency_code":"EUR","timezone":"Europe/Berlin"}'::jsonb,
        now(), now()
      );
      insert into public.ad_platform_launches (
        id, user_id, platform_account_id, platform, idempotency_key, status,
        request_payload
      ) values
      (
        '33000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000001',
        'openai_ads', 'legacy-active', 'active', '{"dailyBudgetMicros":25000000}'::jsonb
      ),
      (
        '33000000-0000-4000-8000-000000000002',
        '31000000-0000-4000-8000-000000000001',
        '32000000-0000-4000-8000-000000000001',
        'openai_ads', 'valid-active', 'active',
        '{"contractVersion":"paused_campaign_daily_v1","remoteAccountId":"upgrade-account","currency":"EUR","accountTimezone":"Europe/Berlin","campaignName":"Campaign","campaignDescription":null,"biddingType":"clicks","billingEventType":"click","dailyBudgetMicros":25000000,"maxBidMicros":2000000,"startTime":null,"endTime":null,"locationIds":["DE"],"adGroupName":"Group","contextHints":["hotel"],"adName":"Ad","title":"Title","body":"Body","targetUrl":"https://example.com/","imageUrl":"https://example.com/image.jpg"}'::jsonb
      );
    `,
  ]);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await run(psqlPath, [
      ...upgradePsqlBase,
      "--file",
      join(migrationsDirectory, safetyMigration),
    ]);
  }
  const { stdout: upgradeStatuses } = await run(psqlPath, [
    ...upgradePsqlBase,
    "--tuples-only",
    "--no-align",
    "--command",
    "select id::text || ':' || status || ':' || coalesce(error_code, '') from public.ad_platform_launches order by id",
  ]);
  if (
    !upgradeStatuses.includes(
      "33000000-0000-4000-8000-000000000001:activation_uncertain:legacy_active_contract_unverified",
    ) ||
    !upgradeStatuses.includes(
      "33000000-0000-4000-8000-000000000002:active:",
    )
  ) {
    throw new Error(`OpenAI Ads upgrade migration states are unsafe:\n${upgradeStatuses}`);
  }
  const firstConcurrentClaim = run(psqlPath, [
    ...upgradePsqlBase,
    "--tuples-only",
    "--no-align",
    "--command",
    `begin;
     select count(*) from public.claim_openai_ads_launch_operation(
       '33000000-0000-4000-8000-000000000002',
       '31000000-0000-4000-8000-000000000001',
       array['active'], 'activating', 300
     );
     select pg_sleep(1);
     commit;`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const secondConcurrentClaim = run(psqlPath, [
    ...upgradePsqlBase,
    "--tuples-only",
    "--no-align",
    "--command",
    `select count(*) from public.claim_openai_ads_launch_operation(
       '33000000-0000-4000-8000-000000000002',
       '31000000-0000-4000-8000-000000000001',
       array['active'], 'activating', 300
     );`,
  ]);
  const [firstClaimResult, secondClaimResult] = await Promise.all([
    firstConcurrentClaim,
    secondConcurrentClaim,
  ]);
  if (
    !firstClaimResult.stdout.split("\n").includes("1") ||
    secondClaimResult.stdout.trim() !== "0"
  ) {
    throw new Error(
      `Concurrent OpenAI launch claim was not atomic:\nfirst=${firstClaimResult.stdout}\nsecond=${secondClaimResult.stdout}`,
    );
  }

  const raceCampaigns =
    `'[{"id":"race-campaign","name":"Campaign","status":"paused","bidding_type":"clicks","daily_budget_amount_micros":25000000,"start_time":null,"end_time":null,"provider_data":{"description":null,"budget":{"lifetime_spend_limit_micros_present":false},"targeting":{"locations":{"include":[{"id":"DE"}]}},"product_feed_id":null,"landing_page_configuration":null,"serving_issues_observed":true,"serving_issues":[]}}]'::jsonb`;
  const raceGroups =
    `'[{"id":"race-group","campaign_id":"race-campaign","name":"Group","status":"paused","billing_event_type":"click","bid_strategy":"fixed_bid","max_bid_micros":2000000,"provider_data":{"description":null,"context_hints":["hotel"],"bidding_config":{"custom_audience_bid_multipliers":[]},"product_set":null,"landing_page_configuration":null,"serving_issues_observed":true,"serving_issues":[]}}]'::jsonb`;
  const raceAds =
    `'[{"id":"race-ad","ad_group_id":"race-group","name":"Ad","status":"paused","review_status":"approved","provider_data":{"creative":{"type":"chat_card","title":"Title","body":"Body","target_url":"https://example.com/","file_id":"race-file"},"landing_page_configuration":null,"serving_issues_observed":true,"serving_issues":[]}}]'::jsonb`;
  const raceAccount =
    `'${JSON.stringify({
      id: "upgrade-account",
      name: "Upgrade account",
      currency_code: "EUR",
      timezone: "Europe/Berlin",
      review_status: "approved",
      account_status: "active",
    })}'::jsonb`;
  const raceLaunchId = "33000000-0000-4000-8000-000000000002";
  const raceUserId = "31000000-0000-4000-8000-000000000001";
  const raceAccountId = "32000000-0000-4000-8000-000000000001";
  const prepareRace = async (syncRunId) => {
    await run(psqlPath, [
      ...upgradePsqlBase,
      "--command",
      `update public.ad_platform_launches
         set status='ready_to_activate', operation_token=null,
             operation_started_at=null, activated_at=null,
             remote_campaign_id='race-campaign',
             remote_ad_group_id='race-group', remote_ad_id='race-ad',
             remote_file_id='race-file', review_status='approved', error_code=null
       where id='${raceLaunchId}';
       update public.platform_accounts
         set provider_sync_status='syncing',
             provider_sync_claim_token='${syncRunId}',
             provider_sync_claimed_at=now()
         where id='${raceAccountId}';
       insert into public.ad_platform_sync_runs
         (id,user_id,platform_account_id,platform,status,sync_claim_token,credential_generation)
       select '${syncRunId}','${raceUserId}','${raceAccountId}','openai_ads','running',
              '${syncRunId}',credential_generation
       from public.platform_accounts where id='${raceAccountId}';`,
    ]);
  };
  const runRacingSnapshot = (syncRunId) =>
    run(psqlPath, [
      ...upgradePsqlBase,
      "--command",
      `select public.replace_openai_ads_snapshot(
        '${raceUserId}','${raceAccountId}','${syncRunId}',
        ${raceAccount},${raceCampaigns},${raceGroups},${raceAds},'[]'::jsonb
      );`,
    ]);

  const finishRaceSyncId = "34000000-0000-4000-8000-000000000001";
  await prepareRace(finishRaceSyncId);
  const finishingWorker = run(psqlPath, [
    ...upgradePsqlBase,
    "--command",
    `begin;
     update public.ad_platform_launches
       set status='active', activated_at=now()
       where id='${raceLaunchId}';
     select pg_sleep(1);
     commit;`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all([finishingWorker, runRacingSnapshot(finishRaceSyncId)]);
  const { stdout: finishRaceStatus } = await run(psqlPath, [
    ...upgradePsqlBase,
    "--tuples-only",
    "--no-align",
    "--command",
    `select status from public.ad_platform_launches where id='${raceLaunchId}'`,
  ]);
  if (finishRaceStatus.trim() !== "active") {
    throw new Error(`Snapshot overwrote concurrent ACTIVE finish: ${finishRaceStatus}`);
  }

  const claimRaceSyncId = "34000000-0000-4000-8000-000000000002";
  const claimRaceToken = "35000000-0000-4000-8000-000000000001";
  await prepareRace(claimRaceSyncId);
  const claimingWorker = run(psqlPath, [
    ...upgradePsqlBase,
    "--command",
    `begin;
     update public.ad_platform_launches
       set status='activating', operation_token='${claimRaceToken}',
           operation_started_at=now()
       where id='${raceLaunchId}';
     select pg_sleep(1);
     commit;`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all([claimingWorker, runRacingSnapshot(claimRaceSyncId)]);
  const { stdout: claimRaceState } = await run(psqlPath, [
    ...upgradePsqlBase,
    "--tuples-only",
    "--no-align",
    "--command",
    `select status || ':' || operation_token::text
       from public.ad_platform_launches where id='${raceLaunchId}'`,
  ]);
  if (claimRaceState.trim() !== `activating:${claimRaceToken}`) {
    throw new Error(`Snapshot overwrote concurrent operation claim: ${claimRaceState}`);
  }

  const oldGeneration = "36000000-0000-4000-8000-000000000001";
  const newGeneration = "36000000-0000-4000-8000-000000000002";
  const oldSyncToken = "37000000-0000-4000-8000-000000000001";
  const oldSyncRun = "38000000-0000-4000-8000-000000000001";
  const { stdout: staleFailureResult } = await run(psqlPath, [
    ...upgradePsqlBase,
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--command",
    `update public.platform_accounts
       set credential_generation='${oldGeneration}',
           provider_sync_claim_token='${oldSyncToken}',
           provider_sync_claimed_at=now(), provider_sync_status='syncing',
           access_token_encrypted='old-cipher', token_iv='old-iv',
           token_auth_tag='old-tag', credential_kind='api_key', revoked_at=null
       where id='${raceAccountId}';
     insert into public.ad_platform_sync_runs
       (id,user_id,platform_account_id,platform,status,sync_claim_token,credential_generation)
     values ('${oldSyncRun}','${raceUserId}','${raceAccountId}','openai_ads','running',
             '${oldSyncToken}','${oldGeneration}');
     update public.platform_accounts
       set credential_generation='${newGeneration}',
           provider_sync_claim_token=null, provider_sync_claimed_at=null,
           provider_sync_status='idle', access_token_encrypted='new-cipher',
           token_iv='new-iv', token_auth_tag='new-tag', credential_kind='api_key',
           revoked_at=null
       where id='${raceAccountId}';
     select public.fail_openai_ads_account_sync(
       '${raceAccountId}','${oldSyncRun}','${oldSyncToken}','${oldGeneration}',
       'credential_rejected',null,true
     );
     select access_token_encrypted || ':' || credential_generation::text || ':' ||
            provider_sync_status || ':' || coalesce(revoked_at::text,'null')
       from public.platform_accounts where id='${raceAccountId}';`,
  ]);
  const staleFailureLines = staleFailureResult.trim().split("\n");
  if (
    staleFailureLines[0] !== "f" ||
    staleFailureLines[1] !== `new-cipher:${newGeneration}:idle:null`
  ) {
    throw new Error(
      `Stale credential failure mutated reconnect state: ${staleFailureResult}`,
    );
  }

  const staleSnapshotToken = "37000000-0000-4000-8000-000000000002";
  const currentSnapshotToken = "37000000-0000-4000-8000-000000000003";
  const staleSnapshotRun = "38000000-0000-4000-8000-000000000002";
  const currentSnapshotRun = "38000000-0000-4000-8000-000000000003";
  await run(psqlPath, [
    ...upgradePsqlBase,
    "--command",
    `update public.platform_accounts
       set credential_generation='${oldGeneration}',
           provider_sync_claim_token='${staleSnapshotToken}',
           provider_sync_claimed_at=now(), provider_sync_status='syncing', revoked_at=null
       where id='${raceAccountId}';
     insert into public.ad_platform_sync_runs
       (id,user_id,platform_account_id,platform,status,sync_claim_token,credential_generation)
     values ('${staleSnapshotRun}','${raceUserId}','${raceAccountId}','openai_ads','running',
             '${staleSnapshotToken}','${oldGeneration}');
     update public.platform_accounts
       set credential_generation='${newGeneration}',
           provider_sync_claim_token='${currentSnapshotToken}',
           provider_sync_claimed_at=now(), provider_sync_status='syncing'
       where id='${raceAccountId}';
     insert into public.ad_platform_sync_runs
       (id,user_id,platform_account_id,platform,status,sync_claim_token,credential_generation)
     values ('${currentSnapshotRun}','${raceUserId}','${raceAccountId}','openai_ads','running',
             '${currentSnapshotToken}','${newGeneration}');`,
  ]);
  let staleSnapshotBlocked = false;
  try {
    await runRacingSnapshot(staleSnapshotRun);
  } catch (error) {
    staleSnapshotBlocked = String(error).includes("psql failed");
  }
  if (!staleSnapshotBlocked) {
    throw new Error("Superseded sync claim committed a stale snapshot");
  }
  await runRacingSnapshot(currentSnapshotRun);

  console.log(
    "All migrations, upgrade replay, and OpenAI Ads database checks passed",
  );
} finally {
  if (serverStarted && pgCtlPath) {
    await run(pgCtlPath, [
      "--pgdata",
      dataDirectory,
      "--wait",
      "--mode",
      "fast",
      "stop",
    ]).catch(() => undefined);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
