import "server-only";

import {
  isConnectionCapiLoadError,
  loadConnectionCapiCredentials,
  sendConnectionCapiEvents,
} from "@/lib/meta/connection-capi";
import { META_CONVERSION_EVENTS } from "@/lib/meta/conversion-events";
import {
  parsePublicCapiAuthorization,
  parsePublicCapiRequest,
  publicCapiAllowedEventNames,
  publicCapiKeyHashEquals,
  publicCapiLogRow,
  type PublicCapiEventStatus,
  type PublicCapiPreparedEvent,
} from "@/lib/meta/public-capi";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Conversions API (erweitert): Ablauf für POST /api/v1/conversions/events.
 * Schlüssel → Pixel (bestätigt + zugeschaltet) → Meta-Verbindung → Versand
 * über den bestehenden Weg. Personenbezogene Daten werden nur gehasht an
 * Meta weitergereicht und nirgends gespeichert oder geloggt.
 */

export const PUBLIC_CAPI_RATE_LIMIT_PER_MINUTE = 1000;
export const PUBLIC_CAPI_MAX_BODY_BYTES = 1_000_000;
const STALE_PENDING_MS = 10 * 60 * 1000;

/** Doppelter Aus-Schalter, Ebene 1: ohne diese Variable antwortet der Endpunkt 404. */
export function publicCapiEndpointEnabled(): boolean {
  return process.env.ADBOT_PUBLIC_CAPI_ENABLED === "true";
}

export type PublicCapiEventResult = {
  index: number;
  status: PublicCapiEventStatus;
  event_name?: string;
  event_id?: string;
  reason?: string;
  code?: number | string;
  fbtrace_id?: string;
};

export type PublicCapiServiceResponse = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function failure(httpStatus: number, error: string, message: string): PublicCapiServiceResponse {
  return { httpStatus, body: { ok: false, error, message } };
}

type KeyRow = {
  id: string;
  confirmed_pixel_id: string;
  user_id: string;
  pixel_id: string;
  mode: string;
  key_hash: string;
  allowed_hostnames: string[] | null;
};

function eventResult(
  event: PublicCapiPreparedEvent,
  status: PublicCapiEventStatus,
  extra: Partial<PublicCapiEventResult> = {},
): PublicCapiEventResult {
  return {
    index: event.index,
    status,
    ...(event.eventName ? { event_name: event.eventName } : {}),
    ...(event.eventId ? { event_id: event.eventId } : {}),
    ...extra,
  };
}

