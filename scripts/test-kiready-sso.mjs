import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  kireadyContextErrorMessage,
  readKireadyContextErrorCode,
} from "../src/lib/kiready/errors.ts";
import {
  accessFromDecision,
  decideKireadyAccess,
} from "../src/lib/kiready/policy.ts";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

assert.match(read("src/lib/kiready/oidc.ts"), /code_challenge_method/);
assert.match(read("src/lib/kiready/oidc.ts"), /clientSecretBasicHeader/);
assert.match(read("src/lib/kiready/oidc.ts"), /Authorization: clientSecretBasicHeader/);
assert.doesNotMatch(
  read("src/lib/kiready/oidc.ts"),
  /client_secret: input\.env\.clientSecret/,
);
assert.match(
  read("src/lib/kiready/public.ts"),
  /657c70b6-63f2-43f5-a00d-e22574d18add/,
);
assert.match(
  read("src/lib/kiready/env.ts"),
  /DEFAULT_KIREADY_OIDC_CLIENT_ID/,
);
assert.match(
  read("src/lib/kiready/env.ts"),
  /optional\("KIREADY_OIDC_CLIENT_SECRET"\)/,
);
assert.match(
  read("src/lib/kiready/oidc.ts"),
  /DEFAULT_KIREADY_TOKEN_ENDPOINT/,
);
assert.match(read("src/lib/kiready/context.ts"), /resolveKireadyContextError/);
assert.match(read("src/app/auth/kiready/callback/route.ts"), /KireadyContextError/);
assert.match(read("src/app/auth/kiready/start/route.ts"), /buildKireadyAuthorizeUrl/);
assert.match(read("src/app/auth/kiready/callback/route.ts"), /verifyKireadyIdToken/);
assert.match(read("src/app/auth/kiready/callback/route.ts"), /findIdentity/);
assert.match(read("src/app/auth/kiready/link/page.tsx"), /Konto einmalig verknüpfen/);
assert.match(read("src/components/AuthForm.tsx"), /Mit KIready anmelden/);
assert.match(read("src/components/AuthForm.tsx"), /Sicher anmelden[\s\S]*Mit KIready anmelden/);
assert.match(read("src/components/DashboardHeaderChrome.tsx"), /KIready öffnen/);
assert.match(read("src/components/SignOutButton.tsx"), /window\.location\.assign\(`\$\{APP_SITE_URL\}\/login`\)/);
assert.match(read("src/lib/site-urls.ts"), /\/auth\/kiready\/start/);
assert.doesNotMatch(read("src/lib/supabase/proxy.ts"), /isAuthRoute[\s\S]*kiready/);
assert.match(read("src/lib/billing/credits.ts"), /assertKireadyPaidActionAllowed/);
assert.match(read("supabase/migrations/20260920140000_kiready_sso_phase1.sql"), /kiready_external_identities/);
assert.match(read("supabase/migrations/20260920140000_kiready_sso_phase1.sql"), /adbot_organizations/);
assert.match(read("supabase/migrations/20260920140000_kiready_sso_phase1.sql"), /unique \(issuer, subject\)/);
assert.doesNotMatch(read("src/app/auth/kiready/callback/route.ts"), /localStorage/);
assert.doesNotMatch(read("src/lib/kiready/oidc.ts"), /console\.log\(.*token/);

assert.equal(
  decideKireadyAccess({
    hasAccess: true,
    status: "active",
    validUntil: null,
    hasAdbotUse: true,
  }),
  "ok",
);
assert.equal(
  decideKireadyAccess({
    hasAccess: true,
    status: "active",
    validUntil: null,
    hasAdbotUse: false,
  }),
  "no_personal_use",
);
assert.equal(
  decideKireadyAccess({
    hasAccess: false,
    status: "past_due",
    validUntil: null,
    hasAdbotUse: true,
  }),
  "past_due",
);
assert.equal(accessFromDecision("past_due").allowDashboard, true);
assert.equal(accessFromDecision("past_due").allowPaidActions, false);
assert.equal(accessFromDecision("canceled").allowDashboard, false);
assert.equal(
  decideKireadyAccess({
    hasAccess: true,
    status: "trial",
    validUntil: "2026-10-20T11:46:03.5958+00:00",
    hasAdbotUse: true,
  }),
  "ok",
);
assert.equal(
  decideKireadyAccess({
    hasAccess: true,
    status: "trialing",
    validUntil: null,
    hasAdbotUse: true,
  }),
  "ok",
);

assert.equal(readKireadyContextErrorCode(401, { error: "AUTH_REQUIRED" }), "AUTH_REQUIRED");
assert.equal(
  readKireadyContextErrorCode(403, { code: "ADBOT_ACCESS_NOT_ASSIGNED" }),
  "ADBOT_ACCESS_NOT_ASSIGNED",
);
assert.equal(
  readKireadyContextErrorCode(403, { error: "CLIENT_NOT_ALLOWED" }),
  "CLIENT_NOT_ALLOWED",
);
assert.equal(
  readKireadyContextErrorCode(402, { code: "ADBOT_ENTITLEMENT_REQUIRED" }),
  "ADBOT_ENTITLEMENT_REQUIRED",
);
assert.equal(
  readKireadyContextErrorCode(404, { code: "ORGANIZATION_NOT_FOUND" }),
  "ORGANIZATION_NOT_FOUND",
);
assert.equal(
  kireadyContextErrorMessage("ADBOT_ACCESS_NOT_ASSIGNED"),
  "Dein Unternehmen hat Adbot, aber du bist persönlich nicht freigeschaltet.",
);

assert.match(read("src/lib/kiready/types.ts"), /"trial"/);
assert.match(read("src/lib/kiready/policy.ts"), /status === "trial"/);
assert.match(read("src/lib/kiready/parse.ts"), /entitlement\.status/);
assert.match(read(".env.example"), /KIREADY_ENTITLEMENT_HMAC_SECRET/);

assert.match(read("src/lib/kiready/parse.ts"), /identity\.email\)\.toLowerCase\(\)/);
assert.match(read("src/lib/kiready/parse.ts"), /emailVerified === true/);

console.log("test-kiready-sso: ok");
