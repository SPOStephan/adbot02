import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";

let client: SupabaseClient | null | undefined;

function getSupabase() {
  if (client !== undefined) return client;
  client =
    ENV.supabaseUrl && ENV.supabaseServiceRoleKey
      ? createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
          auth: { persistSession: false },
        })
      : null;
  return client;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function requireStorage() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error(
      "Storage config missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return supabase;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const supabase = requireStorage();
  const key = appendHashSuffix(normalizeKey(relKey));
  const body =
    typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);

  const { error } = await supabase.storage
    .from(ENV.storageBucket)
    .upload(key, body, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return { key, url: `/api/storage/${key}` };
}

export async function storageGet(
  relKey: string,
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/api/storage/${key}` };
}

export async function storageGetSignedUrl(
  relKey: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const supabase = requireStorage();
  const key = normalizeKey(relKey);
  const { data, error } = await supabase.storage
    .from(ENV.storageBucket)
    .createSignedUrl(key, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Storage signed URL failed: ${error?.message ?? "empty response"}`,
    );
  }

  return data.signedUrl;
}
