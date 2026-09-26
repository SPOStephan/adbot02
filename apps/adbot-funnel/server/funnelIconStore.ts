import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FunnelLibraryIcon } from "@shared/funnelIconCatalog";
import { isCustomFunnelIconId } from "@shared/funnelIconCatalog";
import { placeholderFunnelIconSvg, sanitizeFunnelIconSvg } from "@shared/funnelIconSvg";

let memoryIcons: FunnelLibraryIcon[] = [];
let client: SupabaseClient | null | undefined;

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;
  return client;
}

export function resetFunnelIconStoreForTests() {
  memoryIcons = [];
  client = undefined;
}

function slugLabel(label: string): string {
  return label
    .toLocaleLowerCase("de")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "icon";
}

function mapRow(row: Record<string, unknown>): FunnelLibraryIcon {
  return {
    id: String(row.id),
    label: String(row.label ?? "Icon"),
    svg: String(row.svg ?? ""),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(item => String(item)) : [],
    status: row.status === "requested" ? "requested" : "ready",
    requestNote: String(row.request_note ?? ""),
  };
}

export async function listFunnelLibraryIcons(): Promise<FunnelLibraryIcon[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return [...memoryIcons].sort((left, right) => left.label.localeCompare(right.label, "de"));
  }
  const { data, error } = await supabase.from("funnel_library_icons").select("*").order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

export async function requestFunnelLibraryIcon(input: {
  label: string;
  requestNote: string;
  svg?: string;
  aliases?: string[];
}): Promise<FunnelLibraryIcon> {
  const label = input.label.trim().slice(0, 80);
  if (label.length < 2) throw new Error("Bitte einen Namen für das Icon angeben.");
  const svg = input.svg?.trim()
    ? sanitizeFunnelIconSvg(input.svg)
    : placeholderFunnelIconSvg(label);
  if (!svg) throw new Error("Das SVG konnte nicht übernommen werden. Nur einfache Pfade und Formen.");
  const id = `adbot-custom-${slugLabel(label)}-${randomUUID().slice(0, 8)}`;
  if (!isCustomFunnelIconId(id)) throw new Error("Die Icon-ID ist ungültig.");
  const record: FunnelLibraryIcon = {
    id,
    label,
    svg,
    aliases: (input.aliases ?? []).map(item => item.trim()).filter(Boolean).slice(0, 8),
    status: input.svg?.trim() ? "ready" : "requested",
    requestNote: input.requestNote.trim().slice(0, 400),
  };

  const supabase = getSupabase();
  if (!supabase) {
    memoryIcons = [...memoryIcons, record];
    return record;
  }
  const { data, error } = await supabase
    .from("funnel_library_icons")
    .insert({
      id: record.id,
      label: record.label,
      svg: record.svg,
      aliases: record.aliases,
      status: record.status,
      request_note: record.requestNote,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Das Icon konnte nicht gespeichert werden.");
  return mapRow(data as Record<string, unknown>);
}

export async function fulfillFunnelLibraryIcon(input: {
  id: string;
  svg: string;
}): Promise<FunnelLibraryIcon> {
  const svg = sanitizeFunnelIconSvg(input.svg);
  if (!svg) throw new Error("Das SVG konnte nicht übernommen werden.");
  const supabase = getSupabase();
  if (!supabase) {
    const index = memoryIcons.findIndex(icon => icon.id === input.id);
    if (index === -1) throw new Error("Icon nicht gefunden.");
    memoryIcons[index] = { ...memoryIcons[index], svg, status: "ready" };
    return memoryIcons[index];
  }
  const { data, error } = await supabase
    .from("funnel_library_icons")
    .update({ svg, status: "ready" })
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Das Icon konnte nicht aktualisiert werden.");
  return mapRow(data as Record<string, unknown>);
}
