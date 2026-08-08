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
const writeClientSourcePath = join(projectRoot, "src/lib/meta/write-client.ts");

function transpile(source) {
  return ts.transpileModule(source, {
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

function encodedBody(init) {
  assert.ok(init.body instanceof URLSearchParams);
  return init.body;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-write-client-"));
const originalFetch = globalThis.fetch;

try {
  const cryptoSource = (await readFile(cryptoSourcePath, "utf8")).replace(
    'import "server-only";',
    "",
  );
  const clientSource = (await readFile(clientSourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace('from "./crypto";', 'from "./crypto.mjs";');
  const writeClientSource = (await readFile(writeClientSourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace('from "./client";', 'from "./client.mjs";')
    .replace('from "./crypto";', 'from "./crypto.mjs";');

  assert.match(writeClientSource, /method:\s*"POST"/);
  assert.match(writeClientSource, /method:\s*"GET"/);
  assert.doesNotMatch(writeClientSource, /method:\s*"(?:PUT|PATCH|DELETE)"/);
  assert.match(writeClientSource, /execution_options is controlled/);
  assert.doesNotMatch(writeClientSource, /META_ALLOWED_SCOPES/);

  const cryptoModulePath = join(temporaryDirectory, "crypto.mjs");
  const clientModulePath = join(temporaryDirectory, "client.mjs");
  const writeClientModulePath = join(temporaryDirectory, "write-client.mjs");
  await writeFile(cryptoModulePath, transpile(cryptoSource), "utf8");
  await writeFile(clientModulePath, transpile(clientSource), "utf8");
  await writeFile(writeClientModulePath, transpile(writeClientSource), "utf8");

  const client = await import(pathToFileURL(clientModulePath).href);
  const writeClient = await import(pathToFileURL(writeClientModulePath).href);
  const requests = [];
  const auth = {
    accessToken: "write-token-that-must-not-enter-the-body",
    appSecret: "write-app-secret",
  };

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({ success: true }, {
      headers: {
        "x-app-usage": JSON.stringify({ call_count: 21, total_cputime: 7, total_time: 8 }),
        "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 34 }),
      },
    });
  };

  const campaignPayload = {
    name: "Sommerverkauf",
    objective: "OUTCOME_SALES",
    status: "PAUSED",
    special_ad_categories: [],
    daily_budget: 10_000,
    is_adset_budget_sharing_enabled: false,
  };
  const validation = await writeClient.createMetaCampaign({
    ...auth,
    adAccountId: "act_123456789",
    mode: "validate_only",
    payload: campaignPayload,
  });

  assert.equal(validation.id, null);
  assert.equal(validation.validated, true);
  assert.equal(validation.success, true);
  assert.equal(validation.usage.appPercent, 21);
  assert.equal(validation.usage.adAccountPercent, 34);
  assert.match(validation.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(validation.responseFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(requests[0].url.pathname, "/v25.0/act_123456789/campaigns");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${auth.accessToken}`);
  assert.ok(requests[0].url.searchParams.get("appsecret_proof"));
  assert.equal(requests[0].url.searchParams.has("access_token"), false);
  assert.equal(encodedBody(requests[0].init).get("execution_options"), '["validate_only"]');
  assert.equal(encodedBody(requests[0].init).get("daily_budget"), "10000");
  assert.equal(encodedBody(requests[0].init).has("access_token"), false);
  assert.equal(encodedBody(requests[0].init).has("appsecret_proof"), false);
  assert.equal(String(requests[0].init.body).includes(auth.accessToken), false);

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return jsonResponse({ id: "900000001", success: true });
  };

  const createdCampaign = await writeClient.createMetaCampaign({
    ...auth,
    adAccountId: "123456789",
    mode: "execute",
    payload: campaignPayload,
  });
  assert.equal(createdCampaign.id, "900000001");
  assert.equal(createdCampaign.validated, false);
  assert.equal(encodedBody(requests[0].init).has("execution_options"), false);

  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: { ...campaignPayload, access_token: "forbidden" },
    }),
    /not allowlisted: access_token/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: {
        ...campaignPayload,
        daily_budget: 1000,
        lifetime_budget: 5000,
      },
    }),
    /mutually exclusive/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: { ...campaignPayload, daily_budget: 10.5 },
    }),
    /positive integer/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: { ...campaignPayload, objective: "OUTCOME_UNVERIFIED" },
    }),
    /Unsupported Meta campaign objective/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: { ...campaignPayload, status: "ARCHIVED" },
    }),
    /ACTIVE or PAUSED/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: {
        ...campaignPayload,
        promoted_object: { access_token: "nested-secret" },
      },
    }),
    /Secret-bearing field is forbidden/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: {
        ...campaignPayload,
        promoted_object: { "Access-Token": "obfuscated-secret" },
      },
    }),
    /Secret-bearing field is forbidden/,
  );
  assert.throws(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "validate_only",
      payload: { ...campaignPayload, execution_options: ["validate_only"] },
    }),
    /not allowlisted: execution_options/,
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return jsonResponse({ success: true });
  };
  const adValidation = await writeClient.createMetaAd({
    ...auth,
    adAccountId: "123456789",
    mode: "validate_only",
    payload: {
      name: "Produktanzeige",
      adset_id: "900000002",
      creative: { creative_id: "900000003" },
      conversion_domain: "example.com",
      status: "ACTIVE",
    },
  });
  assert.equal(adValidation.validated, true);
  assert.deepEqual(
    JSON.parse(encodedBody(requests[0].init).get("execution_options")),
    ["validate_only", "synchronous_ad_review"],
  );
  assert.equal(encodedBody(requests[0].init).get("status"), "ACTIVE");

  assert.throws(
    () => writeClient.createMetaAd({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: {
        name: "Inline Creative gesperrt",
        adset_id: "900000002",
        creative: {
          creative_id: "900000003",
          object_story_spec: { page_id: "900000099" },
        },
        status: "ACTIVE",
      },
    }),
    /reference exactly one existing creative_id/,
  );

  assert.throws(
    () => writeClient.createMetaAd({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: {
        name: "Ungültige Domain",
        adset_id: "900000002",
        creative: { creative_id: "900000003" },
        conversion_domain: "https://example.com/path",
        status: "ACTIVE",
      },
    }),
    /registrable domain/,
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return jsonResponse({ success: true });
  };
  await writeClient.updateMetaCampaignBudget({
    ...auth,
    objectId: "900000001",
    mode: "validate_only",
    budgetType: "daily_budget",
    amountMinor: 12_000,
  });
  assert.equal(requests[0].url.pathname, "/v25.0/900000001");
  assert.equal(encodedBody(requests[0].init).get("daily_budget"), "12000");
  assert.equal(encodedBody(requests[0].init).get("execution_options"), '["validate_only"]');

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return jsonResponse({ success: true });
  };
  await writeClient.updateMetaAdStatus({
    ...auth,
    objectId: "900000004",
    mode: "validate_only",
    status: "PAUSED",
  });
  assert.deepEqual(
    JSON.parse(encodedBody(requests[0].init).get("execution_options")),
    ["validate_only", "synchronous_ad_review"],
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      id: "900000004",
      account_id: "123456789",
      campaign_id: "900000001",
      adset_id: "900000002",
      name: "Produktanzeige",
      status: "ACTIVE",
      effective_status: "PENDING_REVIEW",
      creative: { id: "900000003" },
      conversion_domain: "example.com",
    });
  };
  const snapshot = await writeClient.getMetaWriteObjectSnapshot({
    ...auth,
    kind: "ad",
    objectId: "900000004",
  });
  assert.equal(snapshot.kind, "ad");
  assert.equal(snapshot.id, "900000004");
  assert.equal(snapshot.value.effective_status, "PENDING_REVIEW");
  assert.equal(requests[0].init.method, "GET");
  assert.match(requests[0].url.searchParams.get("fields"), /conversion_domain/);
  assert.equal(requests[0].url.searchParams.has("access_token"), false);

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    assert.ok(init.body instanceof FormData);
    const file = init.body.get("filename");
    assert.ok(file instanceof Blob);
    assert.equal(file.type, "image/png");
    assert.deepEqual(
      new Uint8Array(await file.arrayBuffer()),
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]),
    );
    return jsonResponse({
      images: {
        "brand.png": {
          hash: "0123456789abcdef0123456789abcdef",
          url: "https://example.invalid/never-persist-this-as-trusted-input",
        },
      },
    });
  };
  const image = await writeClient.uploadMetaAdImage({
    ...auth,
    adAccountId: "123456789",
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]),
    fileName: "brand.png",
    mimeType: "image/png",
  });
  assert.equal(image.hash, "0123456789abcdef0123456789abcdef");
  assert.equal(image.assetSha256, "4353a1de7e0dcc4e87350e22d5c9ee9f3e70e8ce9c31533ec991bee8870c4814");
  assert.match(image.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(requests[0].url.pathname, "/v25.0/act_123456789/adimages");
  assert.equal(requests[0].init.headers["Content-Type"], undefined);

  await assert.rejects(
    () => writeClient.uploadMetaAdImage({
      ...auth,
      adAccountId: "123456789",
      bytes: new Uint8Array([1, 2, 3, 4]),
      fileName: "fake.png",
      mimeType: "image/png",
    }),
    /MIME type does not match/,
  );

  globalThis.fetch = async () => {
    throw new TypeError("simulated network failure");
  };
  await assert.rejects(
    () => writeClient.updateMetaCampaignStatus({
      ...auth,
      objectId: "900000001",
      mode: "execute",
      status: "PAUSED",
    }),
    (error) => {
      assert.ok(error instanceof writeClient.MetaWriteTransportError);
      assert.equal(error.outcome, "unknown");
      assert.equal(error.operation, "update_campaign_status");
      return true;
    },
  );
  await assert.rejects(
    () => writeClient.updateMetaCampaignStatus({
      ...auth,
      objectId: "900000001",
      mode: "validate_only",
      status: "PAUSED",
    }),
    (error) => {
      assert.ok(error instanceof writeClient.MetaWriteTransportError);
      assert.equal(error.outcome, "not_applied");
      return true;
    },
  );
  await assert.rejects(
    () => writeClient.getMetaWriteObjectSnapshot({
      ...auth,
      kind: "campaign",
      objectId: "900000001",
    }),
    (error) => {
      assert.ok(error instanceof writeClient.MetaWriteTransportError);
      assert.equal(error.outcome, "not_applied");
      return true;
    },
  );

  globalThis.fetch = async () => jsonResponse({
    error: {
      code: 613,
      error_subcode: 2446079,
      message: "sensitive message must not be copied into local error text",
    },
  }, {
    status: 400,
    headers: { "Retry-After": "19" },
  });
  await assert.rejects(
    () => writeClient.updateMetaAdStatus({
      ...auth,
      objectId: "900000004",
      mode: "execute",
      status: "ACTIVE",
    }),
    (error) => {
      assert.ok(error instanceof client.MetaGraphError);
      assert.equal(error.message, "Meta Graph API request failed");
      assert.equal(error.code, 613);
      assert.equal(error.subcode, 2446079);
      assert.equal(error.rateLimited, true);
      assert.equal(error.usage.retryAfterSeconds, 19);
      return true;
    },
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      error: {
        code: 100,
        error_subcode: 1885154,
        message: "Invalid parameter",
        error_user_title: "Ad Set with Promoted Object Is Required",
        error_user_msg:
          "Promoted object must be set when creating this ad set for ON_POST.",
      },
    }, { status: 400 });
  };
  await assert.rejects(
    () => writeClient.createMetaCampaign({
      ...auth,
      adAccountId: "123456789",
      mode: "validate_only",
      payload: {
        name: "Diagnose",
        objective: "OUTCOME_ENGAGEMENT",
        status: "PAUSED",
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: true,
      },
    }),
    (error) => {
      assert.ok(error instanceof client.MetaGraphError);
      assert.equal(error.code, 100);
      assert.equal(error.subcode, 1885154);
      assert.equal(error.errorUserTitle, "Ad Set with Promoted Object Is Required");
      assert.match(
        error.errorUserMessage ?? "",
        /Promoted object must be set/,
      );
      assert.match(
        error.diagnosticDetail ?? "",
        /Promoted object must be set/,
      );
      assert.doesNotMatch(error.diagnosticDetail ?? "", /EAA/);
      return true;
    },
  );
  assert.equal(
    encodedBody(requests[0].init).get("bid_strategy"),
    "LOWEST_COST_WITHOUT_CAP",
  );
  assert.equal(
    encodedBody(requests[0].init).get("is_adset_budget_sharing_enabled"),
    "1",
  );

  globalThis.fetch = async () => jsonResponse({ success: false });
  await assert.rejects(
    () => writeClient.createMetaAd({
      ...auth,
      adAccountId: "123456789",
      mode: "execute",
      payload: {
        name: "Unvollständige Antwort",
        adset_id: "900000002",
        creative: { creative_id: "900000003" },
        status: "ACTIVE",
      },
    }),
    (error) => {
      assert.ok(error instanceof writeClient.MetaWriteProtocolError);
      assert.equal(error.operation, "create_ad");
      return true;
    },
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return jsonResponse({
      id: "900000003",
      account_id: "123456789",
      name: "Organic boost creative",
      object_story_id: "111_222",
    });
  };
  const creativeSnapshot = await writeClient.getMetaWriteObjectSnapshot({
    ...auth,
    kind: "creative",
    objectId: "900000003",
  });
  assert.equal(creativeSnapshot.kind, "creative");
  assert.equal(creativeSnapshot.id, "900000003");
  const creativeFields = requests[0].url.searchParams.get("fields") ?? "";
  assert.match(creativeFields, /object_story_id/);
  assert.doesNotMatch(creativeFields, /(^|,)updated_time(,|$)/);

  console.log("Meta write client regression passed.");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
