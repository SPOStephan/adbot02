import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FunnelMediaAsset } from "@shared/funnel";

type StoredMedia = FunnelMediaAsset & {
  bunnyPathDesktop: string;
  bunnyPathMobile: string;
};

let memoryMedia: StoredMedia[] = [];
let client: SupabaseClient | null | undefined;

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;
  return client;
}

function mapRow(row: Record<string, unknown>): FunnelMediaAsset {
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
    funnelId: String(row.funnel_id ?? ""),
    kind: "hero-background",
    filename: String(row.filename ?? "hintergrund.webp"),
    desktopUrl: String(row.desktop_url ?? ""),
    mobileUrl: String(row.mobile_url ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export function resetFunnelMediaStoreForTests() {
  memoryMedia = [];
  client = undefined;
}

export async function listFunnelMediaAssets(filter: { ownerUserId?: string | null; funnelId: string }): Promise<FunnelMediaAsset[]> {
  const supabase = getSupabase();
  const ownerUserId = filter.ownerUserId?.trim() || null;
  if (!supabase) {
    return memoryMedia
      .filter(item => ownerUserId ? item.ownerUserId === ownerUserId : item.funnelId === filter.funnelId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(({ bunnyPathDesktop: _desktop, bunnyPathMobile: _mobile, ...asset }) => asset);
  }

  let query = supabase.from("funnel_media_assets").select("*").eq("kind", "hero-background").order("created_at", { ascending: false });
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  else query = query.eq("funnel_id", filter.funnelId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

export async function createFunnelMediaAsset(input: {
  ownerUserId: string | null;
  funnelId: string;
  filename: string;
  desktopUrl: string;
  mobileUrl: string;
  bunnyPathDesktop: string;
  bunnyPathMobile: string;
}): Promise<FunnelMediaAsset> {
  const record: StoredMedia = {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    funnelId: input.funnelId,
    kind: "hero-background",
    filename: input.filename,
    desktopUrl: input.desktopUrl,
    mobileUrl: input.mobileUrl,
    createdAt: new Date().toISOString(),
    bunnyPathDesktop: input.bunnyPathDesktop,
    bunnyPathMobile: input.bunnyPathMobile,
  };

  const supabase = getSupabase();
  if (!supabase) {
    memoryMedia.unshift(record);
    const { bunnyPathDesktop: _desktop, bunnyPathMobile: _mobile, ...asset } = record;
    return asset;
  }

  const { data, error } = await supabase
    .from("funnel_media_assets")
    .insert({
      id: record.id,
      owner_user_id: record.ownerUserId,
      funnel_id: record.funnelId,
      kind: record.kind,
      filename: record.filename,
      desktop_url: record.desktopUrl,
      mobile_url: record.mobileUrl,
      bunny_path_desktop: record.bunnyPathDesktop,
      bunny_path_mobile: record.bunnyPathMobile,
    })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return mapRow((data ?? record) as Record<string, unknown>);
}