export async function handlePublicCapiRequest(input: {
  authorization: string | null;
  rawBody: string;
  nowMs?: number;
}): Promise<PublicCapiServiceResponse> {
  const parsedKey = parsePublicCapiAuthorization(input.authorization);
  if (!parsedKey) {
    return failure(401, "unauthorized", "Ereignis-Schlüssel fehlt oder ist ungültig.");
  }

  const admin = createAdminClient();
  const { data: keyData, error: keyError } = await admin
    .from("meta_capi_event_keys")
    .select("id,confirmed_pixel_id,user_id,pixel_id,mode,key_hash,allowed_hostnames")
    .eq("key_hash", parsedKey.hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (keyError) {
    console.error("[public-capi] key lookup failed");
    return failure(503, "temporarily_unavailable", "Bitte später erneut senden.");
  }
  const key = keyData as KeyRow | null;
  if (!key || !publicCapiKeyHashEquals(key.key_hash, parsedKey.hash) || key.mode !== parsedKey.mode) {
    return failure(401, "unauthorized", "Ereignis-Schlüssel fehlt oder ist ungültig.");
  }

  // Doppelter Aus-Schalter, Ebene 2: Pixel bestätigt + Option zugeschaltet.
  const [{ data: toggle }, { data: pixel }] = await Promise.all([
    admin
      .from("meta_public_capi_pixels")
      .select("enabled")
      .eq("confirmed_pixel_id", key.confirmed_pixel_id)
      .eq("user_id", key.user_id)
      .maybeSingle(),
    admin
      .from("meta_confirmed_pixels")
      .select("id,pixel_id,platform_account_id,status,revoked_at,capi_probe_status")
      .eq("id", key.confirmed_pixel_id)
      .eq("user_id", key.user_id)
      .maybeSingle(),
  ]);
  if (
    !toggle ||
    toggle.enabled !== true ||
    !pixel ||
    pixel.status !== "CONFIRMED" ||
    pixel.revoked_at !== null ||
    pixel.pixel_id !== key.pixel_id
  ) {
    return failure(
      403,
      "not_enabled",
      "Die Conversions API (erweitert) ist für diesen Pixel nicht zugeschaltet.",
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return failure(400, "body_invalid", "Der Body muss gültiges JSON sein.");
  }

  const nowMs = input.nowMs ?? Date.now();
  const parsed = parsePublicCapiRequest(body, {
    nowSeconds: Math.floor(nowMs / 1000),
    keyMode: parsedKey.mode,
    allowedEventNames: publicCapiAllowedEventNames(
      META_CONVERSION_EVENTS.map((event) => event.pixelEventName),
    ),
    allowedHostnames: key.allowed_hostnames ?? [],
  });
  if (!parsed.ok) return failure(parsed.httpStatus, parsed.error, parsed.message);

  const { data: withinLimit, error: rateError } = await admin.rpc("meta_capi_rate_limit_hit", {
    p_key_id: key.id,
    p_cost: parsed.events.length,
    p_limit_per_minute: PUBLIC_CAPI_RATE_LIMIT_PER_MINUTE,
  });
  if (rateError) {
    console.error("[public-capi] rate limit check failed");
    return failure(503, "temporarily_unavailable", "Bitte später erneut senden.");
  }
  if (withinLimit !== true) {
    return failure(
      429,
      "rate_limited",
      `Höchstens ${PUBLIC_CAPI_RATE_LIMIT_PER_MINUTE} Ereignisse je Minute und Schlüssel.`,
    );
  }

  const isTest = Boolean(parsed.testEventCode);
  const logBase = (event: PublicCapiPreparedEvent) => ({
    keyId: key.id,
    userId: key.user_id,
    pixelId: key.pixel_id,
    eventName: event.eventName ?? "",
    eventId: event.eventId ?? "",
    actionSource: event.actionSource,
    isTest,
  });

  const results: PublicCapiEventResult[] = [];
  const auditRows: ReturnType<typeof publicCapiLogRow>[] = [];
  const valid: Extract<PublicCapiPreparedEvent, { status: "valid" }>[] = [];

  for (const event of parsed.events) {
    if (event.status === "valid") {
      valid.push(event);
      continue;
    }
    const reason = event.status === "invalid" ? event.reason : undefined;
    results.push(eventResult(event, event.status, reason ? { reason } : {}));
    if (event.eventName && event.eventId) {
      auditRows.push(
        publicCapiLogRow({ ...logBase(event), status: event.status, errorReason: reason }),
      );
    }
  }

  // Idempotenz: je Ereignis einen "pending"-Platz beanspruchen.
  const claimed: { event: (typeof valid)[number]; logId: number }[] = [];
  await Promise.all(
    valid.map(async (event) => {
      const claim = await claimEvent(admin, publicCapiLogRow({ ...logBase(event), status: "pending" }), nowMs);
      if (claim.kind === "claimed") {
        claimed.push({ event, logId: claim.id });
      } else if (claim.kind === "duplicate") {
        results.push(eventResult(event, "duplicate"));
        auditRows.push(publicCapiLogRow({ ...logBase(event), status: "duplicate" }));
      } else {
        results.push(eventResult(event, "meta_error", { reason: "temporarily_unavailable" }));
      }
    }),
  );
  claimed.sort((a, b) => a.event.index - b.event.index);

  if (claimed.length > 0) {
    const credentials = pixel.platform_account_id
      ? await loadConnectionCapiCredentials({
          userId: key.user_id,
          platformAccountId: pixel.platform_account_id,
        })
      : null;

    if (!credentials || isConnectionCapiLoadError(credentials)) {
      const reason = credentials && isConnectionCapiLoadError(credentials) ? credentials.error : "meta_not_connected";
      await finishClaims(admin, claimed.map((c) => c.logId), { status: "meta_error", error_reason: reason });
      for (const { event } of claimed) results.push(eventResult(event, "meta_error", { reason }));
    } else {
      const sent = await sendConnectionCapiEvents({
        credentials,
        pixelId: key.pixel_id,
        events: claimed.map((c) => c.event.metaEvent),
        testEventCode: parsed.testEventCode,
      });
      const status = sent.status === "sent" ? "sent" : "meta_error";
      const code = sent.errorCode ?? sent.httpStatus;
      await finishClaims(admin, claimed.map((c) => c.logId), {
        status,
        error_code: status === "sent" || code === undefined ? null : String(code).slice(0, 40),
        error_reason: status === "sent" ? null : (sent.errorType ?? "meta_rejected").slice(0, 300),
        fbtrace_id: sent.traceId ? sent.traceId.slice(0, 80) : null,
      });
      for (const { event } of claimed) {
        results.push(
          eventResult(event, status, {
            ...(status === "meta_error" && code !== undefined ? { code } : {}),
            ...(sent.traceId ? { fbtrace_id: sent.traceId } : {}),
          }),
        );
      }
      // Erfolgreicher Versand belegt CAPI-Zugriff über die Verbindung.
      if (status === "sent" && pixel.capi_probe_status !== "ok") {
        const nowIso = new Date(nowMs).toISOString();
        const { error } = await admin
          .from("meta_confirmed_pixels")
          .update({
            capi_via_connection: true,
            capi_probe_status: "ok",
            capi_probe_at: nowIso,
            capi_probe_code: null,
            capi_probe_detail: null,
            updated_at: nowIso,
          })
          .eq("id", pixel.id)
          .eq("user_id", key.user_id);
        if (error) console.warn("[public-capi] CAPI-Status nicht gespeichert");
      }
    }
  }

  if (auditRows.length > 0) {
    const { error } = await admin.from("meta_conversion_events_log").insert(auditRows);
    if (error) console.warn("[public-capi] audit log insert failed");
  }
  await admin
    .from("meta_capi_event_keys")
    .update({ last_used_at: new Date(nowMs).toISOString() })
    .eq("id", key.id);

  results.sort((a, b) => a.index - b.index);
  const counts: Record<string, number> = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return {
    httpStatus: 200,
    body: {
      ok: true,
      test: isTest,
      counts,
      events: results,
    },
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;
type ClaimResult = { kind: "claimed"; id: number } | { kind: "duplicate" } | { kind: "error" };

async function claimEvent(
  admin: AdminClient,
  row: ReturnType<typeof publicCapiLogRow>,
  nowMs: number,
  retry = true,
): Promise<ClaimResult> {
  const { data, error } = await admin
    .from("meta_conversion_events_log")
    .insert(row)
    .select("id")
    .single();
  if (!error && data) return { kind: "claimed", id: Number(data.id) };
  if (error?.code !== "23505") return { kind: "error" };

  // Ein "pending" ohne Abschluss (z. B. abgebrochene Anfrage) gibt den Platz
  // nach 10 Minuten wieder frei; "sent" bleibt dauerhaft ein Duplikat.
  const { data: existing } = await admin
    .from("meta_conversion_events_log")
    .select("id,status,created_at")
    .eq("pixel_id", row.pixel_id)
    .eq("event_id", row.event_id)
    .eq("event_name", row.event_name)
    .eq("is_test", row.is_test)
    .in("status", ["pending", "sent"])
    .maybeSingle();
  if (
    retry &&
    existing?.status === "pending" &&
    nowMs - Date.parse(String(existing.created_at)) > STALE_PENDING_MS
  ) {
    await admin
      .from("meta_conversion_events_log")
      .update({ status: "meta_error", error_reason: "stale_pending", updated_at: new Date(nowMs).toISOString() })
      .eq("id", existing.id)
      .eq("status", "pending");
    return claimEvent(admin, row, nowMs, false);
  }
  return { kind: "duplicate" };
}

async function finishClaims(
  admin: AdminClient,
  ids: number[],
  patch: {
    status: "sent" | "meta_error";
    error_code?: string | null;
    error_reason?: string | null;
    fbtrace_id?: string | null;
  },
) {
  if (ids.length === 0) return;
  const { error } = await admin
    .from("meta_conversion_events_log")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending");
  if (error) console.warn("[public-capi] log update failed");
}
