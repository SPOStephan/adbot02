import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const source = (relativePath) => join(projectRoot, relativePath);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-executor-"));
const originalFetch = globalThis.fetch;

const IDS = {
  execution: "00000000-0000-4000-8000-000000000001",
  plan: "00000000-0000-4000-8000-000000000002",
  user: "00000000-0000-4000-8000-000000000003",
  account: "00000000-0000-4000-8000-000000000004",
  policy: "00000000-0000-4000-8000-000000000005",
  lease: "00000000-0000-4000-8000-000000000006",
  step1: "00000000-0000-4000-8000-000000000011",
  step2: "00000000-0000-4000-8000-000000000012",
  step3: "00000000-0000-4000-8000-000000000013",
  step4: "00000000-0000-4000-8000-000000000014",
  asset: "00000000-0000-4000-8000-000000000015",
};
const HASH = "a".repeat(64);

function transpile(value) {
  return ts.transpileModule(value, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function step({
  id = IDS.step1,
  index = 0,
  operation = "VALIDATE",
  objectType = "AD_SET",
  request,
}) {
  return {
    stepId: id,
    stepIndex: index,
    operation,
    objectType,
    plannedRequest: request,
    requestHash: HASH,
    dispatchState: "NOT_DISPATCHED",
  };
}

function claim(firstStep, overrides = {}) {
  return {
    executionId: IDS.execution,
    planId: IDS.plan,
    userId: IDS.user,
    platformAccountId: IDS.account,
    policyId: IDS.policy,
    leaseToken: IDS.lease,
    actionType: "UPDATE_BUDGET",
    targetType: "AD_SET",
    targetKey: "ad_set:222222222",
    plannedPayload: {},
    expectedBefore: {},
    intendedAfter: {},
    firstStep,
    ...overrides,
  };
}

function dependenciesFor({
  firstStep,
  nextSteps = [],
  bindings = [],
  reconcileOutcome = "SUCCEEDED",
  credentialsError = null,
  brandAssetError = null,
  completeRemoteError = null,
} = {}) {
  const events = [];
  const failures = [];
  const completions = [];
  const snapshots = [];
  let claimStepCalls = 0;

  const dependencies = {
    async claim(workerId, leaseSeconds) {
      events.push(`claim:${workerId}:${leaseSeconds}`);
      return firstStep ? claim(firstStep) : null;
    },
    async heartbeat(_executionId, _leaseToken, leaseSeconds) {
      events.push(`heartbeat:${leaseSeconds}`);
    },
    async claimStep() {
      claimStepCalls += 1;
      events.push("claim-step");
      return nextSteps.shift() ?? null;
    },
    async beginDispatch(_executionId, stepId) {
      events.push(`begin:${stepId}`);
    },
    async bindings() {
      events.push("bindings");
      return bindings;
    },
    async completeRemote(input) {
      events.push(`complete:${input.stepId}`);
      completions.push(input);
      if (completeRemoteError) throw completeRemoteError;
    },
    async recordSnapshot(input) {
      events.push(`snapshot:${input.stepId}`);
      snapshots.push(input);
    },
    async reconcile() {
      events.push("reconcile");
      return reconcileOutcome;
    },
    async fail(input) {
      events.push(`fail:${input.failure.remoteOutcome}`);
      failures.push(input);
      if (input.failure.remoteOutcome === "UNKNOWN") return "RECONCILING";
      if (
        input.failure.errorClass === "RATE_LIMIT"
        || input.failure.errorClass === "TRANSPORT"
      ) {
        return "RETRYABLE";
      }
      return "FAILED";
    },
    async credentials() {
      events.push("credentials");
      if (credentialsError) throw credentialsError;
      return {
        accessToken: "executor-token-not-for-logs",
        appSecret: "executor-app-secret",
        adAccountId: "111111111",
      };
    },
    async brandAsset() {
      events.push("brand-asset");
      if (brandAssetError) throw brandAssetError;
      return {
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        fileName: "asset.png",
        mimeType: "image/png",
        sha256: HASH,
      };
    },
  };

  return {
    dependencies,
    events,
    failures,
    completions,
    snapshots,
    get claimStepCalls() {
      return claimStepCalls;
    },
  };
}

try {
  const cryptoSource = (await readFile(source("src/lib/meta/crypto.ts"), "utf8"))
    .replace('import "server-only";', "");
  const clientSource = (await readFile(source("src/lib/meta/client.ts"), "utf8"))
    .replace('import "server-only";', "")
    .replace('from "./crypto";', 'from "./crypto.mjs";');
  const writeClientSource = (await readFile(source("src/lib/meta/write-client.ts"), "utf8"))
    .replace('import "server-only";', "")
    .replace('from "./client";', 'from "./client.mjs";')
    .replace('from "./crypto";', 'from "./crypto.mjs";');
  const executorRouteSource = await readFile(
    source("src/app/api/cron/meta-executor/route.ts"),
    "utf8",
  );
  const vercelConfig = JSON.parse(await readFile(source("vercel.json"), "utf8"));
  const executorSource = (await readFile(source("src/lib/meta/executor.ts"), "utf8"))
    .replace('import "server-only";', "")
    .replace('from "../supabase/admin";', 'from "./admin.mjs";')
    .replace('from "../creative-assets/image";', 'from "./image.mjs";')
    .replace('from "../creative-assets/types";', 'from "./creative-types.mjs";')
    .replace('from "./client";', 'from "./client.mjs";')
    .replace('from "./crypto";', 'from "./crypto.mjs";')
    .replace('from "./env";', 'from "./env.mjs";')
    .replace('from "./write-client";', 'from "./write-client.mjs";');

  assert.match(executorSource, /await input\.beforeRemote\(\)/);
  assert.match(executorSource, /remoteOutcome:.*"UNKNOWN"/s);
  assert.doesNotMatch(executorSource, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(executorSource, /access_token_encrypted.*console/s);
  assert.match(executorRouteSource, /constantTimeEqual\(supplied, `Bearer \$\{cronSecret\}`\)/);
  assert.match(executorRouteSource, /export const maxDuration = 300/);
  assert.match(executorRouteSource, /processNextMetaMutation/);
  assert.match(executorRouteSource, /processed: result\.processed \? 1 : 0/);
  assert.doesNotMatch(executorRouteSource, /planId|executionId|platformAccountId|leaseToken/);
  assert.deepEqual(
    vercelConfig.crons.find((item) => item.path === "/api/cron/meta-executor"),
    { path: "/api/cron/meta-executor", schedule: "* * * * *" },
  );

  await writeFile(join(temporaryDirectory, "crypto.mjs"), transpile(cryptoSource));
  await writeFile(join(temporaryDirectory, "client.mjs"), transpile(clientSource));
  await writeFile(join(temporaryDirectory, "write-client.mjs"), transpile(writeClientSource));
  await writeFile(
    join(temporaryDirectory, "admin.mjs"),
    "export function createAdminClient(){ throw new Error('admin stub must not be called'); }\n",
  );
  await writeFile(
    join(temporaryDirectory, "image.mjs"),
    "export function inspectCreativeImage(){ throw new Error('image stub must not be called'); }\nexport function safeCreativeFileName(){ return 'asset.png'; }\n",
  );
  await writeFile(join(temporaryDirectory, "creative-types.mjs"), "export {};\n");
  await writeFile(
    join(temporaryDirectory, "env.mjs"),
    "export function getMetaSyncEnv(){ throw new Error('env stub must not be called'); }\n",
  );
  await writeFile(join(temporaryDirectory, "executor.mjs"), transpile(executorSource));

  const executor = await import(pathToFileURL(join(temporaryDirectory, "executor.mjs")).href);

  {
    const harness = dependenciesFor();
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-idle",
      dependencies: harness.dependencies,
    });
    assert.deepEqual(result, { processed: false, outcome: "idle", stepsProcessed: 0 });
    assert.deepEqual(harness.events, [
      `claim:test-worker-idle:${executor.META_EXECUTOR_LEASE_SECONDS}`,
    ]);
  }

  {
    const requests = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      if (init.method === "GET") {
        return jsonResponse({
          id: "222222222",
          account_id: "111111111",
          campaign_id: "333333333",
          status: "ACTIVE",
          effective_status: "ACTIVE",
          daily_budget: "12000",
        });
      }
      return jsonResponse({ success: true });
    };

    const validate = step({
      request: {
        operation: "UPDATE_BUDGET",
        mode: "validate_only",
        object_type: "AD_SET",
        object_id: "222222222",
        budget_type: "daily_budget",
        amount_minor: 12000,
      },
    });
    const execute = step({
      id: IDS.step2,
      index: 1,
      operation: "UPDATE",
      request: {
        operation: "UPDATE_BUDGET",
        mode: "execute",
        object_type: "AD_SET",
        object_id: "222222222",
        budget_type: "daily_budget",
        amount_minor: 12000,
      },
    });
    const read = step({
      id: IDS.step3,
      index: 2,
      operation: "READ",
      request: {
        operation: "READ_OBJECT",
        object_type: "AD_SET",
        object_id: "222222222",
      },
    });
    const reconcile = step({
      id: IDS.step4,
      index: 3,
      operation: "RECONCILE",
      request: { operation: "RECONCILE_PLAN" },
    });
    const harness = dependenciesFor({
      firstStep: validate,
      nextSteps: [execute, read, reconcile],
    });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-budget",
      dependencies: harness.dependencies,
    });

    assert.equal(result.processed, true);
    assert.equal(result.outcome, "succeeded");
    assert.equal(result.stepsProcessed, 4);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[1].init.method, "POST");
    assert.equal(requests[2].init.method, "GET");
    assert.equal(requests[0].init.body.get("execution_options"), '["validate_only"]');
    assert.equal(requests[1].init.body.has("execution_options"), false);
    assert.equal(requests[1].init.body.get("daily_budget"), "12000");
    assert.equal(harness.completions[0].completion.validated, true);
    assert.equal(harness.completions[1].completion.validated, false);
    assert.equal(harness.snapshots[0].value.daily_budget, "12000");
    assert.ok(
      harness.events.indexOf(`begin:${IDS.step1}`)
      < harness.events.indexOf(`complete:${IDS.step1}`),
    );
    assert.ok(
      harness.events.indexOf(`begin:${IDS.step2}`)
      < harness.events.indexOf(`complete:${IDS.step2}`),
    );
    assert.equal(harness.failures.length, 0);
  }

  {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse({ success: true });
    };
    const invalid = step({
      request: {
        operation: "UPDATE_STATUS",
        mode: "validate_only",
        object_id: "222222222",
        status: "ARCHIVED",
      },
    });
    const harness = dependenciesFor({ firstStep: invalid });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-preflight",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "failed");
    assert.equal(fetchCalls, 0);
    assert.equal(harness.events.some((value) => value.startsWith("begin:")), false);
    assert.equal(harness.failures[0].failure.remoteOutcome, "NOT_APPLIED");
    assert.equal(harness.failures[0].failure.errorCode, "invalid_planned_request");
  }

  {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new TypeError("simulated socket reset");
    };
    const update = step({
      operation: "UPDATE",
      request: {
        operation: "UPDATE_STATUS",
        mode: "execute",
        object_id: "222222222",
        status: "PAUSED",
      },
    });
    const harness = dependenciesFor({ firstStep: update });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-ambiguous",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "ambiguous");
    assert.equal(fetchCalls, 1);
    assert.equal(harness.failures[0].failure.remoteOutcome, "UNKNOWN");
    assert.equal(harness.claimStepCalls, 0);
    assert.deepEqual(
      harness.events.filter((value) => value.startsWith("begin:") || value.startsWith("fail:")),
      [`begin:${IDS.step1}`, "fail:UNKNOWN"],
    );
  }

  {
    globalThis.fetch = async () => jsonResponse({ success: true });
    const update = step({
      operation: "UPDATE",
      request: {
        operation: "UPDATE_STATUS",
        mode: "execute",
        object_id: "222222222",
        status: "PAUSED",
      },
    });
    const harness = dependenciesFor({
      firstStep: update,
      completeRemoteError: new executor.MetaMutationExecutorError("database_failed"),
    });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-post-response",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "ambiguous");
    assert.equal(harness.failures[0].failure.errorCode, "remote_completion_persist_failed");
    assert.equal(harness.failures[0].failure.remoteOutcome, "UNKNOWN");
    assert.equal(harness.claimStepCalls, 0);
  }

  {
    globalThis.fetch = async () => jsonResponse(
      { error: { message: "rate limited", type: "OAuthException", code: 613 } },
      { status: 429, headers: { "Retry-After": "321" } },
    );
    const validate = step({
      request: {
        operation: "UPDATE_BUDGET",
        mode: "validate_only",
        object_id: "222222222",
        budget_type: "daily_budget",
        amount_minor: 11000,
      },
    });
    const harness = dependenciesFor({ firstStep: validate });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-rate-limit",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "retryable");
    assert.equal(harness.failures[0].failure.errorClass, "RATE_LIMIT");
    assert.equal(harness.failures[0].failure.remoteOutcome, "NOT_APPLIED");
    assert.equal(harness.failures[0].failure.retryAfterSeconds, 321);
  }

  {
    let capturedBody;
    globalThis.fetch = async (_input, init) => {
      capturedBody = init.body;
      return jsonResponse({ id: "444444444", success: true });
    };
    const createAdSet = step({
      operation: "CREATE",
      objectType: "AD_SET",
      request: {
        operation: "CREATE_AD_SET",
        mode: "execute",
        payload: {
          name: "Autonomous Ad Set",
          campaign_id: { $binding_step_id: IDS.step1 },
          billing_event: "IMPRESSIONS",
          optimization_goal: "LINK_CLICKS",
          targeting: { geo_locations: { countries: ["DE"] } },
          status: "PAUSED",
          daily_budget: 10000,
        },
      },
    });
    const reconcile = step({
      id: IDS.step2,
      index: 1,
      operation: "RECONCILE",
      objectType: "AD_SET",
      request: { operation: "RECONCILE_PLAN" },
    });
    const harness = dependenciesFor({
      firstStep: createAdSet,
      nextSteps: [reconcile],
      bindings: [{
        stepId: IDS.step1,
        objectType: "CAMPAIGN",
        remoteObjectId: "333333333",
      }],
    });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-binding",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "succeeded");
    assert.equal(capturedBody.get("campaign_id"), "333333333");
    assert.equal(harness.completions[0].completion.remoteObjectId, "444444444");
  }

  {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse({ images: { one: { hash: "abcd1234abcd1234" } } });
    };
    const upload = step({
      operation: "CREATE",
      objectType: "IMAGE",
      request: {
        operation: "UPLOAD_IMAGE",
        brand_asset_id: IDS.asset,
        asset_sha256: HASH,
      },
    });
    const harness = dependenciesFor({
      firstStep: upload,
      brandAssetError: new executor.MetaMutationExecutorError("asset_invalid"),
    });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-asset",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "failed");
    assert.equal(fetchCalls, 0);
    assert.equal(harness.events.includes("brand-asset"), true);
    assert.equal(harness.events.some((value) => value.startsWith("begin:")), false);
    assert.equal(harness.failures[0].failure.remoteOutcome, "NOT_APPLIED");
  }

  {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init.method, "GET");
      return jsonResponse({ id: "222222222", status: "PAUSED" });
    };
    const read = step({
      operation: "READ",
      objectType: "AD_SET",
      request: {
        operation: "READ_OBJECT",
        object_id: { $binding_step_id: IDS.step1 },
      },
    });
    const reconcile = step({
      id: IDS.step2,
      index: 1,
      operation: "RECONCILE",
      objectType: "AD_SET",
      request: { operation: "RECONCILE_PLAN" },
    });
    const harness = dependenciesFor({
      firstStep: read,
      nextSteps: [reconcile],
      bindings: [{
        stepId: IDS.step1,
        objectType: "AD_SET",
        remoteObjectId: "222222222",
      }],
      reconcileOutcome: "MISMATCH",
    });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-read-mismatch",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "mismatch");
    assert.equal(harness.snapshots[0].objectId, "222222222");
    assert.equal(harness.events.some((value) => value.startsWith("begin:")), false);
  }

  {
    let fetchCalls = 0;
    let postedUrl = "";
    globalThis.fetch = async (input, init) => {
      fetchCalls += 1;
      postedUrl = String(input);
      assert.equal(init.method, "POST");
      const body = init.body;
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get("status"), "ACTIVE");
      return jsonResponse({ success: true });
    };
    const activate = step({
      id: IDS.step2,
      index: 1,
      operation: "UPDATE",
      objectType: "AD_SET",
      request: {
        operation: "UPDATE_STATUS",
        mode: "execute",
        object_id: { $binding_step_id: IDS.step1 },
        status: "ACTIVE",
      },
    });
    const harness = dependenciesFor({
      firstStep: activate,
      bindings: [{
        stepId: IDS.step1,
        objectType: "AD_SET",
        remoteObjectId: "222222222",
      }],
    });
    const result = await executor.runMetaMutationExecutorOnce({
      workerId: "test-worker-activate-binding",
      dependencies: harness.dependencies,
    });
    assert.equal(result.outcome, "deferred");
    assert.equal(fetchCalls, 1);
    assert.match(postedUrl, /222222222/);
    assert.equal(harness.failures.length, 0);
    assert.equal(harness.events.some((value) => value.startsWith("begin:")), true);
  }

  console.log("Meta mutation executor regression: OK");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
