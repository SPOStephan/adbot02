import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260819100000_creative_generation_phase2_openrouter.sql",
);
const sourceRoot = join(root, "src/lib/creative-assets");
const enqueueRoutePath = join(
  root,
  "src/app/api/meta/automation/creative-assets/enqueue/route.ts",
);
const phase2DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE2.md",
);
const packagePath = join(root, "package.json");

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
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(pixels)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const migration = await readFile(migrationPath, "utf8");
const enqueueRoute = await readFile(enqueueRoutePath, "utf8");
const phase2Doc = await readFile(phase2DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /asset_role/);
assert.match(migration, /'GENERATED'/);
assert.match(
  migration,
  /creative_generation_input_contract_valid\(p_input_payload\)/,
);
assert.match(migration, /create or replace function public\.complete_creative_asset_job/);
assert.match(migration, /create or replace function public\.enqueue_creative_asset_job/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /materialize_meta_launch_chain_plan/);

assert.match(enqueueRoute, /authenticateMetaCustomer/);
assert.match(enqueueRoute, /parseCreativeAssetEnqueueBody/);
assert.match(enqueueRoute, /enqueueCreativeAssetGenerationJob/);
assert.match(phase2Doc, /mode=`free`|mode=free|mode=\`free\`/);
assert.match(phase2Doc, /OPENROUTER_API_KEY/);
assert.match(phase2Doc, /does not.*charge|skipped in Phase 2/i);

assert.equal(
  packageJson.scripts["test:creative-generation-phase2"],
  "node scripts/test-creative-generation-phase2.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase2/,
);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-creative-generation-phase2-"),
);
const originalFetch = globalThis.fetch;

try {
  const files = [
    ["types.ts", "types.mjs"],
    ["image.ts", "image.mjs"],
    ["generation-contract.ts", "generation-contract.mjs"],
    ["map-generation-input.ts", "map-generation-input.mjs"],
    ["http-provider.ts", "http-provider.mjs"],
    ["providers/openrouter.ts", "openrouter.mjs"],
    ["providers/index.ts", "providers-index.mjs"],
    ["env.ts", "env.mjs"],
    ["enqueue.ts", "enqueue.mjs"],
  ];

  for (const [relative, outName] of files) {
    let source = await readFile(join(sourceRoot, relative), "utf8");
    source = source
      .replace('import "server-only";', "")
      .replaceAll('from "../image";', 'from "./image.mjs";')
      .replaceAll('from "../types";', 'from "./types.mjs";')
      .replaceAll(
        'from "../map-generation-input";',
        'from "./map-generation-input.mjs";',
      )
      .replaceAll('from "./image";', 'from "./image.mjs";')
      .replaceAll('from "./types";', 'from "./types.mjs";')
      .replaceAll(
        'from "./generation-contract";',
        'from "./generation-contract.mjs";',
      )
      .replaceAll(
        'from "./map-generation-input";',
        'from "./map-generation-input.mjs";',
      )
      .replaceAll('from "./http-provider";', 'from "./http-provider.mjs";')
      .replaceAll(
        'from "./providers/openrouter";',
        'from "./openrouter.mjs";',
      )
      .replaceAll('from "./openrouter";', 'from "./openrouter.mjs";')
      .replaceAll('from "../env";', 'from "./env.mjs";')
      .replaceAll("@/lib/creative-assets/generation-contract", "./generation-contract.mjs")
      .replaceAll("@/lib/creative-assets/env", "./env.mjs")
      .replaceAll(
        "@/lib/creative-assets/map-generation-input",
        "./map-generation-input.mjs",
      )
      .replaceAll("@/lib/meta/customer-control-input", "./customer-control-input-stub.mjs")
      .replaceAll("@/lib/supabase/admin", "./admin-stub.mjs");
    await writeFile(
      join(temporaryDirectory, outName),
      transpile(source),
      "utf8",
    );
  }

  await writeFile(
    join(temporaryDirectory, "customer-control-input-stub.mjs"),
    [
      "export class CustomerControlInputError extends Error {",
      "  constructor(code, message) {",
      "    super(message);",
      "    this.name = 'CustomerControlInputError';",
      "    this.code = code;",
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "admin-stub.mjs"),
    "export function createAdminClient() { throw new Error('admin stub'); }\n",
    "utf8",
  );

  const mapMod = await import(
    pathToFileURL(join(temporaryDirectory, "map-generation-input.mjs")).href
  );
  const openrouterMod = await import(
    pathToFileURL(join(temporaryDirectory, "openrouter.mjs")).href
  );
  const envMod = await import(
    pathToFileURL(join(temporaryDirectory, "env.mjs")).href
  );
  const enqueueMod = await import(
    pathToFileURL(join(temporaryDirectory, "enqueue.mjs")).href
  );
  const types = await import(
    pathToFileURL(join(temporaryDirectory, "types.mjs")).href
  );

  const freeInput = {
    contract_version: "adbot-creative-generation-v1",
    mode: "free",
    provider_key: "openrouter",
    model_id: "google/gemini-2.5-flash-image",
    prompt: "A clean product photo",
    reference_asset_ids: [],
    locked_photo_asset_ids: [],
    output: { mime_type: "image/png", aspect_hint: "1:1" },
  };

  const job = {
    jobId: "10000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000002",
    platformAccountId: "10000000-0000-4000-8000-000000000003",
    brandProfileId: "10000000-0000-4000-8000-000000000004",
    providerKey: "openrouter",
    providerModel: "google/gemini-2.5-flash-image",
    providerVersion: null,
    idempotencyKey: "a".repeat(64),
    inputPayload: freeInput,
    inputHash: "b".repeat(64),
    attemptCount: 1,
    leaseToken: "10000000-0000-4000-8000-000000000005",
  };

  const mapped = mapMod.mapCreativeGenerationInputForPhase2Execution(job);
  assert.equal(mapped.mode, "free");
  assert.equal(mapped.provider_key, "openrouter");

  await assert.rejects(
    async () => {
      mapMod.mapCreativeGenerationInputForPhase2Execution({
        ...job,
        inputPayload: {
          ...freeInput,
          mode: "locked_photo",
          locked_photo_asset_ids: [
            "10000000-0000-4000-8000-000000000099",
          ],
        },
      });
    },
    (error) =>
      error instanceof mapMod.CreativeGenerationPhase2Error &&
      error.code === "POLICY_REJECTED" &&
      /locked_photo/i.test(error.message) &&
      error.safeToRetry === false,
  );

  await assert.rejects(
    async () => {
      mapMod.mapCreativeGenerationInputForPhase2Execution({
        ...job,
        inputPayload: {
          ...freeInput,
          reference_asset_ids: [
            "10000000-0000-4000-8000-000000000088",
          ],
        },
      });
    },
    (error) =>
      error instanceof mapMod.CreativeGenerationPhase2Error &&
      error.code === "POLICY_REJECTED",
  );

  const png = createPng();
  const provider = new openrouterMod.OpenRouterCreativeAssetProvider({
    key: "openrouter",
    apiKey: "test-openrouter-key-never-committed",
    baseUrl: "https://openrouter.ai/api/v1",
    modelAllowlist: ["google/gemini-2.5-flash-image"],
    defaultModel: "google/gemini-2.5-flash-image",
    allowedAssetHosts: ["cdn.openrouter.example"],
    timeoutMs: 5_000,
    httpReferer: "https://adbot.example",
    appTitle: "AdBot",
  });
  assert.equal(provider.guaranteesIdempotency, true);
  assert.equal(provider.key, "openrouter");

  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse({
      created: 1,
      data: [{ b64_json: Buffer.from(png).toString("base64"), media_type: "image/png" }],
      usage: { cost: 0.01 },
    });
  };

  const generated = await provider.generate({
    job,
    signal: new AbortController().signal,
  });
  assert.equal(generated.source.kind, "bytes");
  assert.equal(generated.declaredMimeType, "image/png");
  assert.equal(requests[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(requests[0].init.headers["Idempotency-Key"], job.idempotencyKey);
  assert.equal(requests[0].init.headers["HTTP-Referer"], "https://adbot.example");
  assert.equal(requests[0].init.headers["X-Title"], "AdBot");
  assert.match(requests[0].init.headers.Authorization, /^Bearer /);
  assert.equal(requests[0].init.body.includes("test-openrouter-key"), false);
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, "google/gemini-2.5-flash-image");
  assert.equal(body.output_format, "png");
  assert.equal(body.aspect_ratio, "1:1");
  assert.equal(body.n, 1);

  // Allowlist rejection
  await assert.rejects(
    () =>
      provider.generate({
        job: {
          ...job,
          providerModel: "evil/not-allowed",
          inputPayload: { ...freeInput, model_id: "evil/not-allowed" },
        },
        signal: new AbortController().signal,
      }),
    (error) =>
      error instanceof types.CreativeAssetProviderError &&
      error.code === "model_not_allowlisted",
  );

  // Nested images + url shape with allowlisted host
  const parsed = openrouterMod.parseOpenRouterImageResponse({
    payload: {
      images: [
        { url: "https://cdn.openrouter.example/a.png", media_type: "image/png" },
      ],
    },
    fallbackMimeType: "image/png",
    allowedAssetHosts: new Set(["cdn.openrouter.example"]),
    requestId: "req-1",
  });
  assert.equal(parsed.source.kind, "url");

  await assert.rejects(
    async () => {
      openrouterMod.parseOpenRouterImageResponse({
        payload: {
          data: [{ url: "https://evil.example/a.png" }],
        },
        fallbackMimeType: "image/png",
        allowedAssetHosts: new Set(["cdn.openrouter.example"]),
        requestId: "req-2",
      });
    },
    /nicht auf einem freigegebenen HTTPS-Host/,
  );

  // Env allowlist helper
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CREATIVE_ASSET_") || key === "OPENROUTER_API_KEY") {
      delete process.env[key];
    }
  }
  process.env.CREATIVE_ASSET_PROVIDER_KEY = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.CREATIVE_ASSET_OPENROUTER_MODEL_ALLOWLIST =
    "google/gemini-2.5-flash-image,other/model";
  assert.equal(envMod.hasCreativeAssetProviderConfig(), true);
  assert.equal(
    envMod.isModelAllowlistedForConfiguredProvider(
      "openrouter",
      "google/gemini-2.5-flash-image",
    ),
    true,
  );
  assert.equal(
    envMod.isModelAllowlistedForConfiguredProvider("openrouter", "nope"),
    false,
  );

  // Enqueue body parsing rejects locked_photo
  assert.throws(
    () =>
      enqueueMod.parseCreativeAssetEnqueueBody({
        brandProfileId: "10000000-0000-4000-8000-000000000004",
        ...freeInput,
        mode: "locked_photo",
        locked_photo_asset_ids: ["10000000-0000-4000-8000-000000000099"],
      }),
    (error) => error.name === "CustomerControlInputError",
  );

  const parsedEnqueue = enqueueMod.parseCreativeAssetEnqueueBody({
    brandProfileId: "10000000-0000-4000-8000-000000000004",
    ...freeInput,
  });
  assert.equal(parsedEnqueue.input.mode, "free");

  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CREATIVE_ASSET_") || key === "OPENROUTER_API_KEY") {
      delete process.env[key];
    }
  }
  Object.assign(process.env, previous);

  console.log(
    JSON.stringify({
      ok: true,
      migrationSha256,
      migration:
        "supabase/migrations/20260819100000_creative_generation_phase2_openrouter.sql",
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
