import "server-only";

import {
  decryptAccessToken,
  encryptAccessToken,
  type EncryptedToken,
} from "@/lib/meta/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

import { readMetaAdLibraryAppConfig } from "./env";
import { MetaAdLibraryError } from "./errors";
import type { MetaAdLibraryProbeResult } from "./types";

type ConnectionRow = {
  id: string;
  app_id: string;
  token_ciphertext: string;
  token_iv: string;
  token_auth_tag: string;
  token_expires_at: string | null;
  meta_user_id: string | null;
  last_probe_at: string | null;
  last_probe_ok: boolean | null;
  last_probe_summary: unknown;
  connected_by: string | null;
};

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /does not exist|meta_ad_library_connections/i.test(error.message ?? "")
  );
}

export async function loadLibraryConnection(): Promise<{
  row: ConnectionRow | null;
  migrationNeeded: boolean;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_ad_library_connections")
    .select(
      "id,app_id,token_ciphertext,token_iv,token_auth_tag,token_expires_at,meta_user_id,last_probe_at,last_probe_ok,last_probe_summary",
    )
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { row: null, migrationNeeded: true };
    throw new MetaAdLibraryError(
      "connection_load_failed",
      500,
      "Library-Verbindung konnte nicht geladen werden.",
    );
  }
  return { row: (data as ConnectionRow | null) ?? null, migrationNeeded: false };
}

export async function resolveLibraryAccessToken(): Promise<{
  accessToken: string;
  source: "env" | "connection";
  expiresAt: string | null;
  migrationNeeded: boolean;
}> {
  const config = readMetaAdLibraryAppConfig();
  const { row, migrationNeeded } = await loadLibraryConnection();
  if (row && config.tokenEncryptionKey && row.app_id === config.appId) {
    const encrypted: EncryptedToken = {
      ciphertext: row.token_ciphertext,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
    };
    return {
      accessToken: decryptAccessToken(encrypted, config.tokenEncryptionKey),
      source: "connection",
      expiresAt: row.token_expires_at,
      migrationNeeded,
    };
  }
  if (config.accessTokenEnv) {
    return {
      accessToken: config.accessTokenEnv,
      source: "env",
      expiresAt: null,
      migrationNeeded,
    };
  }
  throw new MetaAdLibraryError(
    "token_missing",
    409,
    "Kein Library-Token. App verbinden oder META_AD_LIBRARY_ACCESS_TOKEN setzen.",
  );
}

export async function saveLibraryConnection(input: {
  appId: string;
  accessToken: string;
  expiresInSeconds: number | null;
  metaUserId: string | null;
  connectedBy: string | null;
}): Promise<void> {
  const config = readMetaAdLibraryAppConfig();
  if (!config.tokenEncryptionKey) {
    throw new MetaAdLibraryError(
      "encryption_missing",
      409,
      "META_TOKEN_ENCRYPTION_KEY fehlt. Ohne Schlüssel kann der Token nicht gespeichert werden.",
    );
  }
  const encrypted = encryptAccessToken(input.accessToken, config.tokenEncryptionKey);
  const expiresAt =
    input.expiresInSeconds && input.expiresInSeconds > 0
      ? new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
      : null;
  const admin = createAdminClient();
  const { row, migrationNeeded } = await loadLibraryConnection();
  if (migrationNeeded) {
    throw new MetaAdLibraryError(
      "migration_needed",
      503,
      "Bitte zuerst die Migration meta_ad_library_connections ausführen.",
    );
  }
  const payload = {
    app_id: input.appId,
    token_ciphertext: encrypted.ciphertext,
    token_iv: encrypted.iv,
    token_auth_tag: encrypted.authTag,
    token_expires_at: expiresAt,
    meta_user_id: input.metaUserId,
    connected_by: input.connectedBy,
    updated_at: new Date().toISOString(),
  };
  const result = row
    ? await admin.from("meta_ad_library_connections").update(payload).eq("id", row.id)
    : await admin.from("meta_ad_library_connections").insert(payload);
  if (result.error) {
    throw new MetaAdLibraryError(
      "connection_save_failed",
      500,
      result.error.message || "Library-Token konnte nicht gespeichert werden.",
    );
  }
}

export async function clearLibraryConnection(): Promise<void> {
  const { row, migrationNeeded } = await loadLibraryConnection();
  if (migrationNeeded || !row) return;
  const admin = createAdminClient();
  await admin.from("meta_ad_library_connections").delete().eq("id", row.id);
}

export async function saveLibraryProbeSummary(input: {
  ok: boolean;
  summary: MetaAdLibraryProbeResult;
}): Promise<void> {
  const { row, migrationNeeded } = await loadLibraryConnection();
  if (migrationNeeded || !row) return;
  const admin = createAdminClient();
  await admin
    .from("meta_ad_library_connections")
    .update({
      last_probe_at: input.summary.searchedAt,
      last_probe_ok: input.ok,
      last_probe_summary: input.summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

export function probeSummaryFromRow(value: unknown): MetaAdLibraryProbeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as MetaAdLibraryProbeResult;
  if (!row.searchedAt || !Array.isArray(row.ads)) return null;
  return row;
}
