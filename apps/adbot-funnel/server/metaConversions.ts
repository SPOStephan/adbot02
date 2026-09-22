import { createHash } from "node:crypto";
import type {
  ApplicationRecord,
  ApplicationSubmission,
  FunnelConfig,
  LeadQuality,
} from "@shared/funnel";
import {
  DEFAULT_LEAD_QUALITY_META,
  resolveQualityEventName,
  resolveQualityEventValue,
} from "@shared/leadValue";
import { getFunnelOwner, getMetaServerSettings } from "./funnelStore";
import { sendViaPortalCapi } from "./portalCapiRelay";

const META_GRAPH_API_VERSION = "v25.0";
/** Initial attempt + bounded retries for transient failures only. */
const CAPI_MAX_ATTEMPTS = 3;
const CAPI_RETRY_DELAYS_MS = [0, 250, 750] as const;

type RequestMetadata = { clientIp?: string; userAgent?: string };
export type MetaSendResult = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  eventsReceived?: number;
  attempts?: number;
};

type MetaApiResponse = {
  eventsReceived?: number;
  traceId?: string;
  error?: {
    type?: string;
    code?: number;
    subcode?: number;
    traceId?: string;
  };
};

function parseMetaApiResponse(value: unknown): MetaApiResponse {
  if (!value || typeof value !== "object") return {};

  const body = value as Record<string, unknown>;
  const rawError =
    body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : undefined;

  return {
    eventsReceived:
      typeof body.events_received === "number"
        ? body.events_received
        : undefined,
    traceId: typeof body.fbtrace_id === "string" ? body.fbtrace_id : undefined,
    error: rawError
      ? {
          type: typeof rawError.type === "string" ? rawError.type : undefined,
          code: typeof rawError.code === "number" ? rawError.code : undefined,
          subcode:
            typeof rawError.error_subcode === "number"
              ? rawError.error_subcode
              : undefined,
          traceId:
            typeof rawError.fbtrace_id === "string"
              ? rawError.fbtrace_id
              : undefined,
        }
      : undefined,
  };
}

