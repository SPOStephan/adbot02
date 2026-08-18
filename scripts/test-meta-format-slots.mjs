import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const formatsPath = join(root, "src/lib/media-library/meta-formats.ts");
const source = await readFile(formatsPath, "utf8");

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-formats-"));
try {
  const modulePath = join(temporaryDirectory, "meta-formats.mjs");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  await writeFile(modulePath, transpiled, "utf8");
  const formats = await import(pathToFileURL(modulePath).href);

  assert.equal(formats.META_FORMAT_SLOTS.length, 3);
  assert.equal(formats.isMetaFormatKey("meta_feed_1x1"), true);
  assert.equal(formats.isMetaFormatKey("nope"), false);

  assert.equal(formats.matchesMetaFormat(1080, 1080, formats.META_FORMAT_SLOTS[0]), true);
  assert.equal(formats.matchesMetaFormat(1200, 1200, formats.META_FORMAT_SLOTS[0]), true);
  assert.equal(formats.matchesMetaFormat(1080, 1350, formats.META_FORMAT_SLOTS[1]), true);
  assert.equal(formats.matchesMetaFormat(1080, 1920, formats.META_FORMAT_SLOTS[2]), true);
  assert.equal(formats.matchesMetaFormat(1200, 628, formats.META_FORMAT_SLOTS[2]), false);
  assert.equal(formats.matchesMetaFormat(1080, 1920, formats.META_FORMAT_SLOTS[0]), false);
  assert.equal(formats.matchesMetaFormat(400, 400, formats.META_FORMAT_SLOTS[0]), false);

  const needing = formats.presetsNeedingCrop(1080, 1080);
  assert.deepEqual(needing, ["meta_feed_4x5", "meta_story_9x16"]);

  assert.equal(formats.META_FORMAT_SLOTS[2].key, "meta_story_9x16");
  assert.equal(formats.META_FORMAT_SLOTS[2].width, 1080);
  assert.equal(formats.META_FORMAT_SLOTS[2].height, 1920);
  assert.equal(formats.formatLabelForDimensions(1080, 1920), "Story 9:16");
  assert.equal(formats.formatLabelForDimensions(1200, 628), null);

  const allNeed = formats.presetsNeedingCrop(2000, 1500);
  assert.equal(allNeed.length, 3);

  const ok = formats.describeMetaFormatCheck(1080, 1080, formats.META_FORMAT_SLOTS[0]);
  assert.equal(ok.ok, true);
  const bad = formats.describeMetaFormatCheck(800, 600, formats.META_FORMAT_SLOTS[0]);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Feed 1:1/);

  const cropsSource = await readFile(
    join(root, "src/lib/media-library/meta-crops.ts"),
    "utf8",
  );
  assert.match(cropsSource, /presetsNeedingCrop/);
  assert.match(cropsSource, /originalWidth/);

  const uploadSource = await readFile(
    join(root, "src/lib/media-library/upload.ts"),
    "utf8",
  );
  assert.match(uploadSource, /metaFormatKey/);
  assert.match(uploadSource, /format_mismatch/);
  assert.match(uploadSource, /cropsSkipped/);

  const routeSource = await readFile(
    join(root, "src/app/api/meta/automation/asset-upload/route.ts"),
    "utf8",
  );
  assert.match(routeSource, /metaFormatKey/);
  assert.match(routeSource, /isMetaFormatKey/);

  const picker = await readFile(
    join(root, "src/components/CreativePickerModal.tsx"),
    "utf8",
  );
  assert.match(picker, /Drei Meta-Formate/);
  assert.match(picker, /Ein Bild · Auto-Zuschnitt/);
  assert.match(picker, /uploadFormatSlot/);
  assert.match(picker, /readImageDimensions/);
  assert.match(picker, /meta_story_9x16/);
  assert.doesNotMatch(picker, /meta_link_191x1/);
  assert.doesNotMatch(picker, /createImageBitmap/); // lives in meta-formats

  const mediaLibrary = await readFile(
    join(root, "src/components/MediaLibraryClient.tsx"),
    "utf8",
  );
  assert.match(mediaLibrary, /Trash2/);
  assert.match(mediaLibrary, /\/api\/media-library\/asset/);
  assert.match(mediaLibrary, /media-library\/preview\?assetId=/);
  assert.match(mediaLibrary, /formatLabelForDimensions/);

  const deleteRoute = await readFile(
    join(root, "src/app/api/media-library/asset/route.ts"),
    "utf8",
  );
  assert.match(deleteRoute, /revoke_brand_asset/);
  assert.match(deleteRoute, /export async function DELETE/);
  assert.match(deleteRoute, /parent_asset_id/);

  const creativesPage = await readFile(
    join(root, "src/app/dashboard/creatives/page.tsx"),
    "utf8",
  );
  assert.match(creativesPage, /\.neq\("status", "REVOKED"\)/);

  console.log("Meta creative format slots contract tests passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
