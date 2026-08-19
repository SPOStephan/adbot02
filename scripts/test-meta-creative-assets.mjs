import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const sourceRoot = join(projectRoot, "src/lib/creative-assets");
const cronRoutePath = join(
  projectRoot,
  "src/app/api/cron/creative-assets/route.ts",
);
const metaEnvPath = join(projectRoot, "src/lib/meta/env.ts");
const vercelPath = join(projectRoot, "vercel.json");

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value >>> 0);
  return output;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBytes, data]);
  return Buffer.concat([
    uint32(data.length),
    typeBytes,
    data,
    uint32(crc32(crcInput)),
  ]);
}

function createPng(width = 256, height = 256) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowBytes = 1 + width * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-creative-assets-"));
const originalFetch = globalThis.fetch;

try {
  const [cronRouteSource, metaEnvSource, vercelSource] = await Promise.all([
    readFile(cronRoutePath, "utf8"),
    readFile(metaEnvPath, "utf8"),
    readFile(vercelPath, "utf8"),
  ]);
  const sourceFiles = [
    "types",
    "image",
    "http-provider",
    "generation-contract",
    "locked-photo-constants",
    "style-reference-constants",
    "map-generation-input",
    "env",
    "storage",
    "worker",
    "catalog",
  ];
  for (const name of sourceFiles) {
    let source = await readFile(join(sourceRoot, `${name}.ts`), "utf8");
    source = source
      .replace('import "server-only";', "")
      .replaceAll('from "./types";', 'from "./types.mjs";')
      .replaceAll('from "./image";', 'from "./image.mjs";')
      .replaceAll('from "./http-provider";', 'from "./http-provider.mjs";')
      .replaceAll('from "./env";', 'from "./env.mjs";')
      .replaceAll('from "./storage";', 'from "./storage.mjs";')
      .replaceAll(
        'from "./generation-contract";',
        'from "./generation-contract.mjs";',
      )
      .replaceAll(
        'from "./locked-photo-constants";',
        'from "./locked-photo-constants.mjs";',
      )
      .replaceAll(
        'from "./style-reference-constants";',
        'from "./style-reference-constants.mjs";',
      )
      .replaceAll(
        'from "./map-generation-input";',
        'from "./map-generation-input.mjs";',
      )
      .replaceAll(
        'from "./locked-photo-compose";',
        'from "./locked-photo-compose-stub.mjs";',
      )
      .replaceAll(
        'from "./locked-photo-load";',
        'from "./locked-photo-load-stub.mjs";',
      )
      .replaceAll('from "./providers";', 'from "./providers-stub.mjs";')
      .replace(
        'from "../supabase/admin";',
        'from "./admin-stub.mjs";',
      )
      .replace(
        'from "../billing/credits";',
        'from "./billing-credits-stub.mjs";',
      );
    await writeFile(
      join(temporaryDirectory, `${name}.mjs`),
      transpile(source)
        .replace(
          /from\s+["'][^"']*locked-photo-compose[^"']*["']/g,
          'from "./locked-photo-compose-stub.mjs"',
        )
        .replace(
          /from\s+["'][^"']*locked-photo-load[^"']*["']/g,
          'from "./locked-photo-load-stub.mjs"',
        )
        .replace(
          /from\s+["'][^"']*billing\/credits[^"']*["']/g,
          'from "./billing-credits-stub.mjs"',
        )
        .replaceAll(
          'from "./locked-photo-constants"',
          'from "./locked-photo-constants.mjs"',
        )
        .replaceAll(
          'from "./style-reference-constants"',
          'from "./style-reference-constants.mjs"',
        ),
      "utf8",
    );
  }
  await writeFile(
    join(temporaryDirectory, "locked-photo-compose-stub.mjs"),
    "export async function composeLockedPhotoCreative() { throw new Error('compose stub'); }\n",
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "locked-photo-load-stub.mjs"),
    "export async function loadVerifiedLockedPhotoAssets() { return []; }\n",
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "billing-credits-stub.mjs"),
    [
      "export async function commitCreditReservation() { return true; }",
      "export async function releaseCreditReservation() { return true; }",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "providers-stub.mjs"),
    [
      "export function createCreativeAssetProviders() {",
      '  throw new Error("providers stub — inject providers in worker tests");',
      "}",
      "export function getConfiguredCreativeAssetProviderKey() {",
      '  return "stub";',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "admin-stub.mjs"),
    [
      "let adminClient;",
      "export function setAdminClient(value) { adminClient = value; }",
      "export function createAdminClient() {",
      '  if (!adminClient) throw new Error("admin stub");',
      "  return adminClient;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const image = await import(pathToFileURL(join(temporaryDirectory, "image.mjs")).href);
  const providerModule = await import(
    pathToFileURL(join(temporaryDirectory, "http-provider.mjs")).href
  );
  const types = await import(pathToFileURL(join(temporaryDirectory, "types.mjs")).href);
  const adminStub = await import(
    pathToFileURL(join(temporaryDirectory, "admin-stub.mjs")).href
  );
  const storage = await import(
    pathToFileURL(join(temporaryDirectory, "storage.mjs")).href
  );
  const worker = await import(pathToFileURL(join(temporaryDirectory, "worker.mjs")).href);
  const catalog = await import(
    pathToFileURL(join(temporaryDirectory, "catalog.mjs")).href
  );

  const png = createPng();
  const inspected = image.inspectCreativeImage({
    bytes: png,
    declaredMimeType: "image/png",
  });
  assert.equal(inspected.width, 256);
  assert.equal(inspected.height, 256);
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () => image.inspectCreativeImage({
      bytes: new Uint8Array([...png, 0]),
      declaredMimeType: "image/png",
    }),
    /vollständig validierbare PNG/,
  );
  assert.throws(
    () => image.inspectCreativeImage({
      bytes: png,
      declaredMimeType: "image/jpeg",
    }),
    /MIME-Typ/,
  );
  assert.throws(
    () => image.inspectCreativeImage({
      bytes: createPng(128, 256),
      declaredMimeType: "image/png",
    }),
    /256–4096/,
  );
  assert.throws(
    () => image.sanitizeAssetMetadata({ "Access-Token": "forbidden" }),
    /Geheimes Feld/,
  );
  assert.equal(
    image.safeCreativeFileName({
      requestedName: "../Sonder Motiv.PNG",
      jobId: "job-1",
      mimeType: "image/png",
    }),
    "Sonder-Motiv.png",
  );

  let bucketPublic = true;
  let bucketUpdate;
  let uploadedObject;
  adminStub.setAdminClient({
    storage: {
      async getBucket() {
        return { data: { public: bucketPublic }, error: null };
      },
      async createBucket() {
        throw new Error("existing bucket must not be recreated");
      },
      async updateBucket(bucket, options) {
        bucketUpdate = { bucket, options };
        bucketPublic = options.public;
        return { error: null };
      },
      from(bucket) {
        return {
          async upload(path, bytes, options) {
            uploadedObject = { bucket, path, bytes, options };
            return { error: null };
          },
        };
      },
    },
  });
  const stored = await storage.storeCreativeAssetInSupabase({
    userId: "10000000-0000-4000-8000-000000000002",
    platformAccountId: "10000000-0000-4000-8000-000000000003",
    bytes: png,
    sha256: inspected.sha256,
    mimeType: "image/png",
    bucket: "creative-assets",
  });
  assert.equal(bucketUpdate.options.public, false);
  assert.deepEqual(bucketUpdate.options.allowedMimeTypes, ["image/png", "image/jpeg"]);
  assert.equal(bucketPublic, false);
  assert.equal(stored.bucket, "creative-assets");
  assert.match(
    stored.path,
    /^10000000-0000-4000-8000-000000000002\/10000000-0000-4000-8000-000000000003\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/,
  );
  assert.equal(uploadedObject.path, stored.path);
  assert.equal(uploadedObject.options.upsert, true);
  await assert.rejects(
    () => storage.storeCreativeAssetInSupabase({
      userId: "10000000-0000-4000-8000-000000000002",
      platformAccountId: "10000000-0000-4000-8000-000000000003",
      bytes: png,
      sha256: "../unsafe",
      mimeType: "image/png",
      bucket: "creative-assets",
    }),
    /storage input is invalid/,
  );

  const existingMetaAsset = {
    id: "10000000-0000-4000-8000-000000000010",
    sourceType: "EXISTING_META",
    mimeType: "image/png",
    width: 1200,
    height: 1200,
    brandPolicyVersion: 2,
    metaImageHash: "meta-hash-1",
    storageBucket: null,
    storagePath: null,
    sha256: "c".repeat(64),
    updatedAt: "2026-07-29T10:00:00.000Z",
  };
  const generatedAsset = {
    ...existingMetaAsset,
    id: "10000000-0000-4000-8000-000000000011",
    sourceType: "GENERATED",
    metaImageHash: null,
    storageBucket: "creative-assets",
    storagePath: "generated.png",
    sha256: "d".repeat(64),
    updatedAt: "2026-07-29T11:00:00.000Z",
  };
  const reused = catalog.decideBrandAssetAction({
    candidates: [generatedAsset, existingMetaAsset],
    requirement: {
      allowedMimeTypes: ["image/png"],
      minimumWidth: 1080,
      minimumHeight: 1080,
      targetAspectRatio: 1,
      currentBrandPolicyVersion: 2,
    },
  });
  assert.equal(reused.action, "REUSE");
  assert.equal(reused.asset.id, existingMetaAsset.id);
  assert.deepEqual(catalog.decideBrandAssetAction({
    candidates: [existingMetaAsset],
    requirement: { allowedMimeTypes: ["image/jpeg"] },
  }), {
    action: "GENERATE",
    asset: null,
    reason: "NO_FORMAT_MATCH",
  });
  assert.equal(catalog.decideBrandAssetAction({
    candidates: [existingMetaAsset],
    requirement: {
      allowedMimeTypes: ["image/png"],
      targetAspectRatio: 1.91,
      aspectRatioTolerance: 0.05,
    },
  }).reason, "NO_DIMENSION_MATCH");

  const job = {
    jobId: "10000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000002",
    platformAccountId: "10000000-0000-4000-8000-000000000003",
    brandProfileId: "10000000-0000-4000-8000-000000000004",
    providerKey: "customer_http",
    providerModel: "image-model-v1",
    providerVersion: "2026-07",
    idempotencyKey: "a".repeat(64),
    inputPayload: { prompt: "Sachliches Produktmotiv", aspect_ratio: "1:1" },
    inputHash: "b".repeat(64),
    attemptCount: 1,
    leaseToken: "10000000-0000-4000-8000-000000000005",
    creditReservationId: null,
  };

  const requests = [];
  const httpProvider = new providerModule.HttpCreativeAssetProvider({
    key: "customer_http",
    endpoint: "https://provider.example.test/v1/generate",
    apiKey: "test-provider-key-never-committed-to-runtime-output",
    allowedAssetHosts: ["assets.example.test"],
    timeoutMs: 5_000,
  });
  assert.equal(httpProvider.guaranteesIdempotency, true);

  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse({
      request_id: "req-1",
      asset_id: "asset-1",
      file_name: "creative.png",
      mime_type: "image/png",
      moderation_status: "APPROVED",
      asset_base64: Buffer.from(png).toString("base64"),
      metadata: { seed: "stable" },
    });
  };
  const generated = await httpProvider.generate({
    job,
    signal: new AbortController().signal,
  });
  assert.equal(generated.providerAssetId, "asset-1");
  assert.deepEqual(await httpProvider.materialize(
    generated,
    new AbortController().signal,
  ), png);
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["Idempotency-Key"], job.idempotencyKey);
  assert.equal(
    requests[0].init.headers["X-Adbot-Contract-Version"],
    types.CREATIVE_ASSET_PROVIDER_CONTRACT_VERSION,
  );
  assert.match(requests[0].init.headers.Authorization, /^Bearer /);
  assert.equal(requests[0].init.body.includes("test-provider-key"), false);

  globalThis.fetch = async () => jsonResponse(
    { error: "busy" },
    { status: 503, headers: { "retry-after": "120" } },
  );
  await assert.rejects(
    () => httpProvider.generate({ job, signal: new AbortController().signal }),
    (error) => error instanceof types.CreativeAssetProviderError &&
      error.failureMode === "REMOTE_REJECTED" &&
      error.safeToRetry === true &&
      error.retryAfterSeconds === 120,
  );

  globalThis.fetch = async () => {
    throw new TypeError("network details must not escape");
  };
  await assert.rejects(
    () => httpProvider.generate({ job, signal: new AbortController().signal }),
    (error) => error instanceof types.CreativeAssetProviderError &&
      error.failureMode === "AMBIGUOUS_TRANSPORT" &&
      !error.message.includes("network details"),
  );

  globalThis.fetch = async () => jsonResponse({
    asset_id: "asset-2",
    mime_type: "image/png",
    moderation_status: "APPROVED",
    download_url: "https://evil.example.test/creative.png",
  });
  await assert.rejects(
    () => httpProvider.generate({ job, signal: new AbortController().signal }),
    /nicht auf einem freigegebenen HTTPS-Host/,
  );

  const order = [];
  const fakeProvider = {
    key: "customer_http",
    contractVersion: "test-v1",
    guaranteesIdempotency: true,
    async generate() {
      order.push("generate");
      return {
        providerRequestId: "req-worker",
        providerAssetId: "asset-worker",
        fileName: "motiv.png",
        declaredMimeType: "image/png",
        source: { kind: "bytes", bytes: png },
        moderationStatus: "APPROVED",
        metadata: { purpose: "meta_ad" },
      };
    },
    async materialize(result) {
      order.push("materialize");
      return result.source.bytes;
    },
  };
  const completed = [];
  const result = await worker.runCreativeAssetWorkerOnce({
    ownerId: "cron-test",
    dependencies: {
      providers: new Map([[fakeProvider.key, fakeProvider]]),
      async claim() { order.push("claim"); return job; },
      async markDispatched() { order.push("dispatch"); },
      async store(input) {
        order.push("store");
        assert.match(input.sha256, /^[a-f0-9]{64}$/);
        return { bucket: "creative-assets", path: `${input.sha256}.png` };
      },
      async complete(input) {
        order.push("complete");
        completed.push(input);
        return "asset-local-1";
      },
      async fail() { throw new Error("unexpected failure"); },
    },
  });
  assert.deepEqual(order, [
    "claim", "dispatch", "generate", "materialize", "store", "complete",
  ]);
  assert.deepEqual(result, {
    outcome: "completed",
    jobId: job.jobId,
    status: "SUCCEEDED",
    assetId: "asset-local-1",
  });
  assert.equal(completed[0].metadata.provider_contract_version, "test-v1");

  let missingProviderFailure;
  const missingProvider = await worker.runCreativeAssetWorkerOnce({
    ownerId: "cron-test",
    dependencies: {
      providers: new Map(),
      async claim() { return job; },
      async markDispatched() { throw new Error("must not dispatch"); },
      async store() { throw new Error("must not store"); },
      async complete() { throw new Error("must not complete"); },
      async fail(input) {
        missingProviderFailure = input;
        return "FAILED";
      },
    },
  });
  assert.equal(missingProvider.status, "FAILED");
  assert.equal(missingProviderFailure.failureMode, "PRE_DISPATCH");

  let ambiguousFailure;
  const ambiguousProvider = {
    ...fakeProvider,
    async generate() {
      throw new types.CreativeAssetProviderError({
        code: "provider_timeout",
        message: "Provideraufruf hat das Zeitlimit überschritten.",
        failureMode: "AMBIGUOUS_TRANSPORT",
      });
    },
  };
  const ambiguous = await worker.runCreativeAssetWorkerOnce({
    ownerId: "cron-test",
    dependencies: {
      providers: new Map([[ambiguousProvider.key, ambiguousProvider]]),
      async claim() { return job; },
      async markDispatched() {},
      async store() { throw new Error("must not store"); },
      async complete() { throw new Error("must not complete"); },
      async fail(input) {
        ambiguousFailure = input;
        return "AMBIGUOUS";
      },
    },
  });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  assert.equal(ambiguousFailure.safeToRetry, false);
  assert.equal(ambiguousFailure.failureMode, "AMBIGUOUS_TRANSPORT");

  assert.match(cronRouteSource, /getCronAuthEnv\(\)/);
  assert.match(cronRouteSource, /constantTimeEqual/);
  assert.match(cronRouteSource, /`Bearer \$\{cronSecret\}`/);
  assert.match(cronRouteSource, /hasCreativeAssetProviderConfig\(\)/);
  assert.match(cronRouteSource, /processNextCreativeAssetJob\(/);
  assert.match(cronRouteSource, /AbortSignal\.timeout\(150_000\)/);
  assert.match(cronRouteSource, /private, no-store/);
  assert.doesNotMatch(cronRouteSource, /jobId:/);
  assert.match(
    metaEnvSource,
    /requiredSecret\("CRON_SECRET", process\.env\.CRON_SECRET\)/,
  );
  const vercel = JSON.parse(vercelSource);
  assert.deepEqual(
    vercel.crons.find((entry) => entry.path === "/api/cron/creative-assets"),
    { path: "/api/cron/creative-assets", schedule: "*/5 * * * *" },
  );

  console.log("Meta creative asset provider checks passed");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
