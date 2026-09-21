import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { uniquifyJpegBytes } from "../src/lib/chatgpt-ad-library/jpeg-uniquify.ts";

const original = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);
const first = uniquifyJpegBytes(original, "18");
const second = uniquifyJpegBytes(original, "21");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert.notEqual(hash(first), hash(original));
assert.notEqual(hash(first), hash(second));
assert.equal(first.subarray(0, original.length).toString(), original.toString());
assert.match(Buffer.from(first).toString("utf8"), /ADBOTCHATGPT:18/);
assert.match(Buffer.from(second).toString("utf8"), /ADBOTCHATGPT:21/);

console.log("test-chatgpt-ad-library-jpeg: ok");
