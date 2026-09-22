import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { uniquifyJpegBytes } from "../src/lib/chatgpt-ad-library/jpeg-uniquify.ts";

/** Minimal SOF0 JPEG 256×256 so inspectCreativeImage would accept it. */
const original = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xd9,
]);
const first = uniquifyJpegBytes(original, "18");
const second = uniquifyJpegBytes(original, "21");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertValidJpegContainer(bytes, label) {
  assert.equal(bytes[0], 0xff, `${label} must start SOI`);
  assert.equal(bytes[1], 0xd8, `${label} must start SOI`);
  assert.equal(bytes[bytes.length - 2], 0xff, `${label} must end EOI`);
  assert.equal(bytes[bytes.length - 1], 0xd9, `${label} must end EOI`);
}

assertValidJpegContainer(original, "original");
assertValidJpegContainer(first, "first");
assertValidJpegContainer(second, "second");
assert.notEqual(hash(first), hash(original));
assert.notEqual(hash(first), hash(second));
assert.match(Buffer.from(first).toString("latin1"), /ADBOTCHATGPT:18/);
assert.match(Buffer.from(second).toString("latin1"), /ADBOTCHATGPT:21/);
assert.equal(first[original.length - 2], 0xff);
assert.equal(first[original.length - 1], 0xfe);

console.log("test-chatgpt-ad-library-jpeg: ok");
