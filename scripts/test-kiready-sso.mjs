import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  accessFromDecision,
  decideKireadyAccess,
} from "../src/lib/kiready/policy.ts";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

assert.match(read("src/lib/kiready/oidc.ts"), /code_challenge_method/);
assert.match(read("src/app/auth/kiready/start/route.ts"), /buildKireadyAuthorizeUrl/);
assert.match(read("src/app/auth/kiready/callback/route.ts"), /verifyKireadyIdToken/);
assert.match(read("src/app/auth/kiready/callback/route.ts"), /findIdentity/);
assert.match(read("src/app/auth/kiready/link/page.tsx"), /Konto einmalig verknüpfen/);
assert.match(read("src/components/AuthForm.tsx"), /Mit KIready anmelden/);
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

assert.match(read("src/lib/kiready/parse.ts"), /identity\.email\)\.toLowerCase\(\)/);
assert.match(read("src/lib/kiready/parse.ts"), /emailVerified === true/);

console.log("test-kiready-sso: ok");
