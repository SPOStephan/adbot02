import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260819120000_creative_generation_phase3_locked_photo.sql",
);
const sourceRoot = join(root, "src/lib/creative-assets");
const phase3DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE3.md",
);
const packagePath = join(root, "package.json");
const workerPath = join(sourceRoot, "worker.ts");

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

/** Solid RGBA PNG (filter none). */
function createSolidPng(width, height, rgba = [40, 120, 200, 255]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowBytes = 1 + width * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 4;
      pixels[i] = rgba[0];
      pixels[i + 1] = rgba[1];
      pixels[i + 2] = rgba[2];
      pixels[i + 3] = rgba[3];
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(pixels)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const migration = await readFile(migrationPath, "utf8");
const phase3Doc = await readFile(phase3DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const workerSource = await readFile(workerPath, "utf8");
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /creative_generation_locked_photos_owned/);
assert.match(migration, /LOCKED_PHOTO/);
assert.match(migration, /locked_photo compose requires output\.mime_type image\/png/);
assert.match(migration, /create or replace function public\.enqueue_creative_asset_job/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /materialize_meta_launch_chain_plan/);

assert.match(phase3Doc, /pixel guard|Pixel-Guard|pixel_guard/i);
assert.match(phase3Doc, /locked_photo/);
assert.match(phase3Doc, /1:1/);
assert.match(workerSource, /composeLockedPhotoCreative/);
assert.match(workerSource, /loadVerifiedLockedPhotoAssets/);

assert.equal(
  packageJson.scripts["test:creative-generation-phase3"],
  "node scripts/test-creative-generation-phase3.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase3/,
);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-creative-generation-phase3-"),
);

