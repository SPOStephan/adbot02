import "server-only";

import { APP_SITE_URL } from "@/lib/site-urls";
import {
  DEFAULT_KIREADY_CONTEXT_URL,
  DEFAULT_KIREADY_ISSUER,
  DEFAULT_KIREADY_PORTAL_URL,
  KIREADY_CALLBACK_PATH,
} from "@/lib/kiready/public";

export type KireadyOidcEnv = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  contextUrl: string;
  portalUrl: string;
  stateSecret: string;
  tokenEncryptionKey: string | null;
};

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requiredWhenConfigured(name: string, value: string): string {
  if (!value) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. Bitte ausschließlich serverseitig in Vercel hinterlegen.`,
    );
  }
  return value;
}

export function isKireadyOidcConfigured(): boolean {
  return Boolean(
    optional("KIREADY_OIDC_CLIENT_ID") &&
      optional("KIREADY_OIDC_CLIENT_SECRET") &&
      optional("KIREADY_STATE_SECRET"),
  );
}

export function getKireadyOidcEnv(): KireadyOidcEnv {
  const clientId = requiredWhenConfigured(
    "KIREADY_OIDC_CLIENT_ID",
    optional("KIREADY_OIDC_CLIENT_ID"),
  );
  const clientSecret = requiredWhenConfigured(
    "KIREADY_OIDC_CLIENT_SECRET",
    optional("KIREADY_OIDC_CLIENT_SECRET"),
  );
  const stateSecret = requiredWhenConfigured(
    "KIREADY_STATE_SECRET",
    optional("KIREADY_STATE_SECRET"),
  );
  if (stateSecret.length < 32) {
    throw new Error("KIREADY_STATE_SECRET muss mindestens 32 Zeichen haben.");
  }

  const issuer = (optional("KIREADY_OIDC_ISSUER") || DEFAULT_KIREADY_ISSUER).replace(
    /\/+$/,
    "",
  );
  const redirectUri =
    optional("KIREADY_OIDC_REDIRECT_URI") || `${APP_SITE_URL}${KIREADY_CALLBACK_PATH}`;
  const contextUrl =
    optional("KIREADY_CONTEXT_URL") || DEFAULT_KIREADY_CONTEXT_URL;
  const portalUrl =
    optional("KIREADY_PORTAL_URL") ||
    optional("NEXT_PUBLIC_KIREADY_PORTAL_URL") ||
    DEFAULT_KIREADY_PORTAL_URL;
  const tokenEncryptionKey = optional("KIREADY_TOKEN_ENCRYPTION_KEY") || null;

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    contextUrl,
    portalUrl: portalUrl.replace(/\/+$/, ""),
    stateSecret,
    tokenEncryptionKey,
  };
}
