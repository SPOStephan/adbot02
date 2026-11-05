import "server-only";

import { randomUUID } from "node:crypto";

import {
  isConnectionCapiLoadError,
  loadConnectionCapiCredentials,
  sendConnectionCapiEvents,
} from "@/lib/meta/connection-capi";
import { buildCapiProbeEvent } from "@/lib/meta/conversions-api";
import {
  CustomerControlServiceError,
  type MetaCustomer,
} from "@/lib/meta/customer-control-service";
import {
  PUBLIC_CAPI_MAX_ACTIVE_KEYS_PER_PIXEL,
  generatePublicCapiKey,
  parsePublicCapiHostnameList,
  parsePublicCapiKeyLabel,
  publicCapiLogRow,
  summarizePublicCapiLog,
  type PublicCapiEventStats,
  type PublicCapiLogStatRow,
} from "@/lib/meta/public-capi";
import { publicCapiEndpointEnabled } from "@/lib/meta/public-capi-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_SITE_URL } from "@/lib/site-urls";

/**
 * Conversions API (erweitert): Verwaltung im Tracking-Bereich
 * (Schalter, Schlüssel, Domains, Statistik, Testereignis).
 * Alle Abfragen sind auf den angemeldeten Kunden beschränkt.
 */

export type PublicCapiKeyView = {
  id: string;
  mode: "live" | "test";
  label: string;
  prefix: string;
  allowedHostnames: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type PublicCapiPixelView = {
  confirmedPixelId: string;
  pixelId: string;
  label: string;
  enabled: boolean;
  keys: PublicCapiKeyView[];
  stats: PublicCapiEventStats[];
};

export type PublicCapiStatus = {
  endpointEnabled: boolean;
  endpointUrl: string;
  docsUrl: string;
  suggestedHostnames: string[];
  pixels: PublicCapiPixelView[];
};

function fail(code: string, status: number, message: string): never {
  throw new CustomerControlServiceError(code, status, message);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    fail("invalid_input", 400, `${field} fehlt oder ist ungültig.`);
  }
  return value;
}

async function ownedConfirmedPixel(customer: MetaCustomer, confirmedPixelId: string) {
  const { data, error } = await createAdminClient()
    .from("meta_confirmed_pixels")
    .select("id,pixel_id,label,platform_account_id,status,revoked_at")
    .eq("id", confirmedPixelId)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .maybeSingle();
  if (error) fail("lookup_failed", 500, "Der Pixel konnte nicht geprüft werden.");
  if (!data || data.status !== "CONFIRMED" || data.revoked_at !== null) {
    fail("pixel_not_confirmed", 409, "Nur bestätigte Pixel können die erweiterte Messung nutzen.");
  }
  return data as { id: string; pixel_id: string; label: string | null; platform_account_id: string };
}

