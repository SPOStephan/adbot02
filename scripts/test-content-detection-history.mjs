import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-content-detection-history-"),
);

try {
  const source = await readFile(
    join(root, "src/lib/meta/content-detection-history.ts"),
    "utf8",
  );
  const modulePath = join(temporaryDirectory, "history.mjs");
  await writeFile(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf8",
  );

  const {
    isDetectionInWindow,
    localDayKey,
    summarizeDetectionWindows,
  } = await import(pathToFileURL(modulePath).href);

  const noonBerlin = new Date("2026-08-21T10:00:00.000Z"); // 12:00 Europe/Berlin (CEST)
  assert.equal(localDayKey(noonBerlin), "2026-08-21");
  assert.equal(localDayKey("2026-08-21T01:30:00.000Z"), "2026-08-21");
  assert.equal(localDayKey("2026-08-20T22:30:00.000Z"), "2026-08-21");

  const items = [
    {
      source: "instagram",
      firstSeenAt: "2026-08-21T08:05:00.000Z",
    },
    {
      source: "facebook",
      firstSeenAt: "2026-08-19T12:00:00.000Z",
    },
    {
      source: "instagram",
      firstSeenAt: "2026-08-10T12:00:00.000Z",
    },
  ];

  const summary = summarizeDetectionWindows(items, noonBerlin);
  assert.equal(summary.today.total, 1);
  assert.equal(summary.today.instagram, 1);
  assert.equal(summary.today.facebook, 0);
  assert.equal(summary.week.total, 2);
  assert.equal(summary.week.facebook, 1);
  assert.equal(summary.week.instagram, 1);

  assert.equal(
    isDetectionInWindow(items[0].firstSeenAt, "today", noonBerlin),
    true,
  );
  assert.equal(
    isDetectionInWindow(items[1].firstSeenAt, "today", noonBerlin),
    false,
  );
  assert.equal(
    isDetectionInWindow(items[1].firstSeenAt, "week", noonBerlin),
    true,
  );

  const snapshotSource = await readFile(
    join(root, "src/lib/meta/content-sync-snapshot.ts"),
    "utf8",
  );
  assert.match(snapshotSource, /detectionHistory/);
  assert.match(snapshotSource, /assetSyncHints/);
  assert.match(snapshotSource, /first_seen_at, last_seen_at, is_new/);
  assert.match(snapshotSource, /\.gte\("first_seen_at"/);

  const panelSource = await readFile(
    join(root, "src/components/MetaContentSyncPanel.tsx"),
    "utf8",
  );
  assert.match(panelSource, /erkannte-beitraege/);
  assert.match(panelSource, /Erkennungsrückschau/);
  assert.match(panelSource, /Heute erkannt|Diese Woche/);

  const routeSource = await readFile(
    join(root, "src/app/api/connectors/meta/sync/route.ts"),
    "utf8",
  );
  assert.match(routeSource, /detectionHistory: snapshot\.detectionHistory/);

  console.log("content-detection-history checks passed");
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
