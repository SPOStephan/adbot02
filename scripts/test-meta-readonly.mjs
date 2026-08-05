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

  assert.doesNotMatch(
    clientSource,
    /assigned_instagram_accounts|client_business_id|business_management|\/instagram_accounts["'`]/,
  );
  assert.doesNotMatch(clientSource, /candidateInstagramAccountIds/);
  assert.match(
    clientSource,
    /Page-linked Instagram IDs must never be treated as[\s\S]*selected/,
  );
  assert.match(callbackSource, /missing_granular_instagram_targets/);
  assert.match(clientSource, /META_ALLOWED_SCOPES[\s\S]*"ads_management"/);
  assert.match(clientSource, /auth_type", "rerequest"/);
  assert.doesNotMatch(
    callbackSource,
    /systemUserId|clientBusinessId|client_business_id|business_management|assigned_instagram_accounts/,
  );
  assert.match(
    callbackSource,
    /getGranularTargetIds\(tokenDebug, "ads_management"\)/,
  );
  assert.match(callbackSource, /resolvePersistedMetaAccessToken/);
  assert.match(callbackSource, /debugMetaAccessToken/);
  assert.match(callbackSource, /replace_meta_connection/);
  assert.match(callbackSource, /p_meta_user_id:\s*identity\.id/);
  assert.match(callbackSource, /p_assets:\s*assetRows/);
  assert.match(callbackSource, /p_scopes:\s*\[\.\.\.META_ALLOWED_SCOPES\]/);
  assert.match(callbackSource, /meta_callback_stage/);
  assert.match(clientSource, /resolvePersistedMetaAccessToken/);
  assert.match(clientSource, /set_token_expires_in_60_days/);

  const assetRowsStart = callbackSource.indexOf("const assetRows");
  const assetRowsEnd = callbackSource.indexOf("const encryptedToken");
  assert.ok(assetRowsStart >= 0 && assetRowsEnd > assetRowsStart);
  assert.doesNotMatch(
    callbackSource.slice(assetRowsStart, assetRowsEnd),
    /accessToken|access_token|token_iv|token_auth_tag/,
  );

  const cryptoModulePath = join(temporaryDirectory, "crypto.mjs");
  const clientModulePath = join(temporaryDirectory, "client.mjs");
  await writeFile(cryptoModulePath, transpile(cryptoSource), "utf8");
  await writeFile(clientModulePath, transpile(clientSource), "utf8");

  const clientModule = await import(pathToFileURL(clientModulePath).href);
  const requests = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    return new Response(JSON.stringify({ id: "123456789012345" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const identity = await clientModule.getMetaIdentity({
    accessToken: "read-only-test-token",
    appSecret: "test-app-secret",
  });

  assert.deepEqual(identity, { id: "123456789012345" });
  assert.equal(requests[0].url.pathname, "/v25.0/me");
  assert.equal(requests[0].url.searchParams.get("fields"), "id");
  assert.ok(requests[0].url.searchParams.get("appsecret_proof"));
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(
    requests[0].init.headers.Authorization,
    "Bearer read-only-test-token",
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    return new Response(
      JSON.stringify({
        access_token: "long-lived-test-token",
        token_type: "bearer",
        expires_in: 5_184_000,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const longLived = await clientModule.exchangeForLongLivedAccessToken({
    appId: "meta-app-id",
    appSecret: "meta-app-secret",
    shortLivedAccessToken: "short-lived-token",
  });

  assert.equal(longLived.accessToken, "long-lived-test-token");
  assert.equal(longLived.expiresInSeconds, 5_184_000);
  assert.equal(requests[0].url.pathname, "/v25.0/oauth/access_token");
  assert.equal(requests[0].url.searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(requests[0].url.searchParams.get("fb_exchange_token"), "short-lived-token");
  assert.equal(requests[0].init.method, "GET");

  requests.length = 0;
  let debugCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.pathname.endsWith("/debug_token")) {
      debugCalls += 1;
      return new Response(
        JSON.stringify({
          data: {
            app_id: "meta-app-id",
            user_id: "system-user-1",
            is_valid: true,
            type: "SYSTEM_USER",
            scopes: ["ads_management"],
            granular_scopes: [],
            expires_at: 0,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: {
          message: "Cannot exchange system user token like a user token",
          type: "OAuthException",
          code: 190,
        },
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const persistedSystemUserToken =
    await clientModule.resolvePersistedMetaAccessToken({
      appId: "meta-app-id",
      appSecret: "meta-app-secret",
      codeAccessToken: {
        accessToken: "system-user-code-token",
        expiresInSeconds: 5_184_000,
        tokenType: "bearer",
        usage: {
          appPercent: null,
          pagePercent: null,
          businessPercent: null,
          retryAfterSeconds: null,
        },
      },
    });

  assert.equal(persistedSystemUserToken.accessToken, "system-user-code-token");
  assert.equal(debugCalls, 1);
  assert.ok(
    requests.some((request) =>
      request.url.searchParams.get("set_token_expires_in_60_days") === "true",
    ),
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    return new Response(
      JSON.stringify({
        data: [
          {
            id: "page_post_1",
            message: `  ${"x".repeat(520)}  `,
            permalink_url: "http://unsafe.example/post",
            full_picture: "https://cdn.example.test/post.jpg",
            created_time: "2026-07-27T10:00:00+0000",
          },
        ],
        paging: {
          next: "https://attacker.example/v25.0/leak?access_token=stolen",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-app-usage": JSON.stringify({ call_count: 23, total_time: 5 }),
        },
      },
    );
  };

  const facebook = await clientModule.getFacebookPublishedPosts({
    pageId: "page/with spaces",
    pageAccessToken: "ephemeral-page-token",
    appSecret: "test-app-secret",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(requests[0].init.headers.Authorization, "Bearer ephemeral-page-token");
  assert.ok(requests[0].url.searchParams.get("appsecret_proof"));
  assert.equal(facebook.items.length, 1);
  assert.equal(facebook.items[0].captionExcerpt.length, 500);
  assert.equal(facebook.items[0].permalinkUrl, null);
  assert.equal(facebook.items[0].previewUrl, "https://cdn.example.test/post.jpg");
  assert.equal(facebook.usage.appPercent, 23);

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    return new Response(
      JSON.stringify({
        data: [
          {
            id: "ig_media_1",
            caption: "Neuer Beitrag",
            media_type: "VIDEO",
            media_product_type: "REELS",
            permalink: "https://instagram.example.test/p/1",
            timestamp: "2026-07-27T11:00:00+0000",
            thumbnail_url: "javascript:alert(1)",
            media_url: "https://cdn.example.test/reel.jpg",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const instagram = await clientModule.getInstagramMedia({
    instagramAccountId: "ig-id",
    accessToken: "delegated-instagram-token",
    appSecret: "test-app-secret",
  });

  assert.equal(requests[0].init.method, "GET");
  assert.equal(
    requests[0].init.headers.Authorization,
    "Bearer delegated-instagram-token",
  );
  assert.equal(instagram.items[0].contentType, "reel");
  assert.equal(instagram.items[0].previewUrl, "https://cdn.example.test/reel.jpg");

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    return new Response(
      JSON.stringify({
        id: "17841400000000001",
        name: "Aus Meta gewählt",
        username: "selected.by.customer",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const selectedInstagramAssets =
    await clientModule.getMetaInstagramAccountAssets({
      accessToken: "delegated-instagram-token",
      appSecret: "test-app-secret",
      allowedInstagramAccountIds: new Set([
        "17841400000000001",
        "not-a-meta-id",
      ]),
    });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/v25.0/17841400000000001");
  assert.equal(requests[0].url.searchParams.get("fields"), "id,name,username");
  assert.equal(
    requests[0].init.headers.Authorization,
    "Bearer delegated-instagram-token",
  );
  assert.deepEqual(selectedInstagramAssets.instagramAccounts, [
    {
      id: "17841400000000001",
      name: "Aus Meta gewählt",
      username: "selected.by.customer",
    },
  ]);

  // Page-linked Instagram IDs must never become selected assets when
  // debug_token has no instagram_basic target_ids — even if the token can
  // read them (that was how @bonkredit.de leaked in for meer-erfolg@gmx.de).
  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.pathname === "/v25.0/me/accounts") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "111111111111111",
              name: "Bon-Kredit Facebook-Seite",
              access_token: "ephemeral-page-token-1",
              instagram_business_account: {
                id: "17841400000000999",
                name: "Nicht im Meta-Dialog ausgewählt",
                username: "bonkredit.de",
              },
            },
            {
              id: "111111111111112",
              name: "Boncred Facebook-Seite",
              access_token: "ephemeral-page-token-2",
              instagram_business_account: {
                id: "17841400000000002",
                name: "Im Meta-Dialog ausgewählt",
                username: "boncred.official",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/v25.0/me/adaccounts") {
      return new Response(
        JSON.stringify({
          data: [{ id: "act_222222222222222", name: "Ausgewähltes Werbekonto" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Any direct Instagram profile read would mean the old page-candidate
    // fallback is still active — fail the test.
    throw new Error(
      `Unerwarteter Meta-Testpfad (kein Instagram-Fallback erlaubt): ${url.pathname}`,
    );
  };

  const assetsWithoutGranularInstagram =
    await clientModule.getMetaConnectionAssets({
      accessToken: "delegated-instagram-token",
      appSecret: "test-app-secret",
      allowedPageIds: new Set([
        "111111111111111",
        "111111111111112",
      ]),
      allowedInstagramAccountIds: new Set(),
      allowedAdAccountIds: new Set(["222222222222222"]),
    });

  assert.equal(assetsWithoutGranularInstagram.pages.length, 2);
  assert.equal(assetsWithoutGranularInstagram.adAccounts.length, 1);
  assert.deepEqual(assetsWithoutGranularInstagram.instagramAccounts, []);
  assert.doesNotMatch(
    JSON.stringify(assetsWithoutGranularInstagram.instagramAccounts),
    /bonkredit\.de|boncred\.official|17841400000000999|17841400000000002/,
  );

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.pathname === "/v25.0/me/accounts") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "111111111111111",
              name: "Bon-Kredit Facebook-Seite",
              access_token: "ephemeral-page-token-1",
              instagram_business_account: {
                id: "17841400000000999",
                name: "Nicht im Meta-Dialog ausgewählt",
                username: "bonkredit.de",
              },
            },
            {
              id: "111111111111112",
              name: "Boncred Facebook-Seite",
              access_token: "ephemeral-page-token-2",
              instagram_business_account: {
                id: "17841400000000002",
                name: "Im Meta-Dialog ausgewählt",
                username: "boncred.official",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/v25.0/17841400000000002") {
      return new Response(
        JSON.stringify({
          id: "17841400000000002",
          name: "Im Meta-Dialog ausgewählt",
          username: "boncred.official",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/v25.0/me/adaccounts") {
      return new Response(
        JSON.stringify({
          data: [{ id: "act_222222222222222", name: "Ausgewähltes Werbekonto" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unerwarteter Meta-Testpfad: ${url.pathname}`);
  };

  const assetsWithGranularInstagramOnly =
    await clientModule.getMetaConnectionAssets({
      accessToken: "delegated-instagram-token",
      appSecret: "test-app-secret",
      allowedPageIds: new Set([
        "111111111111111",
        "111111111111112",
      ]),
      allowedInstagramAccountIds: new Set(["17841400000000002"]),
      allowedAdAccountIds: new Set(["222222222222222"]),
    });

  assert.equal(assetsWithGranularInstagramOnly.pages.length, 2);
  assert.equal(assetsWithGranularInstagramOnly.adAccounts.length, 1);
  assert.deepEqual(assetsWithGranularInstagramOnly.instagramAccounts, [
    {
      id: "17841400000000002",
      name: "Im Meta-Dialog ausgewählt",
      username: "boncred.official",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(assetsWithGranularInstagramOnly.instagramAccounts),
    /bonkredit\.de|17841400000000999/,
  );
  assert.ok(
    requests.some((entry) => entry.url.pathname === "/v25.0/17841400000000002"),
  );
  assert.equal(
    requests.filter((entry) =>
      entry.url.pathname.startsWith("/v25.0/178414"),
    ).length,
    1,
  );

  requests.length = 0;
  const emptyInstagramAssets =
    await clientModule.getMetaInstagramAccountAssets({
      accessToken: "delegated-instagram-token",
      appSecret: "test-app-secret",
      allowedInstagramAccountIds: new Set(),
    });
  assert.equal(requests.length, 0);
  assert.deepEqual(emptyInstagramAssets.instagramAccounts, []);

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ error: { code: 4, error_subcode: 99 } }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "x-app-usage": JSON.stringify({ call_count: 100 }),
          "retry-after": "120",
        },
      },
    );

  await assert.rejects(
    clientModule.getMetaIdentity({
      accessToken: "read-only-test-token",
      appSecret: "test-app-secret",
    }),
    (error) =>
      error instanceof clientModule.MetaGraphError &&
      error.rateLimited === true &&
      error.usage.appPercent === 100 &&
      error.usage.retryAfterSeconds === 120,
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 190 } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    clientModule.getMetaIdentity({
      accessToken: "expired-token",
      appSecret: "test-app-secret",
    }),
    (error) =>
      error instanceof clientModule.MetaGraphError &&
      error.reconnectRequired === true,
  );

  console.log("Meta read-only checks passed");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporaryDirectory, { force: true, recursive: true });
}
