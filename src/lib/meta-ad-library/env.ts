import "server-only";

import { APP_SITE_URL } from "@/lib/site-urls";

import { MetaAdLibraryError } from "./errors";
import { META_AD_LIBRARY_REDIRECT_PATH } from "./types";

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function metaAdLibraryRedirectUri(): string {
  return `${APP_SITE_URL}${META_AD_LIBRARY_REDIRECT_PATH}`;
}

export function readMetaAdLibraryAppConfig() {
  const appId = trim(process.env.META_AD_LIBRARY_APP_ID);
  const appSecret = trim(process.env.META_AD_LIBRARY_APP_SECRET);
  const accessTokenEnv = trim(process.env.META_AD_LIBRARY_ACCESS_TOKEN);
  const productAppId = trim(process.env.META_APP_ID);
  const productAppSecret = trim(process.env.META_APP_SECRET);
  const tokenEncryptionKey = trim(process.env.META_TOKEN_ENCRYPTION_KEY);
  const isolatedFromProductApp =
    Boolean(appId) &&
    appId !== productAppId &&
    (!appSecret || !productAppSecret || appSecret !== productAppSecret);

  return {
    appId: appId || null,
    appSecret: appSecret || null,
    accessTokenEnv: accessTokenEnv || null,
    productAppId: productAppId || null,
    tokenEncryptionKey: tokenEncryptionKey || null,
    libraryAppConfigured: Boolean(appId && appSecret),
    isolatedFromProductApp,
    productAppConfigured: Boolean(productAppId),
    encryptionReady: Boolean(tokenEncryptionKey),
    redirectUri: metaAdLibraryRedirectUri(),
  };
}

export function requireMetaAdLibraryApp() {
  const config = readMetaAdLibraryAppConfig();
  if (!config.libraryAppConfigured || !config.appId || !config.appSecret) {
    throw new MetaAdLibraryError(
      "app_not_configured",
      409,
      "META_AD_LIBRARY_APP_ID und META_AD_LIBRARY_APP_SECRET fehlen. Das ist die zweite Meta-App, nicht die Kunden-App.",
    );
  }
  if (!config.isolatedFromProductApp) {
    throw new MetaAdLibraryError(
      "shared_product_app",
      409,
      "Die Library-App verwendet dieselbe App-ID oder dasselbe Secret wie die Kunden-Meta-App. Bitte eine eigene App anlegen.",
    );
  }
  return {
    appId: config.appId,
    appSecret: config.appSecret,
    accessTokenEnv: config.accessTokenEnv,
    tokenEncryptionKey: config.tokenEncryptionKey,
    redirectUri: config.redirectUri,
  };
}
