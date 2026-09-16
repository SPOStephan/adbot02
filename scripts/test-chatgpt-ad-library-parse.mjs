import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  hasUsableChatGPTAdLibraryCopy,
  isChatGPTAdLibraryChromeText,
  isLikelyChatGPTAdTriggerPrompt,
  mergeChatGPTAdLibraryCopy,
  parseChatGPTAdLibraryHtml,
  scoreChatGPTAdLibraryCopy,
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
assert.doesNotMatch(String(parsed.title), /couldn't find that/i);
assert.doesNotMatch(String(parsed.body), /Tell us the advertiser/i);
assert.ok(
  !parsed.triggeringPrompts.some((item) => /gads-theme|localStorage|function\(\)/.test(item)),
);
assert.ok(
  !parsed.triggeringPrompts.some((item) => /ChatGPT Ad\s*$/.test(item)),
);
assert.equal(isChatGPTAdLibraryChromeText("We couldn't find that. Want us to go get it?"), true);
assert.equal(isLikelyChatGPTAdTriggerPrompt("(function(){try{var t=localStorage.getItem(\"gads-theme\")}catch(e){}})()"), false);
assert.ok(
  scoreChatGPTAdLibraryCopy({
    title: "We couldn't find that. Want us to go get it?",
    advertiserName: "GlossGenius",
    body: "Tell us the advertiser, niche, or prompt and we'll probe ChatGPT for the ads, then keep it updated.",
    triggeringPrompts: ["(function(){try{var t=localStorage.getItem(\"gads-theme\")}catch(e){}})()"],
  }) < 0,
);
const repaired = mergeChatGPTAdLibraryCopy(
  {
    title: "We couldn't find that. Want us to go get it?",
    advertiserName: "GlossGenius",
    body: "Tell us the advertiser, niche, or prompt",
    triggeringPrompts: [
      "(function(){try{var t=localStorage.getItem(\"gads-theme\")}catch(e){}})()",
      "best platforms for WhatsApp helpdesk integration",
    ],
  },
  {
    title: "One System To Do It All",
    advertiserName: "GlossGenius",
    body: "Scheduling, payments, and admin. Done for you.",
    triggeringPrompts: ["best shift scheduling app for a hair salon with 5 stylists"],
  },
);
assert.ok(repaired);
assert.equal(repaired.title, "One System To Do It All");
assert.match(repaired.body, /Scheduling, payments/);
assert.ok(!repaired.triggeringPrompts.some((item) => /gads-theme/.test(item)));

const imageOnly = parseChatGPTAdLibraryHtml({
  html: `<html><img src="https://img.chatgptadlibrary.com/c/14/14fdb811b3d1c4b284228434b2635206f04c8e55b21db949e0ccb3b82afd5cf9.webp"></html>`,
  adId: "7341",
});
assert.ok(imageOnly);
assert.equal(hasUsableChatGPTAdLibraryCopy(imageOnly), false);

console.log("test-chatgpt-ad-library-parse: ok");
