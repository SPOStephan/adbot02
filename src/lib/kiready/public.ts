/** Safe for client bundles. Portal URL is not a secret. */
export const DEFAULT_KIREADY_PORTAL_URL = "https://kiready.co/portal";
export const DEFAULT_KIREADY_ISSUER =
  "https://vlqtujjdjxxsdfffcvdj.supabase.co/auth/v1";
export const DEFAULT_KIREADY_CONTEXT_URL =
  "https://kiready.co/api/v1/integrations/adbot/context";

export function kireadyPortalUrl() {
  const value = process.env.NEXT_PUBLIC_KIREADY_PORTAL_URL?.trim();
  return (value || DEFAULT_KIREADY_PORTAL_URL).replace(/\/+$/, "");
}

export const KIREADY_START_PATH = "/auth/kiready/start";
export const KIREADY_CALLBACK_PATH = "/auth/kiready/callback";
export const KIREADY_LINK_PATH = "/auth/kiready/link";
export const KIREADY_DENIED_PATH = "/auth/kiready/denied";