export async function loadPublicCapiStatus(
  customer: MetaCustomer,
  nowMs = Date.now(),
): Promise<PublicCapiStatus> {
  const admin = createAdminClient();
  const [pixelsRes, togglesRes, keysRes, domainsRes, logRes] = await Promise.all([
    admin
      .from("meta_confirmed_pixels")
      .select("id,pixel_id,label")
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .eq("status", "CONFIRMED")
      .is("revoked_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("meta_public_capi_pixels")
      .select("confirmed_pixel_id,enabled")
      .eq("user_id", customer.userId),
    admin
      .from("meta_capi_event_keys")
      .select("id,confirmed_pixel_id,mode,label,key_prefix,allowed_hostnames,created_at,last_used_at")
      .eq("user_id", customer.userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    admin
      .from("allowed_domains")
      .select("hostname")
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .eq("status", "VERIFIED")
      .is("revoked_at", null),
    admin
      .from("meta_conversion_events_log")
      .select("pixel_id,event_name,status,created_at,error_code,error_reason")
      .eq("user_id", customer.userId)
      .gte("created_at", new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (pixelsRes.error || togglesRes.error || keysRes.error || logRes.error) {
    fail("lookup_failed", 500, "Die erweiterte Messung konnte nicht geladen werden.");
  }

  const toggles = new Map(
    (togglesRes.data ?? []).map((row) => [String(row.confirmed_pixel_id), row.enabled === true]),
  );
  const logByPixel = new Map<string, PublicCapiLogStatRow[]>();
  for (const row of logRes.data ?? []) {
    const list = logByPixel.get(String(row.pixel_id)) ?? [];
    list.push(row as PublicCapiLogStatRow);
    logByPixel.set(String(row.pixel_id), list);
  }

  return {
    endpointEnabled: publicCapiEndpointEnabled(),
    endpointUrl: `${APP_SITE_URL}/api/v1/conversions/events`,
    docsUrl: `${APP_SITE_URL}/api-docs/conversions-v1.openapi.json`,
    suggestedHostnames: [
      ...new Set((domainsRes.data ?? []).map((row) => String(row.hostname)).filter(Boolean)),
    ],
    pixels: (pixelsRes.data ?? []).map((pixel) => ({
      confirmedPixelId: String(pixel.id),
      pixelId: String(pixel.pixel_id),
      label: typeof pixel.label === "string" ? pixel.label : "",
      enabled: toggles.get(String(pixel.id)) ?? false,
      keys: (keysRes.data ?? [])
        .filter((key) => key.confirmed_pixel_id === pixel.id)
        .map((key) => ({
          id: String(key.id),
          mode: key.mode === "test" ? "test" : "live",
          label: String(key.label ?? ""),
          prefix: String(key.key_prefix),
          allowedHostnames: Array.isArray(key.allowed_hostnames) ? key.allowed_hostnames : [],
          createdAt: String(key.created_at),
          lastUsedAt: typeof key.last_used_at === "string" ? key.last_used_at : null,
        })),
      stats: summarizePublicCapiLog(logByPixel.get(String(pixel.pixel_id)) ?? [], nowMs),
    })),
  };
}

export async function setPublicCapiEnabled(
  customer: MetaCustomer,
  input: Record<string, unknown>,
) {
  const confirmedPixelId = uuid(input.confirmedPixelId, "Pixel");
  const enabled = input.enabled === true;
  const pixel = await ownedConfirmedPixel(customer, confirmedPixelId);
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("meta_public_capi_pixels")
    .upsert(
      {
        confirmed_pixel_id: pixel.id,
        user_id: customer.userId,
        pixel_id: pixel.pixel_id,
        enabled,
        enabled_at: enabled ? now : null,
        updated_at: now,
      },
      { onConflict: "confirmed_pixel_id" },
    );
  if (error) fail("save_failed", 500, "Der Schalter konnte nicht gespeichert werden.");
  return { enabled };
}

export async function createPublicCapiKey(
  customer: MetaCustomer,
  input: Record<string, unknown>,
) {
  const confirmedPixelId = uuid(input.confirmedPixelId, "Pixel");
  const mode = input.mode === "test" ? "test" : input.mode === "live" ? "live" : null;
  if (!mode) fail("invalid_input", 400, "Bitte Live- oder Test-Schlüssel wählen.");
  const hostnames = parsePublicCapiHostnameList(input.allowedHostnames);
  if (!hostnames.ok) fail("invalid_input", 400, hostnames.message);
  const pixel = await ownedConfirmedPixel(customer, confirmedPixelId);

  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("meta_capi_event_keys")
    .select("id", { count: "exact", head: true })
    .eq("confirmed_pixel_id", pixel.id)
    .eq("user_id", customer.userId)
    .is("revoked_at", null);
  if (countError) fail("lookup_failed", 500, "Die Schlüssel konnten nicht geprüft werden.");
  if ((count ?? 0) >= PUBLIC_CAPI_MAX_ACTIVE_KEYS_PER_PIXEL) {
    fail(
      "too_many_keys",
      409,
      `Höchstens ${PUBLIC_CAPI_MAX_ACTIVE_KEYS_PER_PIXEL} aktive Schlüssel je Pixel. Bitte zuerst einen widerrufen.`,
    );
  }

  const generated = generatePublicCapiKey(mode);
  const { data, error } = await admin
    .from("meta_capi_event_keys")
    .insert({
      confirmed_pixel_id: pixel.id,
      user_id: customer.userId,
      pixel_id: pixel.pixel_id,
      mode,
      label: parsePublicCapiKeyLabel(input.label),
      key_prefix: generated.prefix,
      key_hash: generated.hash,
      allowed_hostnames: hostnames.hostnames,
    })
    .select("id")
    .single();
  if (error || !data) fail("save_failed", 500, "Der Schlüssel konnte nicht erzeugt werden.");
  // Klartext nur in dieser einen Antwort; gespeichert ist nur der Hash.
  return { keyId: String(data.id), key: generated.key, prefix: generated.prefix };
}

export async function revokePublicCapiKey(customer: MetaCustomer, input: Record<string, unknown>) {
  const keyId = uuid(input.keyId, "Schlüssel");
  const { error } = await createAdminClient()
    .from("meta_capi_event_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("user_id", customer.userId)
    .is("revoked_at", null);
  if (error) fail("save_failed", 500, "Der Schlüssel konnte nicht widerrufen werden.");
  return { revoked: true };
}

export async function updatePublicCapiKeyDomains(
  customer: MetaCustomer,
  input: Record<string, unknown>,
) {
  const keyId = uuid(input.keyId, "Schlüssel");
  const hostnames = parsePublicCapiHostnameList(input.allowedHostnames);
  if (!hostnames.ok) fail("invalid_input", 400, hostnames.message);
  const { data, error } = await createAdminClient()
    .from("meta_capi_event_keys")
    .update({ allowed_hostnames: hostnames.hostnames })
    .eq("id", keyId)
    .eq("user_id", customer.userId)
    .is("revoked_at", null)
    .select("id");
  if (error) fail("save_failed", 500, "Die Domains konnten nicht gespeichert werden.");
  if (!data || data.length === 0) fail("not_found", 404, "Schlüssel nicht gefunden.");
  return { allowedHostnames: hostnames.hostnames };
}

/** „Testereignis senden“: ein Lead mit Meta-Testcode über die Verbindung. */
export async function sendPublicCapiTestEvent(
  customer: MetaCustomer,
  input: Record<string, unknown>,
) {
  const confirmedPixelId = uuid(input.confirmedPixelId, "Pixel");
  const testEventCode =
    typeof input.testEventCode === "string" ? input.testEventCode.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(testEventCode)) {
    fail("invalid_input", 400, "Bitte den Testcode aus dem Meta Events Manager eintragen.");
  }
  const pixel = await ownedConfirmedPixel(customer, confirmedPixelId);
  const credentials = await loadConnectionCapiCredentials({
    userId: customer.userId,
    platformAccountId: pixel.platform_account_id,
  });
  if (isConnectionCapiLoadError(credentials)) fail(credentials.error, 409, credentials.message);

  const eventId = randomUUID();
  const sent = await sendConnectionCapiEvents({
    credentials,
    pixelId: pixel.pixel_id,
    events: [buildCapiProbeEvent({ pixelId: pixel.pixel_id, eventId })],
    testEventCode,
  });
  const status = sent.status === "sent" ? "sent" : "meta_error";
  const { error } = await createAdminClient()
    .from("meta_conversion_events_log")
    .insert(
      publicCapiLogRow({
        keyId: null,
        userId: customer.userId,
        pixelId: pixel.pixel_id,
        eventName: "Lead",
        eventId,
        actionSource: "system_generated",
        isTest: true,
        status,
        errorCode: status === "sent" ? null : (sent.errorCode ?? sent.httpStatus ?? null),
        errorReason: status === "sent" ? null : (sent.errorType ?? "meta_rejected"),
        fbtraceId: sent.traceId ?? null,
      }),
    );
  if (error) console.warn("[public-capi] test event log failed");
  if (status !== "sent") {
    fail(
      "meta_error",
      409,
      `Meta hat das Testereignis abgelehnt${sent.errorCode ? ` (Code ${sent.errorCode})` : ""}.`,
    );
  }
  return { sent: true, eventId, fbtraceId: sent.traceId ?? null };
}
