/** Safe for client bundles. Portal URL and Client-ID are not secrets. */
export const DEFAULT_KIREADY_PORTAL_URL = "https://kiready.co/portal";
export const DEFAULT_KIREADY_ISSUER =
  "https://vlqtujjdjxxsdfffcvdj.supabase.co/auth/v1";
export const DEFAULT_KIREADY_OIDC_CLIENT_ID =
  "657c70b6-63f2-43f5-a00d-e22574d18add";
export const DEFAULT_KIREADY_CONTEXT_URL =
  "https://kiready.co/api/v1/integrations/adbot/context";
export const DEFAULT_KIREADY_AUTHORIZATION_ENDPOINT = `${DEFAULT_KIREADY_ISSUER}/oauth/authorize`;
export const DEFAULT_KIREADY_TOKEN_ENDPOINT = `${DEFAULT_KIREADY_ISSUER}/oauth/token`;
export const DEFAULT_KIREADY_JWKS_URI = `${DEFAULT_KIREADY_ISSUER}/.well-known/jwks.json`;

export function kireadyPortalUrl() {
  const value = process.env.NEXT_PUBLIC_KIREADY_PORTAL_URL?.trim();
  return (value || DEFAULT_KIREADY_PORTAL_URL).replace(/\/+$/, "");
}

export const KIREADY_START_PATH = "/auth/kiready/start";
export const KIREADY_CALLBACK_PATH = "/auth/kiready/callback";
export const KIREADY_LINK_PATH = "/auth/kiready/link";
export const KIREADY_DENIED_PATH = "/auth/kiready/denied";
