import "server-only";

import { randomUUID } from "node:crypto";

import { resolveMarketingAdAccountId } from "@/lib/meta/ad-account";
import {
  buildCapiProbeEvent,
  classifyCapiGraphFailure,
  connectionCapiCustomerMessage,
  listPixelsDeniedMessage,
  listPixelsEmptyMessage,
  parseAdAccountPixels,
  parseCapiGraphResponse,
  type CapiProbeStatus,
  type ConnectionPixel,
} from "@/lib/meta/conversions-api";
import { createAppSecretProof, decryptAccessToken } from "@/lib/meta/crypto";
import { META_GRAPH_VERSION } from "@/lib/meta/client";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const CAPI_MAX_ATTEMPTS = 3;
const CAPI_RETRY_DELAYS_MS = [0, 250, 750] as const;

export type ConnectionCapiCredentials = {
  accessToken: string;
  appSecret: string;
  adAccountId: string;
};

export type ConnectionCapiLoadError = {
  ok: false;
  error:
    | "token_missing"
    | "ad_account_missing"
    | "ad_account_selection_required"
    | "meta_account_unavailable";
  message: string;
};

export type ConnectionCapiProbeResult = {
  pixelId: string;
  status: Exclude<CapiProbeStatus, "untested">;
  message: string;
  eventsReceived?: number;
  httpStatus?: number;
  code?: number | null;
};

