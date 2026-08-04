import assert from "node:assert/strict";

import { classifyMetaGrantedScopes } from "../src/lib/meta/scope-policy.mjs";

const REQUIRED_SCOPES = [
  "ads_read",
  "ads_management",
  "instagram_basic",
  "pages_read_engagement",
  "pages_show_list",
];

const exact = classifyMetaGrantedScopes(
  [...REQUIRED_SCOPES, "public_profile"],
  REQUIRED_SCOPES,
);
assert.deepEqual(exact, {
  missingScopes: [],
  compatibleSystemUserScopes: [],
  unexpectedScopes: [],
});

const productionSystemUser = classifyMetaGrantedScopes(
  [
    ...REQUIRED_SCOPES,
    "public_profile",
    "business_management",
    "pages_manage_metadata",
    "pages_manage_ads",
  ],
  REQUIRED_SCOPES,
);
assert.deepEqual(productionSystemUser, {
  missingScopes: [],
  compatibleSystemUserScopes: [
    "business_management",
    "pages_manage_metadata",
    "pages_manage_ads",
  ],
  unexpectedScopes: [],
});

const missingWriteScope = classifyMetaGrantedScopes(
  REQUIRED_SCOPES.filter((scope) => scope !== "ads_management"),
  REQUIRED_SCOPES,
);
assert.deepEqual(missingWriteScope.missingScopes, ["ads_management"]);
assert.deepEqual(missingWriteScope.unexpectedScopes, []);

const unknownPermission = classifyMetaGrantedScopes(
  [...REQUIRED_SCOPES, "pages_messaging"],
  REQUIRED_SCOPES,
);
assert.deepEqual(unknownPermission.missingScopes, []);
assert.deepEqual(unknownPermission.compatibleSystemUserScopes, []);
assert.deepEqual(unknownPermission.unexpectedScopes, ["pages_messaging"]);

const knownAndUnknownPermissions = classifyMetaGrantedScopes(
  [...REQUIRED_SCOPES, "business_management", "catalog_management"],
  REQUIRED_SCOPES,
);
assert.deepEqual(knownAndUnknownPermissions.compatibleSystemUserScopes, [
  "business_management",
]);
assert.deepEqual(knownAndUnknownPermissions.unexpectedScopes, [
  "catalog_management",
]);

console.log("Meta scope policy checks passed");
