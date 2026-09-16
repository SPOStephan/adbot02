#!/usr/bin/env node
/**
 * Small-batch Playwright scraper for chatgptadlibrary.com.
 *
 * Every run is self-contained — no admin-typed IDs:
 *   1. HTTP-discover IDs (public sitemap + system catalog). Never burn the
 *      5-page guest quota on /library or shards.
 *   2. POST discover (empty payloads are OK).
 *   3. GET plan — server bootstraps catalog / sequential probe if needed.
 *   4. Fresh browser: scrape only those ≤5 ad pages, ingest, enqueue related IDs.
 *
 * Usage (CI):
 *   ADBOT_APP_URL=https://… CRON_SECRET=… node scripts/chatgpt-ad-library-scrape-playwright.mjs
 *
 * When status.unlockerConfigured is true this process never loads Playwright:
 * it only calls GET ?mode=unlock_discover and GET ?mode=unlock.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright is optional. Production Actions skip `npm install playwright`
// when ScrapingBee is configured and must still reach the unlocker early-exit.
async function launchChromium() {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

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

function loadSystemIds() {
  try {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../fixtures/chatgpt-ad-library/system-ids.json",
    );
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; AdbotInternalCorpus/1.0)",
    },
    redirect: "follow",
  }).catch(() => null);
  if (!response) return { status: 0, text: "" };
  const text = await response.text().catch(() => "");
  return { status: response.status, text };
}

async function discoverIdsHttp(shard) {
  const ids = new Set(loadSystemIds());
  const shardUrl = `${ORIGIN}/ad/sitemaps/${String(shard).padStart(3, "0")}.xml`;
  const urls = [`${ORIGIN}/sitemap.xml`, `${ORIGIN}/ad/sitemap.xml`, shardUrl];
  const stats = { sitemap: 0, adIndex: 0, shard: 0, system: ids.size };

  for (const url of urls) {
    const fetched = await fetchText(url);
    const found = extractIdsFromText(fetched.text);
    for (const id of found) ids.add(id);
    if (url.endsWith("/sitemap.xml") && !url.includes("/ad/")) stats.sitemap = found.length;
    else if (url.endsWith("/ad/sitemap.xml")) stats.adIndex = found.length;
    else stats.shard = found.length;
  }

  return { ids: [...ids], stats };
}

function attachIdSniffer(page, bucket) {
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!/chatgptadlibrary\.com/i.test(url)) return;
      const type = response.headers()["content-type"] || "";
      if (
        !/json|xml|javascript|text|html/i.test(type) &&
        !/sitemap|library|ad\//i.test(url)
      ) {
        return;
      }
      const text = await response.text();
      for (const id of extractIdsFromText(`${url}\n${text}`)) bucket.add(id);
    } catch {
      // Body may already be consumed; ignore.
    }
  });
}

async function extractAd(page, id) {
  const url = `${ORIGIN}/ad/${id}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);

  const html = await page.content();
  if (/vercel security checkpoint/i.test(html)) {
    return { blocked: true, record: null };
  }
  if (/page not found|404|ad not found/i.test(html) && !/img\.chatgptadlibrary\.com/i.test(html)) {
    return { missing: true, record: null };
  }

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

  return { record };
}

function isTransientFailure(error) {
  return /blocked|checkpoint|timeout|net::|429|target closed/i.test(String(error));
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

  if (!DRY_RUN && statusPayload.status?.unlockerConfigured === true) {
    const discover = await cronGet("/api/cron/chatgpt-ad-library-scrape?mode=unlock_discover");
    console.log("unlock_discover", {
      shard: discover.shard,
      added: discover.added,
      pendingCount: discover.pendingCount,
      blocked: discover.blocked,
    });
    const scraped = await cronGet("/api/cron/chatgpt-ad-library-scrape?mode=unlock");
    console.log("unlock", {
      planned: scraped.plannedIds,
      blocked: scraped.blocked,
      summary: scraped.summary,
      failures: scraped.failures,
    });
    return;
  }

  const discoverShardIndex = Number(statusPayload.status?.nextDiscoverShard ?? 0);

  const discovered = await discoverIdsHttp(discoverShardIndex);
  console.log(
    JSON.stringify({
      phase: "discover",
      shard: discoverShardIndex,
      ...discovered.stats,
      uniqueIds: discovered.ids.length,
    }),
  );

  if (!DRY_RUN) {
    const discoverResult = await cronPost({
      action: "discover",
      shard: discoverShardIndex,
      ids: discovered.ids,
      xml: discovered.ids.map((id) => `${ORIGIN}/ad/${id}`).join("\n"),
    });
    console.log("discover", {
      shard: discoverShardIndex,
      added: discoverResult.added,
      pendingCount: discoverResult.pendingCount,
    });
  }

  const planPayload = DRY_RUN
    ? { plan: { enabled: true, ids: discovered.ids.slice(0, BATCH_MAX) } }
    : await cronGet("/api/cron/chatgpt-ad-library-scrape?mode=plan");

  if (!planPayload.plan?.enabled) {
    console.log("crawl disabled after discover — exit");
    return;
  }

  const ids = (planPayload.plan.ids || []).slice(0, BATCH_MAX);
  console.log(JSON.stringify({ phase: "plan", planned: ids, dryRun: DRY_RUN }));

  if (ids.length < 1) {
    console.log("plan returned no ids — catalog exhausted and probe capped");
    return;
  }

  const browser = await launchChromium();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();
  const sniffed = new Set();
  attachIdSniffer(page, sniffed);

  const records = [];
  const transient = [];
  try {
    for (const id of ids) {
      try {
        const extracted = await extractAd(page, id);
        if (extracted.blocked) {
          transient.push({ id, error: "bot_checkpoint" });
          continue;
        }
        if (extracted.missing || !extracted.record?.imageUrl) {
          console.log("skip permanent", id, extracted.missing ? "missing" : "extract_failed");
          continue;
        }
        records.push(extracted.record);
        console.log("scraped", extracted.record.id, extracted.record.advertiserName, extracted.record.title);
      } catch (error) {
        const message = error instanceof Error ? error.message : "scrape_failed";
        if (isTransientFailure(message)) {
          transient.push({ id, error: message });
        } else {
          console.log("skip permanent", id, message);
        }
      }
    }

    const related = [...sniffed].filter((id) => !ids.includes(id));
    if (related.length > 0 && !DRY_RUN) {
      await cronPost({ action: "enqueue", ids: related });
      console.log("related enqueue", { added: related.length });
    }

    if (transient.length > 0 && !DRY_RUN) {
      await cronPost({
        action: "requeue",
        ids: transient.map((item) => item.id),
      });
    }

    if (records.length < 1) {
      console.log("no records scraped", { transient, planned: ids });
      if (!DRY_RUN) {
        const seed = await cronPost({ action: "ingest_seed" });
        console.log("seed_fallback", seed.summary || seed);
      }
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
