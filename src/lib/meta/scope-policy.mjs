export const META_AUTOMATIC_SCOPES = ["public_profile"];

export const META_SYSTEM_USER_COMPATIBILITY_SCOPES = [
  "business_management",
  "pages_manage_ads",
  "pages_manage_metadata",
];

/**
 * @typedef {object} MetaScopeClassification
 * @property {string[]} missingScopes
 * @property {string[]} compatibleSystemUserScopes
 * @property {string[]} unexpectedScopes
 */

/**
 * Classifies the scopes returned by Meta without widening Adbot's functional
 * permission contract.
 *
 * @param {readonly string[]} grantedScopes
 * @param {readonly string[]} requiredScopes
 * @returns {MetaScopeClassification}
 */
export function classifyMetaGrantedScopes(grantedScopes, requiredScopes) {
  const granted = new Set(grantedScopes);
  const required = new Set(requiredScopes);
  const automatic = new Set(META_AUTOMATIC_SCOPES);
  const systemUserCompatibility = new Set(
    META_SYSTEM_USER_COMPATIBILITY_SCOPES,
  );

  return {
    missingScopes: requiredScopes.filter((scope) => !granted.has(scope)),
    compatibleSystemUserScopes: grantedScopes.filter((scope) =>
      systemUserCompatibility.has(scope),
    ),
    unexpectedScopes: grantedScopes.filter(
      (scope) =>
        !required.has(scope) &&
        !automatic.has(scope) &&
        !systemUserCompatibility.has(scope),
    ),
  };
}
