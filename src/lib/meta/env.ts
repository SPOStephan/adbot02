import "server-only";

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

export function getMetaCallbackEnv() {
  return {
    ...getMetaLoginStartEnv(),
    appSecret: required("META_APP_SECRET", process.env.META_APP_SECRET),
    tokenEncryptionKey: required(
      "META_TOKEN_ENCRYPTION_KEY",
      process.env.META_TOKEN_ENCRYPTION_KEY,
    ),
  };
}

export function getMetaWebhookEnv() {
  return {
    appSecret: required("META_APP_SECRET", process.env.META_APP_SECRET),
  };
}
