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
  assert.match(clientSource, /protectMetaDebugTokenTargetIds/);
  assert.match(clientSource, /asMetaAssetId/);
  assert.doesNotMatch(clientSource, /unique_page_candidate|ambiguous_page_candidates|needsInstagramConfirm/);
  assert.doesNotMatch(clientSource, /!input\.allowedPageIds\?\.size/);
  assert.doesNotMatch(clientSource, /!allowedAdAccountIds\.size/);
  assert.match(callbackSource, /missing_page_targets/);
  assert.match(callbackSource, /missing_ad_account_targets/);
  assert.match(callbackSource, /missing_instagram_targets/);
  assert.match(callbackSource, /Granulare Meta-Auswahl/);
  assert.match(callbackSource, /resolveMetaSelectedPageIds/);
  assert.match(callbackSource, /getMetaAdAccountGranularTargetIds/);
  assert.match(callbackSource, /pageSource/);
  assert.doesNotMatch(callbackSource, /resolveMetaSelectedAdAccountIds|page_promote_pages|promote_pages/);
  assert.match(clientSource, /resolveMetaSelectedPageIds/);
  assert.match(clientSource, /getMetaAdAccountGranularTargetIds/);
  assert.match(clientSource, /instagram_linked_pages/);
  assert.match(clientSource, /asMetaGranularTargetId/);
  assert.doesNotMatch(clientSource, /page_promote_pages|promote_pages|unique_ad_account/);
  assert.match(clientSource, /pages_manage_ads/);
  assert.match(clientSource, /META_ALLOWED_SCOPES[\s\S]*"ads_management"/);
  assert.match(clientSource, /auth_type", "rerequest"/);
  assert.doesNotMatch(
    callbackSource,
    /systemUserId|clientBusinessId|client_business_id|business_management|assigned_instagram_accounts/,
  );
  assert.match(callbackSource, /getMetaAdAccountGranularTargetIds/);
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

  // Numeric / oversized target_ids from debug_token must survive parsing.
  assert.equal(
    clientModule.protectMetaDebugTokenTargetIds(
      '{"data":{"granular_scopes":[{"scope":"instagram_basic","target_ids":[17841400000000002, 111111111111112]}]}}',
    ),
    '{"data":{"granular_scopes":[{"scope":"instagram_basic","target_ids":["17841400000000002", "111111111111112"]}]}}',
  );
  assert.equal(clientModule.asMetaAssetId(178414000000000), "178414000000000");
  assert.equal(clientModule.asMetaAssetId("17841400000000002"), "17841400000000002");
  assert.equal(clientModule.asMetaAssetId(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(clientModule.asMetaGranularTargetId("act_222222222222222"), "222222222222222");
  assert.equal(clientModule.asMetaGranularTargetId("222222222222222"), "222222222222222");
  assert.equal(clientModule.asMetaAssetId("act_222222222222222"), null);

  requests.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    // Simulate Meta returning target_ids as raw JSON integers (common for
    // debug_token). Without protectMetaDebugTokenTargetIds the Instagram ID
    // would lose precision or be dropped by a string-only filter.
    return new Response(
      '{"data":{"app_id":"meta-app-id","user_id":"system-user-1","is_valid":true,"type":"SYSTEM_USER","scopes":["instagram_basic","pages_show_list"],"granular_scopes":[{"scope":"instagram_basic","target_ids":[17841400000000002]},{"scope":"pages_show_list","target_ids":[111111111111112]}],"expires_at":0}}',
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const debugWithNumericTargets = await clientModule.debugMetaAccessToken({
    appId: "meta-app-id",
    appSecret: "meta-app-secret",
    accessToken: "system-user-token",
  });
  assert.deepEqual(
    [...clientModule.getGranularTargetIds(debugWithNumericTargets, "instagram_basic")],
    ["17841400000000002"],
  );
  assert.deepEqual(
    [...clientModule.getGranularTargetIds(debugWithNumericTargets, "pages_show_list")],
    ["111111111111112"],
  );
  assert.deepEqual(
    [...clientModule.getMetaPageGranularTargetIds(debugWithNumericTargets)].sort(),
    ["111111111111112"],
  );

  // Already-quoted string target_ids must not be double-quoted.
  assert.equal(
    clientModule.protectMetaDebugTokenTargetIds(
      '{"data":{"granular_scopes":[{"scope":"instagram_basic","target_ids":["17841400000000002"]}]}}',
    ),
    '{"data":{"granular_scopes":[{"scope":"instagram_basic","target_ids":["17841400000000002"]}]}}',
  );

  // Page-linked Instagram is NEVER stored — not even when exactly one page has
  // a linked IG (that invented @bonkredit.de for meer-erfolg@gmx.de).
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

    throw new Error(
      `Unerwarteter Meta-Testpfad (kein Seiten-Instagram-Fallback): ${url.pathname}`,
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
  assert.equal(assetsWithoutGranularInstagram.instagramDiscovery, "none");
  assert.equal(
    requests.filter((entry) =>
      entry.url.pathname.startsWith("/v25.0/178414"),
    ).length,
    0,
  );

  // Empty page/ad allow-lists must not fall open to every token-visible asset
  // (that stored two Facebook pages when only one was selected in Meta).
  requests.length = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push({ url });

    if (url.pathname === "/v25.0/me/accounts") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "111111111111111",
              name: "Bon-Kredit Facebook-Seite",
              access_token: "ephemeral-page-token-1",
            },
            {
              id: "111111111111112",
              name: "Gewählte Seite",
              access_token: "ephemeral-page-token-2",
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
          name: "Gewähltes IG",
          username: "boncred.official",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/v25.0/me/adaccounts") {
      return new Response(
        JSON.stringify({
          data: [
            { id: "act_222222222222222", name: "Ausgewählt" },
            { id: "act_333333333333333", name: "Nicht ausgewählt" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unerwarteter Meta-Testpfad: ${url.pathname}`);
  };

  const strictlySelectedAssets = await clientModule.getMetaConnectionAssets({
    accessToken: "token",
    appSecret: "secret",
    allowedPageIds: new Set(["111111111111112"]),
    allowedInstagramAccountIds: new Set(["17841400000000002"]),
    allowedAdAccountIds: new Set(["222222222222222"]),
  });
  assert.equal(strictlySelectedAssets.pages.length, 1);
  assert.equal(strictlySelectedAssets.pages[0]?.id, "111111111111112");
  assert.equal(strictlySelectedAssets.adAccounts.length, 1);
  assert.equal(
    strictlySelectedAssets.adAccounts[0]?.id,
    "act_222222222222222",
  );
  assert.deepEqual(strictlySelectedAssets.instagramAccounts, [
    {
      id: "17841400000000002",
      name: "Gewähltes IG",
      username: "boncred.official",
    },
  ]);

  const emptyPageAllowList = await clientModule.getMetaConnectionAssets({
    accessToken: "token",
    appSecret: "secret",
    allowedPageIds: new Set(),
    allowedInstagramAccountIds: new Set(["17841400000000002"]),
    allowedAdAccountIds: new Set(["222222222222222"]),
  });
  assert.equal(emptyPageAllowList.pages.length, 0);
  assert.equal(emptyPageAllowList.adAccounts.length, 1);

  const emptyAdAllowList = await clientModule.getMetaConnectionAssets({
    accessToken: "token",
    appSecret: "secret",
    allowedPageIds: new Set(["111111111111112"]),
    allowedInstagramAccountIds: new Set(["17841400000000002"]),
    allowedAdAccountIds: new Set(),
  });
  assert.equal(emptyAdAllowList.pages.length, 1);
  assert.equal(emptyAdAllowList.adAccounts.length, 0);

  // Single page-linked IG is still not an Instagram selection.
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
                name: "Fantasiewert",
                username: "bonkredit.de",
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

    throw new Error(
      `Unerwarteter Meta-Testpfad (kein Unique-Seiten-Fallback): ${url.pathname}`,
    );
  };

  const singlePageLinkedIgnored = await clientModule.getMetaConnectionAssets({
    accessToken: "delegated-instagram-token",
    appSecret: "test-app-secret",
    allowedPageIds: new Set(["111111111111111"]),
    allowedInstagramAccountIds: new Set(),
    allowedAdAccountIds: new Set(["222222222222222"]),
  });
  assert.deepEqual(singlePageLinkedIgnored.instagramAccounts, []);
  assert.equal(singlePageLinkedIgnored.instagramDiscovery, "none");

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
  assert.equal(
    assetsWithGranularInstagramOnly.instagramDiscovery,
    "granular_targets",
  );
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

  // When Meta omits page target_ids ("applies to all"), derive pages only from
  // Instagram selection — Boncred page yes, Bon-Kredit/@bonkredit.de no.
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
              name: "Bon-Kredit",
              access_token: "page-token-1",
              instagram_business_account: {
                id: "17841400000000999",
                username: "bonkredit.de",
              },
            },
            {
              id: "111111111111112",
              name: "Boncred",
              access_token: "page-token-2",
              instagram_business_account: {
                id: "17841400000000002",
                username: "boncred.official",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unerwarteter Meta-Testpfad: ${url.pathname}`);
  };

  const pageFromInstagram = await clientModule.resolveMetaSelectedPageIds({
    accessToken: "token",
    appSecret: "secret",
    tokenDebug: {
      appId: "app",
      userId: "user",
      isValid: true,
      type: "SYSTEM_USER",
      scopes: ["pages_show_list", "instagram_basic"],
      granularScopes: [
        { scope: "pages_show_list", targetIds: [] },
        { scope: "instagram_basic", targetIds: ["17841400000000002"] },
      ],
      expiresAt: null,
      dataAccessExpiresAt: null,
      usage: { appPercent: null, pagePercent: null, businessPercent: null, retryAfterSeconds: null },
    },
    allowedInstagramAccountIds: new Set(["17841400000000002"]),
  });
  assert.equal(pageFromInstagram.source, "instagram_linked_pages");
  assert.deepEqual([...pageFromInstagram.pageIds], ["111111111111112"]);

  const pageFromManageScope = await clientModule.resolveMetaSelectedPageIds({
    accessToken: "token",
    appSecret: "secret",
    tokenDebug: {
      appId: "app",
      userId: "user",
      isValid: true,
      type: "SYSTEM_USER",
      scopes: ["pages_manage_ads", "instagram_basic"],
      granularScopes: [
        { scope: "pages_manage_ads", targetIds: ["111111111111112"] },
      ],
      expiresAt: null,
      dataAccessExpiresAt: null,
      usage: { appPercent: null, pagePercent: null, businessPercent: null, retryAfterSeconds: null },
    },
    allowedInstagramAccountIds: new Set(["17841400000000002"]),
  });
  assert.equal(pageFromManageScope.source, "granular_targets");
  assert.deepEqual([...pageFromManageScope.pageIds], ["111111111111112"]);
  assert.equal(
    requests.filter((entry) => entry.url.pathname === "/v25.0/me/accounts").length,
    1,
    "granular page targets must not fetch /me/accounts for resolution",
  );

  // Ad accounts come only from ads_* target_ids (including act_ prefix) — never
  // inferred from pages.
  assert.deepEqual(
    [
      ...clientModule.getMetaAdAccountGranularTargetIds({
        appId: "app",
        userId: "user",
        isValid: true,
        type: "SYSTEM_USER",
        scopes: ["ads_management"],
        granularScopes: [
          { scope: "ads_management", targetIds: ["act_222222222222222"] },
        ],
        expiresAt: null,
        dataAccessExpiresAt: null,
        usage: {
          appPercent: null,
          pagePercent: null,
          businessPercent: null,
          retryAfterSeconds: null,
        },
      }),
    ],
    ["222222222222222"],
  );
  assert.deepEqual(
    [
      ...clientModule.getMetaAdAccountGranularTargetIds({
        appId: "app",
        userId: "user",
        isValid: true,
        type: "SYSTEM_USER",
        scopes: ["ads_read", "ads_management"],
        granularScopes: [
          { scope: "ads_read", targetIds: [] },
          { scope: "ads_management", targetIds: [] },
        ],
        expiresAt: null,
        dataAccessExpiresAt: null,
        usage: {
          appPercent: null,
          pagePercent: null,
          businessPercent: null,
          retryAfterSeconds: null,
        },
      }),
    ],
    [],
  );

  // Simulate debug_token returning act_ prefixed string target_ids.
  requests.length = 0;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          app_id: "meta-app-id",
          user_id: "system-user-1",
          is_valid: true,
          type: "SYSTEM_USER",
          scopes: ["ads_management"],
          granular_scopes: [
            {
              scope: "ads_management",
              target_ids: ["act_222222222222222"],
            },
          ],
          expires_at: 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const debugWithActPrefix = await clientModule.debugMetaAccessToken({
    appId: "meta-app-id",
    appSecret: "meta-app-secret",
    accessToken: "system-user-token",
  });
  assert.deepEqual(
    [...clientModule.getGranularTargetIds(debugWithActPrefix, "ads_management")],
    ["222222222222222"],
  );

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
