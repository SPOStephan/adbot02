import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-openai-sync-reporting-"));
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

try {
  const safetySource = await readFile(
    join(root, "src/lib/openai-ads/launch-safety.ts"),
    "utf8",
  );
  let reportingSource = await readFile(
    join(root, "src/lib/openai-ads/sync-reporting.ts"),
    "utf8",
  );
  reportingSource = reportingSource
    .replaceAll('"@/lib/openai-ads/client"', '"./client.mjs"')
    .replaceAll('"@/lib/openai-ads/launch-safety"', '"./launch-safety.mjs"');
  await Promise.all([
    writeFile(join(temporaryDirectory, "launch-safety.mjs"), transpile(safetySource)),
    writeFile(join(temporaryDirectory, "sync-reporting.mjs"), transpile(reportingSource)),
    writeFile(join(temporaryDirectory, "client.mjs"), "export {};\n"),
  ]);
  const reporting = await import(
    `${pathToFileURL(join(temporaryDirectory, "sync-reporting.mjs")).href}?v=${Date.now()}`
  );
  const safety = await import(
    `${pathToFileURL(join(temporaryDirectory, "launch-safety.mjs")).href}?v=${Date.now()}`
  );

  const startUnix = safety.accountLocalDateToUnix("2026-03-28", "Europe/Berlin");
  const endUnix = safety.accountLocalDateToUnix("2026-03-31", "Europe/Berlin");
  const normalizedRange = reporting.completeAccountLocalReportingRange({
    nowUnix: safety.accountLocalDateToUnix("2026-03-31", "Europe/Berlin") +
      17 * 60 * 60,
    timeZone: "Europe/Berlin",
    days: 3,
  });
  assert.deepEqual(normalizedRange, { startUnix, endUnix });
  const windows = reporting.accountLocalReportingWindows({
    ...normalizedRange,
    timeZone: "Europe/Berlin",
  });
  assert.deepEqual(windows.map((item) => item.date), [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ]);
  assert.equal(windows[1].endUnix - windows[1].startUnix, 23 * 60 * 60);
  assert.throws(
    () => reporting.accountLocalReportingWindows({
      startUnix: startUnix + 60 * 60,
      endUnix,
      timeZone: "Europe/Berlin",
    }),
    /reporting_range_not_full_local_days/,
  );
  assert.throws(
    () => reporting.accountLocalReportingWindows({
      startUnix,
      endUnix: endUnix - 60 * 60,
      timeZone: "Europe/Berlin",
    }),
    /reporting_range_not_full_local_days/,
  );

  const thirtyDayRange = reporting.completeAccountLocalReportingRange({
    nowUnix: safety.accountLocalDateToUnix("2026-10-30", "America/New_York") +
      12 * 60 * 60,
    timeZone: "America/New_York",
    days: 30,
  });
  const thirtyDayWindows = reporting.accountLocalReportingWindows({
    ...thirtyDayRange,
    timeZone: "America/New_York",
  });
  assert.equal(thirtyDayWindows.length, 30);
  assert.equal(thirtyDayWindows[0].date, "2026-09-30");
  assert.equal(thirtyDayWindows.at(-1).date, "2026-10-29");

  const requests = reporting.buildOpenAIAdsConversionRequests({
    campaignIds: ["campaign-1", "campaign-2"],
    windows,
    chunkSize: 1,
  });
  assert.equal(requests.length, 6);
  assert.deepEqual(
    requests.map((item) => `${item.date}:${item.campaignIds[0]}`),
    [
      "2026-03-28:campaign-1",
      "2026-03-28:campaign-2",
      "2026-03-29:campaign-1",
      "2026-03-29:campaign-2",
      "2026-03-30:campaign-1",
      "2026-03-30:campaign-2",
    ],
  );
  assert.throws(
    () => reporting.assertOpenAIAdsDeliveryCoverage({
      campaignIds: ["campaign-1"],
      windows,
      insights: [],
    }),
    /delivery_insights_incomplete/,
  );

  const completeInsights = windows.flatMap((window) =>
    ["campaign-1", "campaign-2"].map((campaignId) => ({
      campaign_id: campaignId,
      readable_time: window.date,
    })),
  );
  assert.doesNotThrow(() =>
    reporting.assertOpenAIAdsDeliveryCoverage({
      campaignIds: ["campaign-1", "campaign-2"],
      windows,
      insights: completeInsights,
    }),
  );
  assert.throws(
    () => reporting.assertOpenAIAdsDeliveryCoverage({
      campaignIds: ["campaign-1", "campaign-2"],
      windows,
      insights: [...completeInsights, completeInsights[0]],
    }),
    /delivery_insights_incomplete/,
  );
  assert.throws(
    () => reporting.assertOpenAIAdsDeliveryCoverage({
      campaignIds: ["campaign-1", "campaign-2"],
      windows,
      insights: [
        ...completeInsights.slice(1),
        { campaign_id: "foreign", readable_time: windows[0].date },
      ],
    }),
    /delivery_insights_incomplete/,
  );

  console.log("test-openai-ads-sync-reporting: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
