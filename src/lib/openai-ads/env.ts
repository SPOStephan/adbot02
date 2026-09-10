import "server-only";

import { assertValidCredentialEncryptionKey } from "@/lib/platforms/credential-crypto";

const OPENAI_ADS_DEFAULT_BASE_URL = "https://api.ads.openai.com/v1";
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

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = value?.trim() || OPENAI_ADS_DEFAULT_BASE_URL;
  const url = new URL(normalized);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "OPENAI_ADS_API_BASE_URL muss eine HTTPS-Basis ohne Credentials, Query oder Fragment sein.",
    );
  }

  return url.toString().replace(/\/$/, "");
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
    baseUrl: normalizeBaseUrl(process.env.OPENAI_ADS_API_BASE_URL),
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
