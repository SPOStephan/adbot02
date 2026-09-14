import "server-only";

import { randomUUID } from "node:crypto";

import {
  OpenAIAdsApiError,
  OpenAIAdsClient,
  type OpenAIAdsAccount,
} from "@/lib/openai-ads/client";
import { getOpenAIAdsEnv } from "@/lib/openai-ads/env";
import {
  decryptCredential,
  encryptCredential,
} from "@/lib/platforms/credential-crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const ENCRYPTION_VARIABLE = "OPENAI_ADS_TOKEN_ENCRYPTION_KEY";

export class OpenAIAdsServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "OpenAIAdsServiceError";
    this.code = code;
    this.status = status;
  }
}

type EncryptedConnectionRow = {
  id: string;
  user_id: string;
  platform_account_id: string;
  access_token_encrypted: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  revoked_at: string | null;
  credential_generation: string;
  provider_sync_claim_token: string | null;
};

function mapProviderError(error: OpenAIAdsApiError): OpenAIAdsServiceError {
  if (error.status === 401 || error.status === 403) {
    return new OpenAIAdsServiceError(
      "credential_rejected",
      400,
      "Der OpenAI-Ads-API-Key wurde nicht akzeptiert oder besitzt keinen Zugriff auf dieses Werbekonto.",
    );
  }
  if (error.status === 429) {
    return new OpenAIAdsServiceError(
      "provider_rate_limited",
      429,
      "OpenAI Ads hat zu viele Anfragen erhalten. Bitte später erneut versuchen.",
    );
  }
  return new OpenAIAdsServiceError(
    error.code ?? "provider_unavailable",
    error.status >= 400 && error.status < 600 ? error.status : 502,
    "Das OpenAI-Ads-Konto konnte nicht sicher geprüft werden.",
  );
}

function providerMetadata(account: OpenAIAdsAccount) {
  return {
    id: account.id,
    url: account.url,
    preview_url: account.preview_url,
    account_status: account.status,
    timezone: account.timezone,
    currency_code: account.currency_code,
    review_status: account.review.status,
    review_reason: account.review.reason ?? null,
    account_integrity_review_observed:
      account.account_integrity_review !== null,
    account_integrity_review_status:
      account.account_integrity_review?.review.status ?? null,
    api_version: "v1",
  };
}

export async function connectOpenAIAdsAccount(input: {
  userId: string;
  apiKey: string;
}) {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 20 || apiKey.length > 4096) {
    throw new OpenAIAdsServiceError(
      "invalid_api_key",
      400,
      "Bitte einen gültigen OpenAI-Ads-API-Key eingeben.",
    );
  }

  const env = getOpenAIAdsEnv();
  const client = new OpenAIAdsClient({
    apiKey,
    baseUrl: env.baseUrl,
  });

  let account: OpenAIAdsAccount;
  try {
    account = await client.getAdAccount();
  } catch (error) {
    if (error instanceof OpenAIAdsApiError) {
      throw mapProviderError(error);
    }
    throw error;
  }

  const encrypted = encryptCredential(
    apiKey,
    env.tokenEncryptionKey,
    ENCRYPTION_VARIABLE,
  );
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("platform_accounts")
    .upsert(
      {
        user_id: input.userId,
        platform: "openai_ads",
        platform_account_id: account.id,
        account_id: account.id,
        account_name: account.name,
        access_token: null,
        refresh_token: null,
        access_token_encrypted: encrypted.ciphertext,
        token_iv: encrypted.iv,
        token_auth_tag: encrypted.authTag,
        token_version: 1,
        credential_kind: "api_key",
        credential_generation: randomUUID(),
        provider_sync_claim_token: null,
        provider_sync_claimed_at: null,
        provider_metadata: providerMetadata(account),
        provider_sync_status: "idle",
        provider_sync_error_code: null,
        provider_next_sync_at: now,
        provider_backoff_until: null,
        provider_consecutive_failures: 0,
        connected_at: now,
        revoked_at: null,
        expires_at: null,
        refresh_at: null,
        updated_at: now,
      },
      { onConflict: "user_id,platform,platform_account_id" },
    )
    .select("id, platform_account_id, account_name, provider_metadata")
    .single();

  if (error || !data) {
    console.error("openai_ads_connection_storage_failed", {
      code: error?.code ?? null,
      remoteAccountId: account.id,
    });
    throw new OpenAIAdsServiceError(
      "connection_storage_failed",
      500,
      "Das geprüfte OpenAI-Ads-Konto konnte nicht gespeichert werden.",
    );
  }

  return {
    platformAccountId: data.id as string,
    remoteAccountId: account.id,
    accountName: account.name,
    currencyCode: account.currency_code,
    timezone: account.timezone,
    accountStatus: account.status,
    reviewStatus: account.review.status,
    accountIntegrityReviewStatus:
      account.account_integrity_review?.review.status ?? null,
  };
}

