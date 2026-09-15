#!/usr/bin/env node
/**
 * Small-batch Playwright scraper for chatgptadlibrary.com.
 * Respects the ~5-page guest limit by scraping at most 5 ads per run in a fresh browser.
 *
 * Usage (CI):
 *   ADBOT_APP_URL=https://… CRON_SECRET=… node scripts/chatgpt-ad-library-scrape-playwright.mjs
 *
 * Local dry-run without ingest:
 *   DRY_RUN=1 node scripts/chatgpt-ad-library-scrape-playwright.mjs
 */
import { chromium } from "playwright";

const ORIGIN = "https://www.chatgptadlibrary.com";
const BATCH_MAX = 5;
const APP_URL = (process.env.ADBOT_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";
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

async function extractAd(page, id) {
  const url = `${ORIGIN}/ad/${id}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);

  // Soft-dismiss overlays if present (best effort).
  for (const label of ["Accept", "Got it", "Close", "Not now", "Maybe later"]) {
    const button = page.getByRole("button", { name: label });
    if (await button.count()) {
      await button.first().click({ timeout: 1000 }).catch(() => {});
    }
  }

  const record = await page.evaluate(
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
          .find((text) => text.length > 1 && text.length < 80 && /Inc|LLC|Ltd|Technologies|Labs|AI|\.com/i.test(text)) ||
        title;

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

  return record;
}

async function discoverShard(page, shard) {
  const url = `${ORIGIN}/ad/sitemaps/${String(shard).padStart(3, "0")}.xml`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(800);
  const xml = await page.content();
  // If browser rendered XML as HTML wrapper, still extract loc-like ad ids from text.
  const text = (await page.locator("body").innerText().catch(() => "")) || xml;
  return { xml: text.includes("<url>") || text.includes("/ad/") ? text : xml, url };
}

async function main() {
  if (!DRY_RUN && (!APP_URL || CRON_SECRET.length < 32)) {
    throw new Error("ADBOT_APP_URL und CRON_SECRET (>=32) sind erforderlich.");
  }

  const planPayload = DRY_RUN
    ? {
        plan: {
          enabled: true,
          ids: (process.env.SCRAPE_IDS || "7341").split(",").map((s) => s.trim()),
          discoverShard: null,
        },
      }
    : await cronGet("/api/cron/chatgpt-ad-library-scrape?mode=plan");

  if (!planPayload.plan?.enabled) {
    console.log("crawl disabled — exit");
    return;
  }

  const ids = (planPayload.plan.ids || []).slice(0, BATCH_MAX);
  const discoverShardIndex =
    planPayload.plan.discoverShard === null || planPayload.plan.discoverShard === undefined
      ? null
      : Number(planPayload.plan.discoverShard);

  console.log(
    JSON.stringify({
      planned: ids,
      discoverShard: discoverShardIndex,
      app: APP_URL || null,
      dryRun: DRY_RUN,
    }),
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();

  try {
    if (discoverShardIndex !== null && !Number.isNaN(discoverShardIndex)) {
      const discovered = await discoverShard(page, discoverShardIndex);
      if (!DRY_RUN) {
        const result = await cronPost({
          action: "discover",
          shard: discoverShardIndex,
          xml: discovered.xml,
        });
        console.log("discover", {
          shard: discoverShardIndex,
          added: result.added,
          pendingCount: result.pendingCount,
        });
      } else {
        console.log("discover dry-run", discovered.url, discovered.xml.slice(0, 200));
      }
    }

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
      console.log("no records scraped", { failed });
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
