import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-meta-budget-planner-"),
);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const platformAccountId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const marketingSyncId = "10000000-0000-4000-8000-000000000003";
const readLeaseToken = "10000000-0000-4000-8000-000000000004";
const snapshotId = "10000000-0000-4000-8000-000000000005";

try {
  const exposureRelinkMigrationPath = join(
    projectRoot,
    "supabase/migrations/20260802073000_fix_exposure_snapshot_id_upsert.sql",
  );
  const exposureRelinkMigration = await readFile(
    exposureRelinkMigrationPath,
    "utf8",
  );
  assert.match(
    exposureRelinkMigration,
    /policy_id = excluded\.policy_id,/,
  );
  assert.match(
    exposureRelinkMigration,
    /snapshot_id = excluded\.snapshot_id,/,
  );
  assert.match(
    exposureRelinkMigration,
    /v_occurrences <> 2/,
  );

  const plannerRegressionPath = join(
    projectRoot,
    "scripts/test-meta-budget-planner.sql",
  );
  const plannerRegression = await readFile(plannerRegressionPath, "utf8");
  assert.match(
    plannerRegression,
    /A second successful marketing sync on the same account day/,
  );
  assert.match(
    plannerRegression,
    /exposure\.snapshot_id = v_new_snapshot_id/,
  );
  assert.match(
    plannerRegression,
    /Same-day exposure row was not relinked to the latest snapshot/,
  );

  const organicSurviveMigration = await readFile(
    join(
      projectRoot,
      "supabase/migrations/20260806220000_meta_organic_boost_survive_marketing_snapshot.sql",
    ),
    "utf8",
  );
  assert.match(
    organicSurviveMigration,
    /source_rule_key is distinct from 'organic-boost'/,
  );
  assert.match(
    organicSurviveMigration,
    /run_meta_budget_planner/,
  );

  const hardCapDayResumeMigration = await readFile(
    join(
      projectRoot,
      "supabase/migrations/20260809080000_meta_hard_cap_day_resume.sql",
    ),
    "utf8",
  );
  assert.match(
    hardCapDayResumeMigration,
    /queue_meta_hard_cap_resume_internal/,
  );
  assert.match(
    hardCapDayResumeMigration,
    /hard_cap_day_resume/,
  );
  assert.match(
    hardCapDayResumeMigration,
    /'hard_cap_day_resume',\s*1,\s*'ACTIVATE'/,
  );
  assert.match(
    hardCapDayResumeMigration,
    /Could not normalize planner outcome checks to CREATED\/QUEUED/,
  );
  assert.match(
    hardCapDayResumeMigration,
    /Hard-cap day-resume patch did not apply to budget planner/,
  );
  assert.match(
    hardCapDayResumeMigration,
    /regexp_replace/,
  );
  assert.match(
    hardCapDayResumeMigration,
    /boost:campaign:%/,
  );

  const hardCapActivateConstraintMigration = await readFile(
    join(
      projectRoot,
      "supabase/migrations/20260809090000_meta_hard_cap_activate_safety_constraint.sql",
    ),
    "utf8",
  );
  assert.match(
    hardCapActivateConstraintMigration,
    /mutation_plans_safety_type_check/,
  );
  assert.match(
    hardCapActivateConstraintMigration,
    /action_type in \('SAFETY_PAUSE', 'ACTIVATE'\)/,
  );
  assert.match(
    hardCapActivateConstraintMigration,
    /queue_meta_hard_cap_resume_internal/,
  );

  const organicBoostHardCapExemptMigration = await readFile(
    join(
      projectRoot,
      "supabase/migrations/20260809100000_meta_organic_boost_hard_cap_pause_exempt.sql",
    ),
    "utf8",
  );
  assert.match(
    organicBoostHardCapExemptMigration,
    /organic_boost_hard_cap_exempt/,
  );
  assert.match(
    organicBoostHardCapExemptMigration,
    /Beitrag-Push/,
  );

  const forceResumeBoostHardCapMigration = await readFile(
    join(
      projectRoot,
      "supabase/migrations/20260809110000_meta_force_resume_organic_boost_hard_cap.sql",
    ),
    "utf8",
  );
  assert.match(
    forceResumeBoostHardCapMigration,
    /force_resume_meta_organic_boost_hard_cap_pauses/,
  );
  assert.match(
    forceResumeBoostHardCapMigration,
    /HARD_CAP_SAFETY/,
  );

  const finishBoostHardCapResumeMigration = await readFile(
    join(
      projectRoot,
      "supabase/migrations/20260809120000_meta_finish_organic_boost_hard_cap_resume.sql",
    ),
    "utf8",
  );
  assert.match(
    finishBoostHardCapResumeMigration,
    /resume_without_last_seen_sync/,
  );
  assert.match(
    finishBoostHardCapResumeMigration,
    /schedule_ended/,
  );

  const sourcePath = join(projectRoot, "src/lib/meta/planner.ts");
  const source = (await readFile(sourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace('from "../supabase/admin";', 'from "./admin.mjs";');

  const adminStub = `
export function createAdminClient() {
  return {
    async rpc(name, args) {
      globalThis.__plannerTest.calls.push({ name, args });
      const queued = globalThis.__plannerTest.responses[name];
      if (!queued || queued.length === 0) {
        throw new Error(\`Unexpected RPC: \${name}\`);
      }
      return queued.shift();
    },
  };
}
`;

  await writeFile(join(temporaryDirectory, "admin.mjs"), adminStub, "utf8");
  const modulePath = join(temporaryDirectory, "planner.mjs");
  await writeFile(modulePath, transpile(source), "utf8");
  const planner = await import(pathToFileURL(modulePath).href);

  function configure(responses) {
    globalThis.__plannerTest = {
      calls: [],
      responses: Object.fromEntries(
        Object.entries(responses).map(([name, values]) => [
          name,
          Array.isArray(values) ? [...values] : [values],
        ]),
      ),
    };
  }

  configure({
    claim_meta_account_operation: { data: readLeaseToken, error: null },
  });
  assert.equal(
    await planner.claimMetaReadOperation({
      platformAccountId,
      userId,
      ownerId: "meta-sync:test-owner",
    }),
    readLeaseToken,
  );
  assert.deepEqual(globalThis.__plannerTest.calls[0], {
    name: "claim_meta_account_operation",
    args: {
      p_platform_account_id: platformAccountId,
      p_user_id: userId,
      p_lease_kind: "READ_SYNC",
      p_owner_id: "meta-sync:test-owner",
      p_lease_seconds: 900,
    },
  });

  configure({
    claim_meta_account_operation: { data: null, error: null },
  });
  assert.equal(
    await planner.claimMetaReadOperation({
      platformAccountId,
      userId,
      ownerId: "meta-sync:locked",
    }),
    null,
  );

  configure({
    claim_meta_account_operation: { data: null, error: { code: "XX000" } },
  });
  await assert.rejects(
    planner.claimMetaReadOperation({
      platformAccountId,
      userId,
      ownerId: "meta-sync:error",
    }),
    (error) => error.code === "lease_claim_failed",
  );

  const campaignBudgetSharingSnapshot = [
    {
      platform_campaign_id: "30000000000000001",
      is_adset_budget_sharing_enabled: false,
    },
    {
      platform_campaign_id: "30000000000000002",
      is_adset_budget_sharing_enabled: null,
    },
  ];
  configure({
    record_meta_campaign_budget_sharing_snapshot: { data: 2, error: null },
    run_meta_budget_planner: {
      data: [
        {
          planner_status: "PLANNED",
          snapshot_id: snapshotId,
          account_day: "2026-07-29",
          observed_budget_owner_count: 2,
          reserved_exposure_minor: 26250,
          plans_created: 1,
          plans_existing: 0,
          candidates_blocked: 3,
          hard_cap_breach: false,
        },
      ],
      error: null,
    },
  });
  const result = await planner.runMetaBudgetPlannerAfterSnapshot({
    platformAccountId,
    userId,
    marketingSyncId,
    readLeaseToken,
    campaignBudgetSharingSnapshot,
    plannedAt: "2026-07-29T12:00:00.000Z",
  });
  assert.deepEqual(result, {
    status: "PLANNED",
    snapshotId,
    accountDay: "2026-07-29",
    observedBudgetOwnerCount: 2,
    reservedExposureMinor: 26250,
    plansCreated: 1,
    plansExisting: 0,
    candidatesBlocked: 3,
    hardCapBreach: false,
  });
  assert.deepEqual(
    globalThis.__plannerTest.calls.map((call) => call.name),
    [
      "record_meta_campaign_budget_sharing_snapshot",
      "run_meta_budget_planner",
    ],
  );
  assert.deepEqual(
    globalThis.__plannerTest.calls[0].args.p_campaigns,
    campaignBudgetSharingSnapshot,
  );
  assert.equal(
    globalThis.__plannerTest.calls[1].args.p_source_marketing_sync_id,
    marketingSyncId,
  );
  assert.equal(
    globalThis.__plannerTest.calls[1].args.p_read_lease_token,
    readLeaseToken,
  );

  for (const plannerStatus of [
    "ACCOUNT_UNAVAILABLE",
    "STALE_OR_INVALID_SNAPSHOT",
    "INVALID_PLANNER_TIME",
    "KILL_SWITCH_BLOCKED",
  ]) {
    configure({
      record_meta_campaign_budget_sharing_snapshot: { data: 2, error: null },
      run_meta_budget_planner: {
        data: [
          {
            planner_status: plannerStatus,
            snapshot_id: snapshotId,
            account_day: "2026-07-29",
            observed_budget_owner_count: 2,
            reserved_exposure_minor: 26250,
            plans_created: 0,
            plans_existing: 0,
            candidates_blocked: 0,
            hard_cap_breach: false,
          },
        ],
        error: null,
      },
    });

    const statusResult = await planner.runMetaBudgetPlannerAfterSnapshot({
      platformAccountId,
      userId,
      marketingSyncId,
      readLeaseToken,
      campaignBudgetSharingSnapshot,
      plannedAt: "2026-07-29T12:00:00.000Z",
    });
    assert.equal(statusResult.status, plannerStatus);
  }

  configure({
    record_meta_campaign_budget_sharing_snapshot: {
      data: null,
      error: { code: "23514" },
    },
  });
  await assert.rejects(
    planner.runMetaBudgetPlannerAfterSnapshot({
      platformAccountId,
      userId,
      marketingSyncId,
      readLeaseToken,
      campaignBudgetSharingSnapshot,
      plannedAt: "2026-07-29T12:00:00.000Z",
    }),
    (error) => error.code === "sharing_snapshot_failed",
  );
  assert.deepEqual(
    globalThis.__plannerTest.calls.map((call) => call.name),
    ["record_meta_campaign_budget_sharing_snapshot"],
  );

  configure({
    record_meta_campaign_budget_sharing_snapshot: { data: 2, error: null },
    run_meta_budget_planner: {
      data: [{ planner_status: "UNKNOWN" }],
      error: null,
    },
  });
  await assert.rejects(
    planner.runMetaBudgetPlannerAfterSnapshot({
      platformAccountId,
      userId,
      marketingSyncId,
      readLeaseToken,
      campaignBudgetSharingSnapshot,
      plannedAt: "2026-07-29T12:00:00.000Z",
    }),
    (error) => error.code === "planner_result_invalid",
  );

  configure({
    release_meta_account_operation: { data: true, error: null },
  });
  await planner.releaseMetaAccountOperation({
    platformAccountId,
    userId,
    leaseToken: readLeaseToken,
  });
  assert.deepEqual(globalThis.__plannerTest.calls[0], {
    name: "release_meta_account_operation",
    args: {
      p_platform_account_id: platformAccountId,
      p_user_id: userId,
      p_lease_token: readLeaseToken,
    },
  });

  configure({
    release_meta_account_operation: { data: false, error: null },
  });
  await assert.rejects(
    planner.releaseMetaAccountOperation({
      platformAccountId,
      userId,
      leaseToken: readLeaseToken,
    }),
    (error) => error.code === "lease_release_failed",
  );

  console.log("Meta budget planner bridge checks passed");
} finally {
  delete globalThis.__plannerTest;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
