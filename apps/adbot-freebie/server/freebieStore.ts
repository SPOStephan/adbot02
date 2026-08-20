import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfirmationMode,
  FreebieLead,
  FreebieLeadStatus,
  FreebieMetaTracking,
  FreebieOffer,
  MediaAsset,
} from "../shared/types";
import { defaultFreebieMetaTracking } from "../shared/types";
import { ENV } from "./_core/env";
import { buildCdnUrl, uploadToBunny } from "./bunny";

let client: SupabaseClient | null | undefined;

const memoryOffers = new Map<string, FreebieOffer>();
const memoryAssets = new Map<string, MediaAsset>();
const memoryLeads = new Map<string, FreebieLead>();

function getSupabase() {
  if (client !== undefined) return client;
  const url = ENV.supabaseUrl;
  const serviceKey = ENV.supabaseServiceRoleKey;
  client = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;
  return client;
}

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `offer-${randomUUID().slice(0, 8)}`;
}

function mapMetaTracking(row: Record<string, unknown>): FreebieMetaTracking {
  const pixelId = String(row.meta_pixel_id ?? "").trim();
  const eventName = String(row.meta_event_name ?? "").trim() || "Lead";
  return {
    enabled: Boolean(row.meta_tracking_enabled),
    pixelId: /^\d{5,25}$/.test(pixelId) ? pixelId : "",
    eventName: /^[A-Za-z][A-Za-z0-9_]*$/.test(eventName) ? eventName : "Lead",
  };
}

