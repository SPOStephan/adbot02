#!/usr/bin/env node
/**
 * Validate / normalize raw ChatGPT Ad Library JSONL for admin import.
 * Usage: node scripts/chatgpt-ad-library-normalize-fixture.mjs path/to/raw.jsonl
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IMAGE_HOST = "img.chatgptadlibrary.com";
const ORIGIN = "https://www.chatgptadlibrary.com";
const HASH_RE = /^\/c\/[0-9a-f]{2}\/[0-9a-f]{32,128}\.webp$/i;

function fail(line, message) {
  console.error(`line ${line}: ${message}`);
  process.exitCode = 1;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/chatgpt-ad-library-normalize-fixture.mjs <raw.jsonl>");
    process.exit(2);
  }
  const raw = readFileSync(resolve(file), "utf8");
  let lineNo = 0;
  let kept = 0;
  for (const line of raw.split("\n")) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      fail(lineNo, "invalid JSON");
      continue;
    }
    const id =
      typeof row.id === "number" && Number.isFinite(row.id)
        ? String(Math.trunc(row.id))
        : typeof row.id === "string" && /^\d{1,12}$/.test(row.id.trim())
          ? row.id.trim()
          : null;
    if (!id) {
      fail(lineNo, "id missing");
      continue;
    }
    const advertiserName = String(row.advertiserName ?? "").trim();
    const title = String(row.title ?? "").trim();
    const imageUrl = String(row.imageUrl ?? "").trim();
    if (!advertiserName || !title || !imageUrl) {
      fail(lineNo, "advertiserName/title/imageUrl required");
      continue;
    }
    if (/^Ad \d+$/i.test(advertiserName) || /^Ad \d+ Title$/i.test(title)) {
      fail(lineNo, "placeholder advertiser/title rejected");
      continue;
    }
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      fail(lineNo, "bad imageUrl");
      continue;
    }
    if (parsed.hostname !== IMAGE_HOST || !HASH_RE.test(parsed.pathname)) {
      fail(lineNo, "imageUrl must be real CDN hash webp");
      continue;
    }
    const out = {
      id: Number(id),
      sourceUrl: `${ORIGIN}/ad/${id}`,
      advertiserName: advertiserName.slice(0, 120),
      title: title.slice(0, 120),
      body: String(row.body ?? "").slice(0, 2000),
      imageUrl: parsed.toString(),
      landingPageUrl: row.landingPageUrl ? String(row.landingPageUrl) : null,
      triggeringPrompts: Array.isArray(row.triggeringPrompts)
        ? row.triggeringPrompts.filter((x) => typeof x === "string").slice(0, 40)
        : [],
      category: Array.isArray(row.category)
        ? row.category.filter((x) => typeof x === "string").slice(0, 12)
        : [],
    };
    process.stdout.write(`${JSON.stringify(out)}\n`);
    kept += 1;
  }
  console.error(`normalized ${kept} records`);
}

main();