async function readMetaApiResponse(
  response: Response
): Promise<MetaApiResponse> {
  try {
    return parseMetaApiResponse(await response.json());
  } catch {
    return {};
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedHash(
  value: string | undefined,
  normalize: (value: string) => string
) {
  const normalized = value ? normalize(value) : "";
  return normalized ? [sha256(normalized)] : undefined;
}

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

function isRetryableHttpStatus(status: number) {
  return status === 429 || status >= 500;
}

function hashedUserData(input: {
  applicationId: string;
  name?: string;
  email?: string;
  phone?: string;
  clientIp?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
}) {
  const fullName = input.name?.trim().toLowerCase() ?? "";
  const firstName = fullName.split(/\s+/)[0];
  const userData = {
    em: normalizedHash(input.email, value => value.trim().toLowerCase()),
    ph: normalizedHash(input.phone, value => value.replace(/\D/g, "")),
    fn: firstName ? [sha256(firstName)] : undefined,
    external_id: [sha256(input.applicationId)],
    client_ip_address: input.clientIp,
    client_user_agent: input.userAgent,
    fbp: input.fbp,
    fbc: input.fbc,
  };
  return Object.fromEntries(
    Object.entries(userData).filter(([, value]) => value !== undefined)
  );
}

function conversionCustomData(
  config: FunnelConfig,
  application: ApplicationRecord,
  extra: Record<string, string | number> = {},
) {
  const customData: Record<string, string | number> = {
    content_category: "Recruiting",
    content_name: config.title,
    funnel_slug: config.slug,
  };
  if (application.leadValue !== undefined) {
    customData.value = application.leadValue;
    customData.currency = DEFAULT_LEAD_QUALITY_META.currency;
  }
  return { ...customData, ...extra };
}

export function buildMetaConversionEvent(
  config: FunnelConfig,
  application: ApplicationRecord,
  submission: ApplicationSubmission,
  request: RequestMetadata
) {
  return {
    event_name: config.metaTracking.eventName,
    event_time: Math.floor(Date.parse(application.createdAt) / 1000),
    event_id: submission.metaEventId,
    action_source: "website",
    event_source_url: submission.sourceUrl,
    user_data: hashedUserData({
      applicationId: application.id,
      name: submission.contact.name,
      email: submission.contact.email,
      phone: submission.contact.phone,
      clientIp: request.clientIp,
      userAgent: request.userAgent,
      fbp: submission.metaFbp,
      fbc: submission.metaFbc,
    }),
    custom_data: conversionCustomData(config, application),
  };
}

export function buildMetaLeadQualityEvent(
  config: FunnelConfig,
  application: ApplicationRecord,
  quality: LeadQuality,
  eventId: string,
  eventTime: string,
) {
  const value = resolveQualityEventValue(quality, application.leadValue, {
    good: config.metaTracking.qualityGoodValue,
    bad: config.metaTracking.qualityBadValue,
  });
  return {
    event_name: resolveQualityEventName(quality),
    event_time: Math.floor(Date.parse(eventTime) / 1000),
    event_id: eventId,
    action_source: "system_generated",
    user_data: hashedUserData({
      applicationId: application.id,
      name: application.contact.name,
      email: application.contact.email,
      phone: application.contact.phone,
    }),
    custom_data: {
      ...conversionCustomData(config, application, {
        lead_event_source: "adbot",
        event_source: "crm",
        lead_quality: quality,
        value,
        currency: DEFAULT_LEAD_QUALITY_META.currency,
      }),
    },
  };
}

export async function sendMetaApplicationConversion(
  config: FunnelConfig,
  application: ApplicationRecord,
  submission: ApplicationSubmission,
  request: RequestMetadata,
  fetchImpl: typeof fetch = fetch
): Promise<MetaSendResult> {
  if (!config.metaTracking.enabled)
    return { status: "skipped", reason: "tracking_disabled" };
  if (config.metaTracking.conversionTrigger === "doi")
    return { status: "skipped", reason: "awaiting_doi" };
  if (!submission.metaEventId)
    return { status: "skipped", reason: "event_id_missing" };
  const event = buildMetaConversionEvent(config, application, submission, request);
  return deliverMetaCapiEvent({
    funnelId: config.id,
    pixelId: config.metaTracking.pixelId,
    event,
    eventId: submission.metaEventId,
    fetchImpl,
  });
}

export async function sendMetaLeadQualityEvent(
  config: FunnelConfig,
  application: ApplicationRecord,
  quality: LeadQuality,
  eventId: string,
  eventTime: string,
  fetchImpl: typeof fetch = fetch
): Promise<MetaSendResult> {
  if (!config.metaTracking.enabled)
    return { status: "skipped", reason: "tracking_disabled" };
  if (!config.metaTracking.pixelId)
    return { status: "skipped", reason: "pixel_missing" };
  const event = buildMetaLeadQualityEvent(
    config,
    application,
    quality,
    eventId,
    eventTime
  );
  return deliverMetaCapiEvent({
    funnelId: config.id,
    pixelId: config.metaTracking.pixelId,
    event,
    eventId,
    fetchImpl,
  });
}

async function deliverMetaCapiEvent(input: {
  funnelId: string;
  pixelId: string;
  event: Record<string, unknown>;
  eventId?: string;
  fetchImpl: typeof fetch;
}): Promise<MetaSendResult> {
  const owner = await getFunnelOwner(input.funnelId);
  const settings = await getMetaServerSettings(input.funnelId);
  const ownerUserId = owner?.userId?.trim() || "";

  // Customer path: portal holds the Login-for-Business token and posts CAPI.
  // Owned funnels never copy that token into Funnel or fall back to Events Manager.
  if (/^[0-9a-f-]{36}$/i.test(ownerUserId)) {
    return sendViaPortalCapi({
      ownerUserId,
      pixelId: input.pixelId,
      event: input.event,
      testEventCode: settings.testEventCode || undefined,
      fetchImpl: input.fetchImpl,
    });
  }

  if (!settings.accessToken)
    return { status: "skipped", reason: "browser_only" };

  return postMetaCapiEvent({
    pixelId: input.pixelId,
    accessToken: settings.accessToken,
    testEventCode: settings.testEventCode,
    event: input.event,
    eventId: input.eventId,
    fetchImpl: input.fetchImpl,
  });
}

async function postMetaCapiEvent(input: {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
  event: Record<string, unknown>;
  eventId?: string;
  fetchImpl: typeof fetch;
}): Promise<MetaSendResult> {
  const eventPayload = {
    data: [input.event],
    access_token: input.accessToken,
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  };

  let lastFailure: MetaSendResult = {
    status: "failed",
    reason: "Meta CAPI konnte technisch nicht erreicht werden",
    attempts: 0,
  };

  for (let attempt = 0; attempt < CAPI_MAX_ATTEMPTS; attempt++) {
    const delay = CAPI_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const response = await input.fetchImpl(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${input.pixelId}/events`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(eventPayload),
          signal: AbortSignal.timeout(4_000),
        }
      );

      const metaResponse = await readMetaApiResponse(response);
      const logContext = {
        eventId: input.eventId,
        pixelId: input.pixelId,
        httpStatus: response.status,
        eventsReceived: metaResponse.eventsReceived,
        traceId: metaResponse.error?.traceId ?? metaResponse.traceId,
        attempt: attempt + 1,
      };

      if (!response.ok) {
        console.error("[Meta CAPI] Ereignis abgelehnt", {
          ...logContext,
          errorType: metaResponse.error?.type,
          errorCode: metaResponse.error?.code,
          errorSubcode: metaResponse.error?.subcode,
        });

        lastFailure = {
          status: "failed",
          reason: "Meta CAPI hat das Ereignis abgelehnt",
          eventsReceived: metaResponse.eventsReceived,
          attempts: attempt + 1,
        };

        if (
          isRetryableHttpStatus(response.status) &&
          attempt < CAPI_MAX_ATTEMPTS - 1
        ) {
          continue;
        }
        return lastFailure;
      }

      if (!metaResponse.eventsReceived || metaResponse.eventsReceived < 1) {
        console.error("[Meta CAPI] Ereignis nicht bestätigt", logContext);
        // Semantic rejection — do not retry.
        return {
          status: "failed",
          reason: "Meta CAPI hat kein empfangenes Ereignis bestätigt",
          eventsReceived: metaResponse.eventsReceived,
          attempts: attempt + 1,
        };
      }

      console.info("[Meta CAPI] Ereignis bestätigt", logContext);
      return {
        status: "sent",
        eventsReceived: metaResponse.eventsReceived,
        attempts: attempt + 1,
      };
    } catch (error) {
      console.error("[Meta CAPI] Übertragung technisch fehlgeschlagen", {
        eventId: input.eventId,
        pixelId: input.pixelId,
        errorType: error instanceof Error ? error.name : "UnknownError",
        attempt: attempt + 1,
      });
      lastFailure = {
        status: "failed",
        reason: "Meta CAPI konnte technisch nicht erreicht werden",
        attempts: attempt + 1,
      };
    }
  }

  return lastFailure;
}
