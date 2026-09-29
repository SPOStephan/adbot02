import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Aktennotiz zu einer Bewerbung. Wird nur angehängt, nie geändert. */
export type ApplicationNote = {
  id: string;
  applicationId: string;
  authorEmail: string;
  authorName: string;
  authorLoginMethod: string;
  body: string;
  createdAt: string;
};

export const APPLICATION_NOTE_MAX_LENGTH = 5000;

const COLUMNS = "id,application_id,author_email,author_name,author_login_method,body,created_at";

let memoryNotes: ApplicationNote[] = [];
let client: SupabaseClient | null | undefined;

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false } })
    : null;
  return client;
}

export function resetApplicationNotesMemoryForTests() {
  memoryNotes = [];
  client = undefined;
}

function mapRow(row: Record<string, unknown>): ApplicationNote {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    authorEmail: String(row.author_email),
    authorName: String(row.author_name ?? ""),
    authorLoginMethod: String(row.author_login_method ?? ""),
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

/** Älteste zuerst, damit der Verlauf wie eine Akte von oben nach unten gelesen wird. */
export async function listApplicationNotes(applicationId: string): Promise<ApplicationNote[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return memoryNotes
      .filter(item => item.applicationId === applicationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const { data, error } = await supabase
    .from("application_notes")
    .select(COLUMNS)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

export async function addApplicationNote(input: {
  applicationId: string;
  authorEmail: string;
  authorName: string;
  authorLoginMethod: string;
  body: string;
}): Promise<ApplicationNote> {
  const body = input.body.trim();
  const supabase = getSupabase();
  if (!supabase) {
    const note: ApplicationNote = {
      id: randomUUID(),
      applicationId: input.applicationId,
      authorEmail: input.authorEmail,
      authorName: input.authorName,
      authorLoginMethod: input.authorLoginMethod,
      body,
      createdAt: new Date().toISOString(),
    };
    memoryNotes.push(note);
    return note;
  }
  const { data, error } = await supabase
    .from("application_notes")
    .insert({
      application_id: input.applicationId,
      author_email: input.authorEmail,
      author_name: input.authorName,
      author_login_method: input.authorLoginMethod,
      body,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}
