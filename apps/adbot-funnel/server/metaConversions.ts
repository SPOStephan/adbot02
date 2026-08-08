import { createHash } from "node:crypto";
import type {
  ApplicationRecord,
  ApplicationSubmission,
  FunnelConfig,
} from "@shared/funnel";
import { getMetaServerSettings } from "./funnelStore";

const META_GRAPH_API_VERSION = "v25.0";

type RequestMetadata = { clientIp?: string; userAgent?: string };
export type MetaSendResult = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  eventsReceived?: number;
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

export function buildMetaConversionEvent(
  config: FunnelConfig,
  application: ApplicationRecord,
  submission: ApplicationSubmission,
  request: RequestMetadata
) {
  const fullName = submission.contact.name?.trim().toLowerCase() ?? "";
  const firstName = fullName.split(/\s+/)[0];
  const userData = {
    em: normalizedHash(submission.contact.email, value =>
      value.trim().toLowerCase()
    ),
    ph: normalizedHash(submission.contact.phone, value =>
      value.replace(/\D/g, "")
    ),
    fn: firstName ? [sha256(firstName)] : undefined,
    external_id: [sha256(application.id)],
    client_ip_address: request.clientIp,
    client_user_agent: request.userAgent,
    fbp: submission.metaFbp,
    fbc: submission.metaFbc,
  };
  return {
    event_name: config.metaTracking.eventName,
    event_time: Math.floor(Date.parse(application.createdAt) / 1000),
    event_id: submission.metaEventId,
    action_source: "website",
    event_source_url: submission.sourceUrl,
    user_data: Object.fromEntries(
      Object.entries(userData).filter(([, value]) => value !== undefined)
    ),
    custom_data: {
      content_category: "Recruiting",
      content_name: config.title,
      funnel_slug: config.slug,
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
  if (!submission.metaEventId)
    return { status: "skipped", reason: "event_id_missing" };
  const settings = await getMetaServerSettings(config.id);
  if (!settings.accessToken)
    return { status: "skipped", reason: "browser_only" };

  try {
    const response = await fetchImpl(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${config.metaTracking.pixelId}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: [
            buildMetaConversionEvent(config, application, submission, request),
          ],
          access_token: settings.accessToken,
          ...(settings.testEventCode
            ? { test_event_code: settings.testEventCode }
            : {}),
        }),
        signal: AbortSignal.timeout(4_000),
      }
    );

    const metaResponse = await readMetaApiResponse(response);
    const logContext = {
      eventId: submission.metaEventId,
      pixelId: config.metaTracking.pixelId,
      httpStatus: response.status,
      eventsReceived: metaResponse.eventsReceived,
      traceId: metaResponse.error?.traceId ?? metaResponse.traceId,
    };

    if (!response.ok) {
      console.error("[Meta CAPI] Ereignis abgelehnt", {
        ...logContext,
        errorType: metaResponse.error?.type,
        errorCode: metaResponse.error?.code,
        errorSubcode: metaResponse.error?.subcode,
      });

      return {
        status: "failed",
        reason: "Meta CAPI hat das Ereignis abgelehnt",
        eventsReceived: metaResponse.eventsReceived,
      };
    }

    if (!metaResponse.eventsReceived || metaResponse.eventsReceived < 1) {
      console.error("[Meta CAPI] Ereignis nicht bestätigt", logContext);
      return {
        status: "failed",
        reason: "Meta CAPI hat kein empfangenes Ereignis bestätigt",
        eventsReceived: metaResponse.eventsReceived,
      };
    }

    console.info("[Meta CAPI] Ereignis bestätigt", logContext);
    return { status: "sent", eventsReceived: metaResponse.eventsReceived };
  } catch (error) {
    console.error("[Meta CAPI] Übertragung technisch fehlgeschlagen", {
      eventId: submission.metaEventId,
      pixelId: config.metaTracking.pixelId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: "failed",
      reason: "Meta CAPI konnte technisch nicht erreicht werden",
    };
  }
}