export type ConnectionCapiSendResult = {
  status: "sent" | "failed";
  reason?: string;
  eventsReceived?: number;
  attempts?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function loadError(
  error: ConnectionCapiLoadError["error"],
  message: string,
): ConnectionCapiLoadError {
  return { ok: false, error, message };
}

export async function loadConnectionCapiCredentials(input: {
  userId: string;
  platformAccountId: string;
}): Promise<ConnectionCapiCredentials | ConnectionCapiLoadError> {
  const admin = createAdminClient();
  const [{ data: account, error: accountError }, { data: adAccounts, error: adError }] =
    await Promise.all([
      admin
        .from("platform_accounts")
        .select(
          "id,access_token_encrypted,token_iv,token_auth_tag,marketing_meta_ad_account_id",
        )
        .eq("id", input.platformAccountId)
        .eq("user_id", input.userId)
        .eq("platform", "meta")
        .is("revoked_at", null)
        .maybeSingle(),
      admin
        .from("meta_assets")
        .select("meta_asset_id")
        .eq("platform_account_id", input.platformAccountId)
        .eq("user_id", input.userId)
        .eq("asset_type", "ad_account")
        .order("created_at", { ascending: true }),
    ]);

  if (accountError || !account) {
    return loadError(
      "meta_account_unavailable",
      "Die Meta-Verbindung ist nicht verfügbar. Bitte Meta erneut verbinden.",
    );
  }
  if (adError) {
    return loadError(
      "ad_account_missing",
      "Zum verbundenen Meta-Konto fehlt das Werbekonto.",
    );
  }

  const adAccountAssetIds = (adAccounts ?? [])
    .map((row) => (typeof row.meta_asset_id === "string" ? row.meta_asset_id : ""))
    .filter(Boolean);
  const adAccountId = resolveMarketingAdAccountId({
    selectedAdAccountId:
      typeof account.marketing_meta_ad_account_id === "string"
        ? account.marketing_meta_ad_account_id
        : null,
    adAccountAssetIds,
  });

  if (!adAccountId) {
    return loadError(
      adAccountAssetIds.length > 1
        ? "ad_account_selection_required"
        : "ad_account_missing",
      adAccountAssetIds.length > 1
        ? "Mehrere Werbekonten sind verbunden. Bitte zuerst das aktive Werbekonto wählen."
        : "Kein Werbekonto in der Meta-Verbindung. Bitte Meta neu verbinden und ein Werbekonto auswählen.",
    );
  }

  if (
    !account.access_token_encrypted ||
    !account.token_iv ||
    !account.token_auth_tag
  ) {
    return loadError(
      "token_missing",
      "Das Meta-Zugangstoken fehlt. Bitte Meta erneut verbinden.",
    );
  }

  try {
    const env = getMetaSyncEnv();
    const accessToken = decryptAccessToken(
      {
        ciphertext: account.access_token_encrypted,
        iv: account.token_iv,
        authTag: account.token_auth_tag,
      },
      env.tokenEncryptionKey,
    );
    return {
      accessToken,
      appSecret: env.appSecret,
      adAccountId,
    };
  } catch {
    return loadError(
      "token_missing",
      "Das Meta-Zugangstoken konnte nicht gelesen werden. Bitte Meta erneut verbinden.",
    );
  }
}

function graphEventsUrl(pixelId: string, accessToken: string, appSecret: string) {
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("appsecret_proof", createAppSecretProof(accessToken, appSecret));
  return url;
}

function graphPixelsUrl(adAccountId: string, accessToken: string, appSecret: string) {
  const accountId = adAccountId.replace(/^act_/i, "");
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(`act_${accountId}`)}/adspixels`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("limit", "50");
  url.searchParams.set("appsecret_proof", createAppSecretProof(accessToken, appSecret));
  return url;
}

export async function listConnectionAdAccountPixels(
  credentials: ConnectionCapiCredentials,
): Promise<
  | { ok: true; adAccountId: string; pixels: ConnectionPixel[] }
  | { ok: false; status: "denied" | "error"; message: string }
> {
  const url = graphPixelsUrl(
    credentials.adAccountId,
    credentials.accessToken,
    credentials.appSecret,
  );
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsed = parseCapiGraphResponse(body);
      const status = classifyCapiGraphFailure({
        httpStatus: response.status,
        code: parsed.error?.code,
      });
      return {
        ok: false,
        status,
        message: status === "denied" ? listPixelsDeniedMessage() : connectionCapiCustomerMessage("error"),
      };
    }
    const pixels = parseAdAccountPixels(body);
    return { ok: true, adAccountId: credentials.adAccountId, pixels };
  } catch {
    return {
      ok: false,
      status: "error",
      message: connectionCapiCustomerMessage("error"),
    };
  }
}

export async function sendConnectionCapiEvent(input: {
  credentials: ConnectionCapiCredentials;
  pixelId: string;
  event: Record<string, unknown>;
  testEventCode?: string;
  attempts?: number;
}): Promise<ConnectionCapiSendResult> {
  const eventPayload = {
    data: [input.event],
    access_token: input.credentials.accessToken,
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  };
  const url = graphEventsUrl(
    input.pixelId,
    input.credentials.accessToken,
    input.credentials.appSecret,
  );
  const maxAttempts = Math.max(1, Math.min(CAPI_MAX_ATTEMPTS, input.attempts ?? CAPI_MAX_ATTEMPTS));
  let lastFailure: ConnectionCapiSendResult = {
    status: "failed",
    reason: "Meta CAPI konnte technisch nicht erreicht werden",
    attempts: 0,
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const delay = CAPI_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) await sleep(delay);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.credentials.accessToken}`,
        },
        body: JSON.stringify(eventPayload),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const parsed = parseCapiGraphResponse(await response.json().catch(() => ({})));
      if (!response.ok) {
        lastFailure = {
          status: "failed",
          reason: "Meta CAPI hat das Ereignis abgelehnt",
          eventsReceived: parsed.eventsReceived,
          attempts: attempt + 1,
        };
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < maxAttempts - 1
        ) {
          continue;
        }
        return lastFailure;
      }
      if (!parsed.eventsReceived || parsed.eventsReceived < 1) {
        return {
          status: "failed",
          reason: "Meta CAPI hat kein empfangenes Ereignis bestätigt",
          eventsReceived: parsed.eventsReceived,
          attempts: attempt + 1,
        };
      }
      return {
        status: "sent",
        eventsReceived: parsed.eventsReceived,
        attempts: attempt + 1,
      };
    } catch {
      lastFailure = {
        status: "failed",
        reason: "Meta CAPI konnte technisch nicht erreicht werden",
        attempts: attempt + 1,
      };
    }
  }

  return lastFailure;
}

export async function probeConnectionCapi(input: {
  credentials: ConnectionCapiCredentials;
  pixelId: string;
  testEventCode?: string;
}): Promise<ConnectionCapiProbeResult> {
  const eventId = randomUUID();
  const sent = await sendConnectionCapiEvent({
    credentials: input.credentials,
    pixelId: input.pixelId,
    event: buildCapiProbeEvent({ pixelId: input.pixelId, eventId }),
    testEventCode: input.testEventCode,
    attempts: 1,
  });
  if (sent.status === "sent") {
    return {
      pixelId: input.pixelId,
      status: "ok",
      message: connectionCapiCustomerMessage("ok"),
      eventsReceived: sent.eventsReceived,
    };
  }
  const status =
    sent.reason === "Meta CAPI konnte technisch nicht erreicht werden"
      ? "error"
      : "denied";
  return {
    pixelId: input.pixelId,
    status,
    message: connectionCapiCustomerMessage(status),
    eventsReceived: sent.eventsReceived,
  };
}

export { listPixelsEmptyMessage };
