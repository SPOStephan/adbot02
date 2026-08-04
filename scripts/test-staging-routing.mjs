import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const signOutSourcePath = new URL(
  "../src/components/SignOutButton.tsx",
  import.meta.url,
);
const siteUrlsSourcePath = new URL("../src/lib/site-urls.ts", import.meta.url);
const signOutSource = await readFile(signOutSourcePath, "utf8");
const siteUrlsSource = await readFile(siteUrlsSourcePath, "utf8");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-staging-routing-"));
const originalMarketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

function setEnvironmentValue(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function importSiteUrls(filename, marketingUrl, appUrl) {
  setEnvironmentValue("NEXT_PUBLIC_MARKETING_URL", marketingUrl);
  setEnvironmentValue("NEXT_PUBLIC_APP_URL", appUrl);

  const compiled = ts.transpileModule(siteUrlsSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = join(temporaryDirectory, filename);
  await writeFile(modulePath, compiled, "utf8");

  return import(pathToFileURL(modulePath).href);
}

try {
  assert.match(
    signOutSource,
    /import\s*\{\s*APP_SITE_URL\s*\}\s*from\s*["']@\/lib\/site-urls["']/,
  );
  assert.doesNotMatch(signOutSource, /MARKETING_SITE_URL/);
  assert.match(
    signOutSource,
    /window\.location\.assign\(`\$\{APP_SITE_URL\}\/login`\)/,
  );

  const equalHostUrls = await importSiteUrls(
    "site-urls-equal-hosts.mjs",
    "https://staging.app.adbot.one",
    "https://staging.app.adbot.one",
  );
  assert.equal(
    equalHostUrls.isMarketingHostname("staging.app.adbot.one"),
    false,
  );
  assert.equal(equalHostUrls.isPortalHostname("staging.app.adbot.one"), true);
  assert.equal(
    equalHostUrls.createPortalUrl("/login").toString(),
    "https://staging.app.adbot.one/login",
  );

  const separateHostUrls = await importSiteUrls(
    "site-urls-separate-hosts.mjs",
    "https://adbot.one",
    "https://app.adbot.one",
  );
  assert.equal(separateHostUrls.isMarketingHostname("adbot.one"), true);
  assert.equal(separateHostUrls.isMarketingHostname("www.adbot.one"), true);
  assert.equal(separateHostUrls.isPortalHostname("app.adbot.one"), true);
  assert.equal(separateHostUrls.isPortalPath("/passwort-vergessen"), true);
  assert.equal(separateHostUrls.isPortalPath("/passwort-neu"), true);

  console.log("Staging-Routing-Regressionstests erfolgreich.");
} finally {
  setEnvironmentValue("NEXT_PUBLIC_MARKETING_URL", originalMarketingUrl);
  setEnvironmentValue("NEXT_PUBLIC_APP_URL", originalAppUrl);
  await rm(temporaryDirectory, { force: true, recursive: true });
}
