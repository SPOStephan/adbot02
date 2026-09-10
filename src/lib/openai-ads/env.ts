import "server-only";

import { assertValidCredentialEncryptionKey } from "@/lib/platforms/credential-crypto";

const OPENAI_ADS_BASE_URL = "https://api.ads.openai.com/v1";
const OPENAI_ADS_ENCRYPTION_VARIABLE = "OPENAI_ADS_TOKEN_ENCRYPTION_KEY";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. Bitte ausschließlich serverseitig in Vercel hinterlegen.`,
    );
  }

  return normalized;
}

export type OpenAIAdsEnv = {
  baseUrl: string;
  tokenEncryptionKey: string;
};

export function getOpenAIAdsEnv(): OpenAIAdsEnv {
  const tokenEncryptionKey = required(
    OPENAI_ADS_ENCRYPTION_VARIABLE,
    process.env.OPENAI_ADS_TOKEN_ENCRYPTION_KEY,
  );
  assertValidCredentialEncryptionKey(
    tokenEncryptionKey,
    OPENAI_ADS_ENCRYPTION_VARIABLE,
  );

  return {
    baseUrl: OPENAI_ADS_BASE_URL,
    tokenEncryptionKey,
  };
}

export function hasOpenAIAdsEnv(): boolean {
  try {
    getOpenAIAdsEnv();
    return true;
  } catch {
    return false;
  }
}
