import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");
const clientSourcePath = join(projectRoot, "src/lib/meta/client.ts");
const cryptoSourcePath = join(projectRoot, "src/lib/meta/crypto.ts");
const callbackSourcePath = join(
  projectRoot,
  "src/app/api/connectors/meta/callback/route.ts",
);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-meta-readonly-"));
const originalFetch = globalThis.fetch;

try {
  const cryptoSource = (await readFile(cryptoSourcePath, "utf8")).replace(
    'import "server-only";',
    "",
  );
  const clientSource = (await readFile(clientSourcePath, "utf8"))
    .replace('import "server-only";', "")
    .replace('from "./crypto";', 'from "./crypto.mjs";');
  const callbackSource = await readFile(callbackSourcePath, "utf8");

  assert.doesNotMatch(clientSource, /client_business_id|business_management/);
  assert.doesNotMatch(
    callbackSource,
    /clientBusinessId|client_business_id|business_management|ads_management/,
  );
  assert.match(callbackSource, /platform_account_id:\s*identity\.id/);
  assert.match(callbackSource, /account_id:\s*identity\.id/);
  assert.match(callbackSource, /meta_business_id:\s*null/);

  const cryptoModulePath = join(temporaryDirectory, "crypto.mjs");
  const clientModulePath = join(temporaryDirectory, "client.mjs");
  await writeFile(cryptoModulePath, transpile(cryptoSource), "utf8");
  await writeFile(clientModulePath, transpile(clientSource), "utf8");

  const clientModule = await import(pathToFileURL(clientModulePath).href);
  let requestedUrl;
  let requestedInit;

  globalThis.fetch = async (input, init) => {
    requestedUrl = new URL(String(input));
    requestedInit = init;

    return new Response(
      JSON.stringify({
        id: "meta-app-scoped-user-id",
        client_business_id: "ignored-business-id",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const identity = await clientModule.getMetaIdentity({
    accessToken: "read-only-test-token",
    appSecret: "test-app-secret",
  });

  assert.deepEqual(identity, { id: "meta-app-scoped-user-id" });
  assert.equal(requestedUrl.pathname, "/v25.0/me");
  assert.equal(requestedUrl.searchParams.get("fields"), "id");
  assert.ok(requestedUrl.searchParams.get("appsecret_proof"));
  assert.equal(
    requestedInit.headers.Authorization,
    "Bearer read-only-test-token",
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ client_business_id: "business-only" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    clientModule.getMetaIdentity({
      accessToken: "read-only-test-token",
      appSecret: "test-app-secret",
    }),
    (error) =>
      error instanceof clientModule.MetaGraphError && error.status === 502,
  );

  console.log("Meta read-only checks passed");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { force: true, recursive: true });
}
