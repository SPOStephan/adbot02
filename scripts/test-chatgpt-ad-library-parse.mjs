import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  hasUsableChatGPTAdLibraryCopy,
  parseChatGPTAdLibraryHtml,
} from "../src/lib/chatgpt-ad-library/parse-html.ts";

const html = readFileSync(
  new URL("../fixtures/chatgpt-ad-library/ad-7341.html", import.meta.url),
  "utf8",
);

const parsed = parseChatGPTAdLibraryHtml({
  html,
  adId: "7341",
  pageUrl: "https://www.chatgptadlibrary.com/ad/7341",
});

assert.ok(parsed);
assert.equal(parsed.id, 7341);
assert.match(String(parsed.imageUrl), /14fdb811b3d1c4b284228434b2635206f04c8e55b21db949e0ccb3b82afd5cf9/);
assert.equal(parsed.advertiserName, "GlossGenius");
assert.equal(parsed.title, "One System To Do It All");
assert.match(String(parsed.body), /Scheduling, payments/);
assert.ok(Array.isArray(parsed.triggeringPrompts));
assert.ok(parsed.triggeringPrompts.includes("best shift scheduling app for a hair salon with 5 stylists"));
assert.ok(hasUsableChatGPTAdLibraryCopy(parsed));

const imageOnly = parseChatGPTAdLibraryHtml({
  html: `<html><img src="https://img.chatgptadlibrary.com/c/14/14fdb811b3d1c4b284228434b2635206f04c8e55b21db949e0ccb3b82afd5cf9.webp"></html>`,
  adId: "7341",
});
assert.ok(imageOnly);
assert.equal(hasUsableChatGPTAdLibraryCopy(imageOnly), false);

console.log("test-chatgpt-ad-library-parse: ok");
