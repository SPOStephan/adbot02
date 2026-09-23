import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const source = await readFile(
  path.join(root, "src/lib/funnel-admin-host.ts"),
  "utf8",
);
const typesSource = await readFile(
  path.join(root, "src/lib/custom-domains/types.ts"),
  "utf8",
);
const siteUrlsSource = await readFile(
  path.join(root, "src/lib/site-urls.ts"),
  "utf8",
);

function transpile(input) {
  return ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

const typesUrl = `data:text/javascript;base64,${Buffer.from(transpile(typesSource)).toString("base64")}`;
const siteUrl = `data:text/javascript;base64,${Buffer.from(
  transpile(siteUrlsSource.replace(/from "@\/lib\/[^\"]+"/g, 'from "./x"')),
).toString("base64")}`;

const rewritten = source
  .replace(
    'from "@/lib/custom-domains/types"',
    `from "${typesUrl}"`,
  )
  .replace('from "@/lib/site-urls"', `from "${siteUrl}"`);

const hostModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(rewritten)).toString("base64")}`
);

assert.equal(
  hostModule.resolveCustomerFunnelAdminHostname([
    { hostname: "pending.example.de", status: "PENDING_DNS", bindingKind: "funnel" },
    { hostname: "freebie.example.de", status: "READY", bindingKind: "freebie" },
    { hostname: "Karriere.Kunde.de", status: "READY", bindingKind: "funnel" },
  ]),
  "karriere.kunde.de",
);
assert.equal(
  hostModule.resolveCustomerFunnelAdminHostname([
    { hostname: "funnel.adbot.one", status: "READY", bindingKind: "funnel" },
  ]),
  null,
);
assert.equal(hostModule.isAllowedFunnelAdminPath("/admin/applications"), true);
assert.equal(hostModule.isAllowedFunnelAdminPath("https://evil.test"), false);
assert.equal(hostModule.defaultFunnelAdminPath(true), "/admin/applications");
assert.equal(
  hostModule.createFunnelSsoConsumeUrl({
    hostname: "karriere.kunde.de",
    nextPath: "/admin/applications",
  }).origin,
  "https://karriere.kunde.de",
);

const ssoRoute = await readFile(
  path.join(root, "src/app/api/funnel/sso/route.ts"),
  "utf8",
);
assert.match(ssoRoute, /resolveCustomerFunnelAdminHostname/);
assert.match(ssoRoute, /createFunnelSsoConsumeUrl/);
assert.match(ssoRoute, /audienceHostname/);

const layout = await readFile(
  path.join(root, "apps/adbot-funnel/client/src/components/DashboardLayout.tsx"),
  "utf8",
);
assert.match(layout, /portalFunnelSsoUrl/);
assert.match(layout, /isSharedFunnelHost/);

const login = await readFile(
  path.join(root, "apps/adbot-funnel/client/src/components/AdminLoginForm.tsx"),
  "utf8",
);
assert.match(login, /Mit Adbot-Konto anmelden/);
assert.match(login, /mode === "customer"/);

const consume = await readFile(
  path.join(root, "apps/adbot-funnel/server/_core/adbotSsoRoute.ts"),
  "utf8",
);
assert.match(consume, /resolveFunnelAdminNextPath/);
assert.match(consume, /req.hostname/);

console.log("Funnel-Admin auf eigener Domain: Resolver und Einstiege geprüft.");