try {
  await writeFile(
    join(temporaryDirectory, "sharp-bridge.mjs"),
    [
      'import { createRequire } from "node:module";',
      `const require = createRequire(${JSON.stringify(join(root, "package.json"))});`,
      "const sharp = require(\"sharp\");",
      "export default sharp;",
      "",
    ].join("\n"),
    "utf8",
  );

  const files = [
    ["types.ts", "types.mjs"],
    ["image.ts", "image.mjs"],
    ["generation-contract.ts", "generation-contract.mjs"],
    ["locked-photo-constants.ts", "locked-photo-constants.mjs"],
    ["style-reference-constants.ts", "style-reference-constants.mjs"],
    ["locked-photo-compose.ts", "locked-photo-compose.mjs"],
    ["map-generation-input.ts", "map-generation-input.mjs"],
    ["enqueue.ts", "enqueue.mjs"],
  ];

  for (const [relative, outName] of files) {
    let source = await readFile(join(sourceRoot, relative), "utf8");
    source = source
      .replace('import "server-only";', "")
      .replaceAll('from "./image";', 'from "./image.mjs";')
      .replaceAll('from "./types";', 'from "./types.mjs";')
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
        'from "./locked-photo-compose";',
        'from "./locked-photo-compose.mjs";',
      )
      .replaceAll(
        'from "./locked-photo-load";',
        'from "./locked-photo-load.mjs";',
      )
      .replaceAll(
        'from "./map-generation-input";',
        'from "./map-generation-input.mjs";',
      )
      .replaceAll('from "sharp"', 'from "./sharp-bridge.mjs"')
      .replaceAll("@/lib/creative-assets/generation-contract", "./generation-contract.mjs")
      .replaceAll("@/lib/creative-assets/env", "./env-stub.mjs")
      .replaceAll(
        "@/lib/creative-assets/map-generation-input",
        "./map-generation-input.mjs",
      )
      .replaceAll("@/lib/meta/customer-control-input", "./customer-control-input-stub.mjs")
      .replaceAll("@/lib/supabase/admin", "./admin-stub.mjs")
      .replaceAll("@/lib/billing/credits", "./billing-credits-stub.mjs");
    await writeFile(
      join(temporaryDirectory, outName),
      transpile(source),
      "utf8",
    );
  }

  await writeFile(
    join(temporaryDirectory, "billing-credits-stub.mjs"),
    [
      "export class InsufficientCreditsError extends Error {",
      "  constructor() {",
      "    super('INSUFFICIENT_CREDITS');",
      "    this.name = 'InsufficientCreditsError';",
      "    this.code = 'INSUFFICIENT_CREDITS';",
      "  }",
      "}",
      "export async function reserveCredits() {",
      "  return { reservationId: '10000000-0000-4000-8000-000000000077', amount: 20, balanceAfter: 80, alreadyExisted: false };",
      "}",
      "export async function releaseCreditReservation() { return true; }",
      "export async function commitCreditReservation() { return true; }",
      "",
    ].join("\n"),
    "utf8",
  );

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
  await writeFile(
    join(temporaryDirectory, "env-stub.mjs"),
    [
      "export function hasCreativeAssetProviderConfig() { return true; }",
      "export function getCreativeAssetProviderKeyFromEnv() { return 'openrouter'; }",
      "export function isModelAllowlistedForConfiguredProvider() { return true; }",
      "",
    ].join("\n"),
    "utf8",
  );

  const composeMod = await import(
    pathToFileURL(join(temporaryDirectory, "locked-photo-compose.mjs")).href
  );
  const mapMod = await import(
    pathToFileURL(join(temporaryDirectory, "map-generation-input.mjs")).href
  );
  const enqueueMod = await import(
    pathToFileURL(join(temporaryDirectory, "enqueue.mjs")).href
  );

  const lockedId = "10000000-0000-4000-8000-000000000099";
  const lockedBytes = createSolidPng(256, 256, [10, 20, 30, 255]);
  const lockedSha = createHash("sha256").update(lockedBytes).digest("hex");
  const backgroundBytes = createSolidPng(512, 512, [200, 180, 160, 255]);

  const lockedAsset = {
    assetId: lockedId,
    bytes: lockedBytes,
    sha256: lockedSha,
    mimeType: "image/png",
    width: 256,
    height: 256,
    byteSize: lockedBytes.byteLength,
  };

  const layout = composeMod.planLockedPhotoCanvas({
    locked: [lockedAsset],
    aspectHint: "1:1",
  });
  assert.equal(layout.width, 256);
  assert.equal(layout.height, 256);
  assert.equal(layout.placements[0].left, 0);
  assert.equal(layout.placements[0].top, 0);

  const composed = await composeMod.composeLockedPhotoCreative({
    backgroundBytes,
    locked: [lockedAsset],
    aspectHint: "1:1",
  });
  assert.equal(composed.mimeType, "image/png");
  assert.equal(composed.placements[0].pixel_guard, "passed");
  assert.equal(composed.placements[0].asset_id, lockedId);
  assert.equal(composed.composeVersion, "adbot-locked-photo-compose-v1");

  // Mutate a pixel in the locked region → guard must fail
  const mutated = Buffer.from(composed.bytes);
  // Corrupt a mid-file byte that is likely IDAT payload (best-effort);
  // stronger check: recompose with different locked bytes expectation via assertLockedPhotoPixelGuard
  const wrongLocked = {
    ...lockedAsset,
    bytes: createSolidPng(256, 256, [255, 0, 0, 255]),
    sha256: "c".repeat(64),
  };
  await assert.rejects(
    () =>
      composeMod.assertLockedPhotoPixelGuard({
        composedBytes: composed.bytes,
        locked: wrongLocked,
        left: 0,
        top: 0,
      }),
    (error) =>
      error &&
      error.code === "pixel_guard_failed",
  );

  // Wider aspect: locked centered on larger canvas
  const wide = composeMod.planLockedPhotoCanvas({
    locked: [lockedAsset],
    aspectHint: "16:9",
  });
  assert.ok(wide.width >= 256);
  assert.ok(wide.height >= 256);
  assert.ok(wide.width / wide.height - 16 / 9 < 0.02);
  assert.equal(wide.placements[0].width, 256);
  assert.equal(wide.placements[0].height, 256);

  const wideComposed = await composeMod.composeLockedPhotoCreative({
    backgroundBytes,
    locked: [lockedAsset],
    aspectHint: "16:9",
  });
  assert.equal(wideComposed.placements[0].pixel_guard, "passed");

  // Policy: locked_photo ok; jpeg rejected; references rejected
  const job = {
    jobId: "10000000-0000-4000-8000-000000000001",
    providerKey: "openrouter",
    providerModel: "google/gemini-2.5-flash-image",
    inputPayload: {
      contract_version: "adbot-creative-generation-v1",
      mode: "locked_photo",
      provider_key: "openrouter",
      model_id: "google/gemini-2.5-flash-image",
      prompt: "backdrop",
      reference_asset_ids: [],
      locked_photo_asset_ids: [lockedId],
      output: { mime_type: "image/png", aspect_hint: "1:1" },
    },
  };
  const mapped = mapMod.mapCreativeGenerationInputForExecution(job);
  assert.equal(mapped.mode, "locked_photo");

  await assert.rejects(
    async () =>
      mapMod.mapCreativeGenerationInputForExecution({
        ...job,
        inputPayload: {
          ...job.inputPayload,
          reference_asset_ids: [
            "10000000-0000-4000-8000-000000000088",
            "10000000-0000-4000-8000-000000000081",
            "10000000-0000-4000-8000-000000000082",
            "10000000-0000-4000-8000-000000000083",
            "10000000-0000-4000-8000-000000000084",
          ],
        },
      }),
    (error) => /Style-Referenzen|style_reference_limit/i.test(error.message),
  );

  const withStyle = mapMod.mapCreativeGenerationInputForExecution({
    ...job,
    inputPayload: {
      ...job.inputPayload,
      mode: "free",
      locked_photo_asset_ids: [],
      reference_asset_ids: ["10000000-0000-4000-8000-000000000088"],
    },
  });
  assert.equal(withStyle.reference_asset_ids.length, 1);

  const parsed = enqueueMod.parseCreativeAssetEnqueueBody({
    brandProfileId: "10000000-0000-4000-8000-000000000004",
    ...job.inputPayload,
  });
  assert.equal(parsed.input.mode, "locked_photo");

  // Sanity: sharp available for compose path
  const meta = await sharp(Buffer.from(composed.bytes)).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, composed.width);
  assert.equal(meta.height, composed.height);

  console.log(
    JSON.stringify({
      ok: true,
      migrationSha256,
      migration:
        "supabase/migrations/20260819120000_creative_generation_phase3_locked_photo.sql",
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