export async function loadOpenAIAdsClient(input: {
  platformAccountId: string;
  userId?: string;
  deadlineAtMs?: number;
  credentialGeneration?: string;
  syncClaimToken?: string;
}) {
  const env = getOpenAIAdsEnv();
  const admin = createAdminClient();
  let query = admin
    .from("platform_accounts")
    .select(
      "id,user_id,platform_account_id,access_token_encrypted,token_iv,token_auth_tag,revoked_at,credential_generation,provider_sync_claim_token",
    )
    .eq("id", input.platformAccountId)
    .eq("platform", "openai_ads")
    .is("revoked_at", null);

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }
  if (input.credentialGeneration) {
    query = query.eq("credential_generation", input.credentialGeneration);
  }
  if (input.syncClaimToken) {
    query = query.eq("provider_sync_claim_token", input.syncClaimToken);
  }

  const { data, error } = await query.maybeSingle();
  const connection = data as EncryptedConnectionRow | null;

  if (error || !connection) {
    if (input.credentialGeneration || input.syncClaimToken) {
      throw new OpenAIAdsServiceError(
        "sync_claim_superseded",
        409,
        "Der OpenAI-Ads-Abruf wurde durch eine neuere Verbindung oder einen neueren Abruf ersetzt.",
      );
    }
    throw new OpenAIAdsServiceError(
      "connection_not_found",
      404,
      "Die OpenAI-Ads-Verbindung wurde nicht gefunden.",
    );
  }

  if (
    !connection.access_token_encrypted ||
    !connection.token_iv ||
    !connection.token_auth_tag
  ) {
    throw new OpenAIAdsServiceError(
      "credential_missing",
      409,
      "Die OpenAI-Ads-Verbindung muss erneut hergestellt werden.",
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptCredential(
      {
        ciphertext: connection.access_token_encrypted,
        iv: connection.token_iv,
        authTag: connection.token_auth_tag,
      },
      env.tokenEncryptionKey,
      ENCRYPTION_VARIABLE,
    );
  } catch {
    throw new OpenAIAdsServiceError(
      "credential_decryption_failed",
      500,
      "Die OpenAI-Ads-Verbindung konnte nicht entschlüsselt werden.",
    );
  }

  return {
    connection,
    client: new OpenAIAdsClient({
      apiKey,
      baseUrl: env.baseUrl,
      deadlineAtMs: input.deadlineAtMs,
    }),
  };
}

export async function disconnectOpenAIAdsAccount(input: {
  userId: string;
  platformAccountId: string;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("platform_accounts")
    .update({
      access_token_encrypted: null,
      token_iv: null,
      token_auth_tag: null,
      credential_kind: null,
      credential_generation: randomUUID(),
      provider_sync_claim_token: null,
      provider_sync_claimed_at: null,
      provider_sync_status: "revoked",
      provider_sync_error_code: null,
      provider_backoff_until: null,
      revoked_at: now,
      updated_at: now,
    })
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .eq("platform", "openai_ads")
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new OpenAIAdsServiceError(
      "disconnect_failed",
      500,
      "Die OpenAI-Ads-Verbindung konnte nicht sicher getrennt werden.",
    );
  }

  return { disconnected: Boolean(data) };
}
