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
    countDetectionSources,
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
      publishedAt: "2026-08-21T08:00:00.000Z",
    },
    {
      source: "facebook",
      // Seen earlier, but published today — must count as "today".
      firstSeenAt: "2026-08-19T12:00:00.000Z",
      publishedAt: "2026-08-21T09:00:00.000Z",
    },
    {
      source: "instagram",
      firstSeenAt: "2026-08-10T12:00:00.000Z",
      publishedAt: "2026-08-10T12:00:00.000Z",
    },
  ];

  const summary = summarizeDetectionWindows(items, noonBerlin);
  assert.equal(summary.today.total, 2);
  assert.equal(summary.today.instagram, 1);
  assert.equal(summary.today.facebook, 1);
  assert.equal(summary.week.total, 2);
  assert.equal(summary.week.facebook, 1);
  assert.equal(summary.week.instagram, 1);

  assert.equal(isDetectionInWindow(items[0], "today", noonBerlin), true);
  assert.equal(isDetectionInWindow(items[1], "today", noonBerlin), true);
  assert.equal(isDetectionInWindow(items[1], "week", noonBerlin), true);
  assert.equal(isDetectionInWindow(items[2], "today", noonBerlin), false);

  // Visible-list counts must match warning inputs (no separate summary path).
  const todayItems = items.filter((item) =>
    isDetectionInWindow(item, "today", noonBerlin),
  );
  const visibleCounts = countDetectionSources(todayItems);
  assert.equal(visibleCounts.facebook, 1);
  assert.equal(visibleCounts.instagram, 1);
  assert.equal(
    visibleCounts.instagram > 0 && visibleCounts.facebook === 0,
    false,
  );

  const snapshotSource = await readFile(
    join(root, "src/lib/meta/content-sync-snapshot.ts"),
    "utf8",
  );
  assert.match(snapshotSource, /detectionHistory/);
  assert.match(snapshotSource, /assetSyncHints/);
  assert.match(snapshotSource, /first_seen_at, last_seen_at, is_new/);
  assert.match(
    snapshotSource,
    /first_seen_at\.gte\.\$\{historySince\},published_at\.gte\.\$\{historySince\}/,
  );

  const panelSource = await readFile(
    join(root, "src/components/MetaContentSyncPanel.tsx"),
    "utf8",
  );
  assert.match(panelSource, /erkannte-beitraege/);
  assert.match(panelSource, /Erkennungsrückschau/);
  assert.match(panelSource, /countDetectionSources\(historyItems\)/);
  assert.match(panelSource, /showFacebookGapHint/);
  assert.doesNotMatch(
    panelSource,
    /snapshot\.detectionSummary\.today/,
  );

  const routeSource = await readFile(
    join(root, "src/app/api/connectors/meta/sync/route.ts"),
    "utf8",
  );
  assert.match(routeSource, /detectionHistory: snapshot\.detectionHistory/);

  console.log("content-detection-history checks passed");
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
