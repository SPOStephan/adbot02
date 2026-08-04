import "server-only";

import { assertValidMetaTokenEncryptionKey } from "./crypto";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. Bitte ausschließlich serverseitig in Vercel hinterlegen.`,
    );
  }

  return normalized;
}

function requiredSecret(
  name: string,
  value: string | undefined,
  minimumLength = 32,
): string {
  const secret = required(name, value);

  if (secret.length < minimumLength) {
    throw new Error(
      `Die Umgebungsvariable ${name} muss mindestens ${minimumLength} Zeichen lang sein.`,
    );
  }

  return secret;
}

export function getMetaLoginStartEnv() {
  return {
    appId: required("META_APP_ID", process.env.META_APP_ID),
    loginConfigId: required(
      "META_LOGIN_CONFIG_ID",
      process.env.META_LOGIN_CONFIG_ID,
    ),
    stateSecret: requiredSecret(
      "META_STATE_SECRET",
      process.env.META_STATE_SECRET,
    ),
  };
}

export function getMetaSyncEnv() {
  const tokenEncryptionKey = required(
    "META_TOKEN_ENCRYPTION_KEY",
    process.env.META_TOKEN_ENCRYPTION_KEY,
  );
  assertValidMetaTokenEncryptionKey(tokenEncryptionKey);

  return {
    appId: required("META_APP_ID", process.env.META_APP_ID),
    appSecret: required("META_APP_SECRET", process.env.META_APP_SECRET),
    tokenEncryptionKey,
  };
}

export function getMetaCallbackEnv() {
  return {
    ...getMetaLoginStartEnv(),
    ...getMetaSyncEnv(),
  };
}

export function getCronAuthEnv() {
  return {
    cronSecret: requiredSecret("CRON_SECRET", process.env.CRON_SECRET),
  };
}

export function getMetaCronEnv() {
  return {
    ...getMetaSyncEnv(),
    ...getCronAuthEnv(),
  };
}

export function getMetaWebhookEnv() {
  return {
    appSecret: required("META_APP_SECRET", process.env.META_APP_SECRET),
  };
}