function mapOffer(row: Record<string, unknown>): FreebieOffer {
  return {
    id: String(row.id),
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    ownerEmail: (row.owner_email as string | null) ?? null,
    slug: String(row.slug),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    confirmationMode: (row.confirmation_mode as ConfirmationMode) ?? "doi",
    mediaAssetId: (row.media_asset_id as string | null) ?? null,
    isPublished: Boolean(row.is_published),
    metaTracking: mapMetaTracking(row),
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
}

function mapAsset(row: Record<string, unknown>): MediaAsset {
  return {
    id: String(row.id),
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    filename: String(row.filename ?? ""),
    contentType: String(row.content_type ?? "application/octet-stream"),
    byteSize: Number(row.byte_size ?? 0),
    bunnyPath: String(row.bunny_path ?? ""),
    cdnUrl: (row.cdn_url as string | null) ?? null,
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
}

function mapLead(row: Record<string, unknown>): FreebieLead {
  return {
    id: String(row.id),
    offerId: String(row.offer_id),
    email: String(row.email ?? "").toLowerCase(),
    status: (row.status as FreebieLeadStatus) ?? "pending",
    confirmationMode: (row.confirmation_mode as ConfirmationMode) ?? "doi",
    doiTokenHash: (row.doi_token_hash as string | null) ?? null,
    otpHash: (row.otp_hash as string | null) ?? null,
    otpExpiresAt: (row.otp_expires_at as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    deliveredAt: (row.delivered_at as string | null) ?? null,
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
}

export async function listOffers(ownerUserId: string | null): Promise<FreebieOffer[]> {
  const supabase = getSupabase();
  if (!supabase) {
    const all = Array.from(memoryOffers.values());
    if (!ownerUserId) return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return all
      .filter(offer => offer.ownerUserId === ownerUserId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  let query = supabase.from("freebie_offers").select("*").order("updated_at", { ascending: false });
  if (ownerUserId) query = query.eq("owner_user_id", ownerUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(row => mapOffer(row as Record<string, unknown>));
}

export async function getOfferById(id: string): Promise<FreebieOffer | null> {
  const supabase = getSupabase();
  if (!supabase) return memoryOffers.get(id) ?? null;
  const { data, error } = await supabase.from("freebie_offers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapOffer(data as Record<string, unknown>) : null;
}

export async function getPublishedOfferBySlug(slug: string): Promise<FreebieOffer | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      Array.from(memoryOffers.values()).find(
        offer => offer.slug === slug && offer.isPublished,
      ) ?? null
    );
  }
  const { data, error } = await supabase
    .from("freebie_offers")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (error) throw error;
  return data ? mapOffer(data as Record<string, unknown>) : null;
}

export async function upsertOffer(input: {
  id?: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  title: string;
  description: string;
  confirmationMode: ConfirmationMode;
  slug?: string;
  mediaAssetId?: string | null;
  isPublished?: boolean;
  metaTracking?: FreebieMetaTracking;
}): Promise<FreebieOffer> {
  const id = input.id ?? randomUUID();
  const stamp = nowIso();
  const existing = input.id ? await getOfferById(input.id) : null;
  const slug = slugify(input.slug?.trim() || existing?.slug || input.title);
  const metaTracking = {
    ...defaultFreebieMetaTracking,
    ...(existing?.metaTracking ?? {}),
    ...(input.metaTracking ?? {}),
  };

  const offer: FreebieOffer = {
    id,
    ownerUserId: existing?.ownerUserId ?? input.ownerUserId,
    ownerEmail: input.ownerEmail ?? existing?.ownerEmail ?? null,
    slug,
    title: input.title.trim(),
    description: input.description.trim(),
    confirmationMode: input.confirmationMode,
    mediaAssetId:
      input.mediaAssetId !== undefined
        ? input.mediaAssetId
        : (existing?.mediaAssetId ?? null),
    isPublished: input.isPublished ?? existing?.isPublished ?? false,
    metaTracking,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };

  const supabase = getSupabase();
  if (!supabase) {
    memoryOffers.set(id, offer);
    return offer;
  }

  const { data, error } = await supabase
    .from("freebie_offers")
    .upsert(
      {
        id: offer.id,
        owner_user_id: offer.ownerUserId,
        owner_email: offer.ownerEmail,
        slug: offer.slug,
        title: offer.title,
        description: offer.description,
        confirmation_mode: offer.confirmationMode,
        media_asset_id: offer.mediaAssetId,
        is_published: offer.isPublished,
        meta_tracking_enabled: offer.metaTracking.enabled,
        meta_pixel_id: offer.metaTracking.pixelId,
        meta_event_name: offer.metaTracking.eventName,
        created_at: offer.createdAt,
        updated_at: offer.updatedAt,
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return mapOffer(data as Record<string, unknown>);
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const supabase = getSupabase();
  if (!supabase) return memoryAssets.get(id) ?? null;
  const { data, error } = await supabase.from("media_assets").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapAsset(data as Record<string, unknown>) : null;
}

export async function createMediaAssetFromUpload(input: {
  ownerUserId: string | null;
  filename: string;
  contentType: string;
  dataBase64: string;
}): Promise<MediaAsset> {
  const uploaded = await uploadToBunny(input);
  const stamp = nowIso();
  const asset: MediaAsset = {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
    filename: input.filename,
    contentType: input.contentType || "application/octet-stream",
    byteSize: uploaded.byteSize,
    bunnyPath: uploaded.bunnyPath,
    cdnUrl: uploaded.cdnUrl ?? buildCdnUrl(uploaded.bunnyPath),
    createdAt: stamp,
    updatedAt: stamp,
  };

  const supabase = getSupabase();
  if (!supabase) {
    memoryAssets.set(asset.id, asset);
    return asset;
  }

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      id: asset.id,
      owner_user_id: asset.ownerUserId,
      filename: asset.filename,
      content_type: asset.contentType,
      byte_size: asset.byteSize,
      bunny_path: asset.bunnyPath,
      cdn_url: asset.cdnUrl,
      created_at: asset.createdAt,
      updated_at: asset.updatedAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapAsset(data as Record<string, unknown>);
}

export async function listLeadsForOffer(offerId: string): Promise<FreebieLead[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return Array.from(memoryLeads.values())
      .filter(lead => lead.offerId === offerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await supabase
    .from("freebie_leads")
    .select("*")
    .eq("offer_id", offerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => mapLead(row as Record<string, unknown>));
}

export async function createPendingLead(input: {
  offer: FreebieOffer;
  email: string;
}): Promise<{ lead: FreebieLead; doiToken?: string; otp?: string }> {
  const email = input.email.trim().toLowerCase();
  const stamp = nowIso();
  const doiToken =
    input.offer.confirmationMode === "doi"
      ? randomBytes(32).toString("base64url")
      : undefined;
  const otp =
    input.offer.confirmationMode === "otp"
      ? String(Math.floor(100000 + Math.random() * 900000))
      : undefined;

  const lead: FreebieLead = {
    id: randomUUID(),
    offerId: input.offer.id,
    email,
    status: "pending",
    confirmationMode: input.offer.confirmationMode,
    doiTokenHash: doiToken ? hashToken(doiToken) : null,
    otpHash: otp ? hashToken(otp) : null,
    otpExpiresAt: otp ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
    confirmedAt: null,
    deliveredAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  const supabase = getSupabase();
  if (!supabase) {
    memoryLeads.set(lead.id, lead);
    return { lead, doiToken, otp };
  }

  const { data, error } = await supabase
    .from("freebie_leads")
    .insert({
      id: lead.id,
      offer_id: lead.offerId,
      email: lead.email,
      status: lead.status,
      confirmation_mode: lead.confirmationMode,
      doi_token_hash: lead.doiTokenHash,
      otp_hash: lead.otpHash,
      otp_expires_at: lead.otpExpiresAt,
      confirmed_at: null,
      delivered_at: null,
      created_at: lead.createdAt,
      updated_at: lead.updatedAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return { lead: mapLead(data as Record<string, unknown>), doiToken, otp };
}

export async function confirmLeadByDoiToken(token: string): Promise<FreebieLead | null> {
  const tokenHash = hashToken(token);
  const supabase = getSupabase();
  if (!supabase) {
    const lead = Array.from(memoryLeads.values()).find(
      item => item.doiTokenHash === tokenHash && item.status === "pending",
    );
    if (!lead) return null;
    const updated = {
      ...lead,
      status: "confirmed" as const,
      confirmedAt: nowIso(),
      updatedAt: nowIso(),
    };
    memoryLeads.set(updated.id, updated);
    return updated;
  }

  const { data, error } = await supabase
    .from("freebie_leads")
    .select("*")
    .eq("doi_token_hash", tokenHash)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const stamp = nowIso();
  const { data: updated, error: updateError } = await supabase
    .from("freebie_leads")
    .update({ status: "confirmed", confirmed_at: stamp, updated_at: stamp })
    .eq("id", data.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return mapLead(updated as Record<string, unknown>);
}

export async function confirmLeadByOtp(input: {
  leadId: string;
  otp: string;
}): Promise<FreebieLead | null> {
  const otpHash = hashToken(input.otp.trim());
  const supabase = getSupabase();
  if (!supabase) {
    const lead = memoryLeads.get(input.leadId);
    if (!lead || lead.status !== "pending" || lead.otpHash !== otpHash) return null;
    if (lead.otpExpiresAt && Date.parse(lead.otpExpiresAt) < Date.now()) {
      const expired = { ...lead, status: "expired" as const, updatedAt: nowIso() };
      memoryLeads.set(lead.id, expired);
      return null;
    }
    const updated = {
      ...lead,
      status: "confirmed" as const,
      confirmedAt: nowIso(),
      updatedAt: nowIso(),
    };
    memoryLeads.set(updated.id, updated);
    return updated;
  }

  const { data, error } = await supabase
    .from("freebie_leads")
    .select("*")
    .eq("id", input.leadId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const lead = mapLead(data as Record<string, unknown>);
  if (lead.otpHash !== otpHash) return null;
  if (lead.otpExpiresAt && Date.parse(lead.otpExpiresAt) < Date.now()) {
    await supabase
      .from("freebie_leads")
      .update({ status: "expired", updated_at: nowIso() })
      .eq("id", lead.id);
    return null;
  }

  const stamp = nowIso();
  const { data: updated, error: updateError } = await supabase
    .from("freebie_leads")
    .update({ status: "confirmed", confirmed_at: stamp, updated_at: stamp })
    .eq("id", lead.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return mapLead(updated as Record<string, unknown>);
}

export async function markLeadDelivered(leadId: string): Promise<FreebieLead | null> {
  const stamp = nowIso();
  const supabase = getSupabase();
  if (!supabase) {
    const lead = memoryLeads.get(leadId);
    if (!lead) return null;
    const updated = {
      ...lead,
      status: "delivered" as const,
      deliveredAt: stamp,
      updatedAt: stamp,
    };
    memoryLeads.set(leadId, updated);
    return updated;
  }

  const { data, error } = await supabase
    .from("freebie_leads")
    .update({ status: "delivered", delivered_at: stamp, updated_at: stamp })
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;
  return mapLead(data as Record<string, unknown>);
}

export async function resolveDownloadUrl(offer: FreebieOffer): Promise<string | null> {
  if (!offer.mediaAssetId) return null;
  const asset = await getMediaAsset(offer.mediaAssetId);
  if (!asset) return null;
  return asset.cdnUrl ?? buildCdnUrl(asset.bunnyPath);
}
