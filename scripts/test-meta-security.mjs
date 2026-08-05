import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const sourcePath = new URL("../src/lib/meta/crypto.ts", import.meta.url);
const source = (await readFile(sourcePath, "utf8")).replace(
  'import "server-only";',
  "",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-security-"));
const modulePath = join(temporaryDirectory, "crypto.mjs");

try {
  await writeFile(modulePath, compiled, "utf8");
  const cryptoModule = await import(pathToFileURL(modulePath).href);

  const stateSecret = "state-secret-with-at-least-thirty-two-characters";
  const userId = "11111111-2222-4333-8444-555555555555";
  const now = Date.parse("2026-07-25T06:00:00.000Z");
  const state = cryptoModule.createOAuthState(userId, stateSecret, now);
  const verifiedState = cryptoModule.verifyOAuthState(
    state,
    stateSecret,
    userId,
    now,
  );

  assert.equal(verifiedState?.authorizationReset, false);
  const resetState = cryptoModule.createOAuthState(
    userId,
    stateSecret,
    now,
    true,
  );
  assert.equal(
    cryptoModule.verifyOAuthState(resetState, stateSecret, userId, now)
      ?.authorizationReset,
    true,
  );
  assert.equal(
    cryptoModule.verifyOAuthState(state, "wrong-secret", userId, now),
    null,
  );
  assert.equal(
    cryptoModule.verifyOAuthState(state, stateSecret, "other-user", now),
    null,
  );
  const [statePayload, stateSignature] = state.split(".");
  const decodedStatePayload = JSON.parse(
    Buffer.from(statePayload, "base64url").toString("utf8"),
  );
  const tamperedResetPayload = Buffer.from(
    JSON.stringify({ ...decodedStatePayload, authorizationReset: true }),
  ).toString("base64url");
  assert.equal(
    cryptoModule.verifyOAuthState(
      `${tamperedResetPayload}.${stateSignature}`,
      stateSecret,
      userId,
      now,
    ),
    null,
  );
  const tamperedSignature = `${stateSignature.startsWith("A") ? "B" : "A"}${stateSignature.slice(1)}`;
  assert.equal(
    cryptoModule.verifyOAuthState(
      `${statePayload}.${tamperedSignature}`,
      stateSecret,
      userId,
      now,
    ),
    null,
  );
  assert.equal(
    cryptoModule.verifyOAuthState(state, stateSecret, userId, now + 601_000),
    null,
  );

  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  assert.doesNotThrow(() =>
    cryptoModule.assertValidMetaTokenEncryptionKey(encryptionKey),
  );
  assert.throws(() =>
    cryptoModule.assertValidMetaTokenEncryptionKey("invalid-key"),
  );
  assert.throws(() =>
    cryptoModule.assertValidMetaTokenEncryptionKey(
      Buffer.alloc(31, 7).toString("base64"),
    ),
  );
  assert.throws(() =>
    cryptoModule.assertValidMetaTokenEncryptionKey(
      Buffer.alloc(33, 7).toString("base64"),
    ),
  );

  const plaintextToken = "test-token-that-must-never-be-stored-in-plaintext";
  const encryptedOne = cryptoModule.encryptAccessToken(
    plaintextToken,
    encryptionKey,
  );
  const encryptedTwo = cryptoModule.encryptAccessToken(
    plaintextToken,
    encryptionKey,
  );

  assert.notEqual(encryptedOne.ciphertext, plaintextToken);
  assert.notDeepEqual(encryptedOne, encryptedTwo);
  assert.equal(
    cryptoModule.decryptAccessToken(encryptedOne, encryptionKey),
    plaintextToken,
  );
  assert.throws(() =>
    cryptoModule.decryptAccessToken(
      {
        ...encryptedOne,
        authTag: Buffer.alloc(16, 1).toString("base64"),
      },
      encryptionKey,
    ),
  );
  assert.throws(() =>
    cryptoModule.encryptAccessToken(plaintextToken, "invalid-key"),
  );

  const appSecret = "test-app-secret";
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      issued_at: 1784959200,
      user_id: "meta-app-scoped-user-id",
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", appSecret)
    .update(payload)
    .digest("base64url");
  const signedRequest = `${signature}.${payload}`;

  assert.equal(
    cryptoModule.parseMetaSignedRequest(signedRequest, appSecret).user_id,
    "meta-app-scoped-user-id",
  );
  assert.equal(
    cryptoModule.parseMetaSignedRequest(signedRequest, "wrong-app-secret"),
    null,
  );

  const expectedProof = createHmac("sha256", appSecret)
    .update(plaintextToken)
    .digest("hex");
  assert.equal(
    cryptoModule.createAppSecretProof(plaintextToken, appSecret),
    expectedProof,
  );

  console.log("Meta security checks passed");
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
