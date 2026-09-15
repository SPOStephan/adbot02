#!/usr/bin/env node
/**
 * Small-batch Playwright scraper for chatgptadlibrary.com.
 *
 * Every run:
 *   1. Discover ad IDs from /library + current sitemap shard (no manual IDs)
 *   2. Enqueue them on Adbot
 *   3. Plan ≤5 unseen IDs
 *   4. Scrape those pages and ingest
 *
 * Usage (CI):
 *   ADBOT_APP_URL=https://… CRON_SECRET=… node scripts/chatgpt-ad-library-scrape-playwright.mjs
 */
import { chromium } from "playwright";

const ORIGIN = "https://www.chatgptadlibrary.com";
const BATCH_MAX = 5;
const APP_URL = (process.env.ADBOT_APP_URL || process.env.APP_URL || "")
  .trim()
  .replace(/\/$/, "");
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();
const DRY_RUN = process.env.DRY_RUN === "1";

function authHeaders() {
  return {
    Authorization: `Bearer ${CRON_SECRET}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function cronGet(path) {
  const response = await fetch(`${APP_URL}${path}`, {
    headers: authHeaders(),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${path} → ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function cronPost(body) {
  const response = await fetch(`${APP_URL}/api/cron/chatgpt-ad-library-scrape`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`POST scrape → ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function extractIdsFromText(text) {
  if (!text || /vercel security checkpoint/i.test(text)) return [];
  const decoded = String(text)
    .replace(/&amp;/g, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
  return [
    ...new Set(
      [...decoded.matchAll(/\/ad\/(\d{1,12})(?!\d)/g)].map((match) => match[1]),
    ),
  ];
}

async function collectPageIds(page) {
  const html = await page.content();
  const fromHtml = extractIdsFromText(html);
  const fromDom = await page
    .evaluate(() => {
      const hrefs = [...document.querySelectorAll("a[href]")]
        .map((el) => el.getAttribute("href") || el.href || "")
        .join("\n");
      return `${hrefs}\n${document.body?.innerText || ""}`;
    })
    .catch(() => "");
  return [...new Set([...fromHtml, ...extractIdsFromText(fromDom)])];
}

async function discoverLibraryIds(page) {
  await page.goto(`${ORIGIN}/library`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(600);
  }
  return collectPageIds(page);
}

async function discoverShardIds(page, shard) {
  const url = `${ORIGIN}/ad/sitemaps/${String(shard).padStart(3, "0")}.xml`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1000);
  return collectPageIds(page);
}

async function extractAd(page, id) {
  const url = `${ORIGIN}/ad/${id}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);

  for (const label of ["Accept", "Got it", "Close", "Not now", "Maybe later"]) {
    const button = page.getByRole("button", { name: label });
    if (await button.count()) {
      await button.first().click({ timeout: 1000 }).catch(() => {});
    }
  }

  return page.evaluate(
    ({ adId, origin, host }) => {
      const abs = (value) => {
        try {
          return new URL(value, origin).toString();
        } catch {
          return "";
        }
      };
      const img =
        [...document.querySelectorAll("img")]
          .map((el) => abs(el.currentSrc || el.src || ""))
          .find(
            (src) =>
              src.includes(host) &&
              /\/c\/[0-9a-f]{2}\/[0-9a-f]{32,}\.webp/i.test(src) &&
              !/placeholder/i.test(src),
          ) || "";
      if (!img) return null;

      const h1 = document.querySelector("h1")?.textContent?.trim() || "";
      const title =
        h1 ||
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
        `ChatGPT Ad ${adId}`;
      const body =
        document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
        [...document.querySelectorAll("p")]
          .map((el) => el.textContent?.trim() || "")
          .find((text) => text.length > 40) ||
        "";

      const advertiser =
        [...document.querySelectorAll("a, span, div")]
          .map((el) => el.textContent?.trim() || "")
          .find(
            (text) =>
              text.length > 1 &&
              text.length < 80 &&
              /Inc|LLC|Ltd|Technologies|Labs|AI|\.com/i.test(text),
          ) || title;

      const landing =
        [...document.querySelectorAll("a[href^='http']")]
          .map((el) => abs(el.href))
          .find(
            (href) =>
              href &&
              !href.includes("chatgptadlibrary.com") &&
              !href.includes("vercel.com") &&
              !href.includes("google.com/account"),
          ) || null;

      const prompts = [
        ...new Set(
          [...document.querySelectorAll("li, p, span")]
            .map((el) => el.textContent?.trim() || "")
            .filter((text) => text.length > 24 && text.length < 400)
            .filter((text) => /best |vs |how |what |ai |crm |tool/i.test(text))
            .slice(0, 40),
        ),
      ];

      const category = [
        ...new Set(
          [...document.querySelectorAll("nav a, [class*='breadcrumb'] a, a[href*='/library/']")]
            .map((el) => el.textContent?.trim() || "")
            .filter((text) => text && text.toLowerCase() !== "library")
            .slice(0, 12),
        ),
      ];

      return {
        id: Number(adId),
        sourceUrl: `${origin}/ad/${adId}`,
        advertiserName: String(advertiser).slice(0, 120),
        title: String(title).slice(0, 120),
        body: String(body).slice(0, 2000),
        imageUrl: img,
        landingPageUrl: landing,
        triggeringPrompts: prompts,
        category,
      };
    },
    { adId: id, origin: ORIGIN, host: "img.chatgptadlibrary.com" },
  );
}

async function main() {
  if (!DRY_RUN && (!APP_URL || CRON_SECRET.length < 32)) {
    throw new Error("ADBOT_APP_URL und CRON_SECRET (>=32) sind erforderlich.");
  }

  const statusPayload = DRY_RUN
    ? { status: { enabled: true, nextDiscoverShard: 0 } }
    : await cronGet("/api/cron/chatgpt-ad-library-scrape?mode=status");
  if (statusPayload.status && statusPayload.status.enabled === false) {
    console.log("crawl disabled — exit");
    return;
  }
  const discoverShardIndex = Number(statusPayload.status?.nextDiscoverShard ?? 0);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();

  try {
    const libraryIds = await discoverLibraryIds(page);
    const shardIds = await discoverShardIds(page, discoverShardIndex);
    const discoveredIds = [...new Set([...libraryIds, ...shardIds])];
    const discoverXml = discoveredIds
      .map((id) => `${ORIGIN}/ad/${id}`)
      .join("\n");

    console.log(
      JSON.stringify({
        phase: "discover",
        shard: discoverShardIndex,
        libraryIds: libraryIds.length,
        shardIds: shardIds.length,
        uniqueIds: discoveredIds.length,
      }),
    );

    if (!DRY_RUN) {
      const discoverResult = await cronPost({
        action: "discover",
        shard: discoverShardIndex,
        xml: discoverXml || "<urlset></urlset>",
      });
      console.log("discover", {
        shard: discoverShardIndex,
        added: discoverResult.added,
        pendingCount: discoverResult.pendingCount,
      });
    }

    const planPayload = DRY_RUN
      ? { plan: { enabled: true, ids: discoveredIds.slice(0, BATCH_MAX) } }
      : await cronGet("/api/cron/chatgpt-ad-library-scrape?mode=plan");

    if (!planPayload.plan?.enabled) {
      console.log("crawl disabled after discover — exit");
      return;
    }

    const ids = (planPayload.plan.ids || []).slice(0, BATCH_MAX);
    console.log(JSON.stringify({ phase: "plan", planned: ids, dryRun: DRY_RUN }));

    const records = [];
    const failed = [];
    for (const id of ids) {
      try {
        const record = await extractAd(page, id);
        if (!record?.imageUrl) {
          failed.push({ id, error: "extract_failed" });
          continue;
        }
        records.push(record);
        console.log("scraped", record.id, record.advertiserName, record.title);
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "scrape_failed",
        });
      }
    }

    if (failed.length > 0 && !DRY_RUN) {
      await cronPost({
        action: "requeue",
        ids: failed.map((item) => item.id),
      });
    }

    if (records.length < 1) {
      console.log("no records scraped", { failed, planned: ids });
      return;
    }

    if (DRY_RUN) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }

    const ingested = await cronPost({ action: "ingest", records });
    console.log("ingest", ingested.summary || ingested);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
