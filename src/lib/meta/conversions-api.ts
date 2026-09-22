/**
 * Customer-safe Meta Conversions API helpers.
 * Graph list/send live in connection-capi.ts so this file stays importable
 * from Node tests (no server-only, no token crypto).
 */

export const CAPI_PROBE_CONTENT_NAME = "Adbot CAPI probe";
export const CAPI_PROBE_EVENT_NAME = "Lead";

export type CapiProbeStatus = "untested" | "ok" | "denied" | "error";

export type CapiGraphError = {
  type?: string;
  code?: number;
  subcode?: number;
  traceId?: string;
};

export type CapiGraphResponse = {
  eventsReceived?: number;
  traceId?: string;
  error?: CapiGraphError;
};

export type ConnectionPixel = {
  pixelId: string;
  name: string;
};

export function parseCapiGraphResponse(value: unknown): CapiGraphResponse {
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

export function classifyCapiGraphFailure(input: {
  httpStatus: number;
  code?: number | null;
}): Exclude<CapiProbeStatus, "untested" | "ok"> {
  if (
    input.code === 10 ||
    input.code === 190 ||
    input.code === 200 ||
    input.code === 294
  ) {
    return "denied";
  }
  if (input.httpStatus === 401 || input.httpStatus === 403) return "denied";
  if (input.httpStatus === 400) return "denied";
  return "error";
}

export function connectionCapiCustomerMessage(
  status: CapiProbeStatus,
  extras?: { listedCount?: number },
): string {
  if (status === "ok") {
    return "CAPI über die Meta-Verbindung funktioniert. Lead und Gut/Schlecht gehen über Adbot — ohne Events-Manager-Token.";
  }
  if (status === "denied") {
    return "Die Meta-Verbindung darf dieses Pixel nicht per Conversions API beschreiben. Listing allein reicht nicht: Pixel/Dataset in der Login-for-Business-Konfiguration zuweisen, dann Meta trennen und neu verbinden. Ein Events-Manager-Token ist nicht der Kundenweg.";
  }
  if (status === "untested") {
    if (extras?.listedCount === 0) {
      return "Über die Meta-Verbindung sind keine Pixel sichtbar. In der Login-for-Business-Konfiguration muss das Pixel/Dataset als Asset enthalten sein. Danach Meta trennen und neu verbinden — mit ausdrücklicher Pixel-Auswahl.";
    }
    return "CAPI über die Meta-Verbindung ist noch nicht geprüft.";
  }
  return "Die CAPI-Prüfung über die Meta-Verbindung ist technisch fehlgeschlagen. Bitte später erneut prüfen. Ein Events-Manager-Token ist nicht der Kundenweg.";
}

export function listPixelsEmptyMessage(): string {
  return connectionCapiCustomerMessage("untested", { listedCount: 0 });
}

export function listPixelsDeniedMessage(): string {
  return "Meta hat die Pixel-Liste über die Verbindung abgelehnt. Pixel sind oft ein eigenes Asset (nicht automatisch mit dem Werbekonto). Pixel/Dataset in der Login-for-Business-Konfiguration zuweisen, dann Meta neu verbinden.";
}

export function buildCapiProbeEvent(input: {
  pixelId: string;
  eventId: string;
  eventTime?: number;
}): Record<string, unknown> {
  return {
    event_name: CAPI_PROBE_EVENT_NAME,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "system_generated",
    user_data: {
      external_id: [input.eventId],
    },
    custom_data: {
      content_name: CAPI_PROBE_CONTENT_NAME,
      content_category: "Adbot",
      lead_event_source: "adbot",
      event_source: "capi_probe",
    },
  };
}

export function parseAdAccountPixels(value: unknown): ConnectionPixel[] {
  if (!value || typeof value !== "object") return [];
  const body = value as Record<string, unknown>;
  const rows = Array.isArray(body.data) ? body.data : [];
  const pixels: ConnectionPixel[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const pixelId = String(record.id ?? "").trim();
    if (!/^\d{5,25}$/.test(pixelId)) continue;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim().slice(0, 120)
        : "Meta Pixel";
    pixels.push({ pixelId, name });
  }
  return pixels;
}
