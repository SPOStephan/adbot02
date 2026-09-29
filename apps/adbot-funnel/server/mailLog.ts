import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../drizzle/schema";

export type MailLogStatus = "sent" | "failed" | "skipped";

export type MailLogEntry = {
  id: string;
  kind: string;
  funnelId: string | null;
  funnelTitle: string;
  applicationId: string | null;
  recipients: string[];
  sender: string;
  subject: string;
  status: MailLogStatus;
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
};

export type MailLogInput = Omit<MailLogEntry, "id" | "createdAt">;

/** Nur diese Konten sehen das Versandprotokoll (kommagetrennt überschreibbar per MAIL_LOG_VIEWER_EMAILS). */
const DEFAULT_MAIL_LOG_VIEWER_EMAILS = "adbot@boncred.info";

const COLUMNS = "id,kind,funnel_id,funnel_title,application_id,recipients,sender,subject,status,provider_message_id,error,created_at";

let memoryLog: MailLogEntry[] = [];
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

export function resetMailLogMemoryForTests() {
  memoryLog = [];
  client = undefined;
}

export function mailLogViewerEmails(raw = process.env.MAIL_LOG_VIEWER_EMAILS): string[] {
  return (raw?.trim() ? raw : DEFAULT_MAIL_LOG_VIEWER_EMAILS)
    .split(/[,;\s]+/)
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

/** Funnel-only-Mitglieder sind ausgeschlossen, auch wenn ihre Adresse zufällig passt. */
export function canViewMailLog(user: Pick<User, "email" | "loginMethod"> | null | undefined): boolean {
  if (!user?.email || user.loginMethod === "member") return false;
  return mailLogViewerEmails().includes(user.email.trim().toLowerCase());
}

function mapRow(row: Record<string, unknown>): MailLogEntry {
  return {
    id: String(row.id),
    kind: String(row.kind ?? ""),
    funnelId: row.funnel_id == null ? null : String(row.funnel_id),
    funnelTitle: String(row.funnel_title ?? ""),
    applicationId: row.application_id == null ? null : String(row.application_id),
    recipients: Array.isArray(row.recipients) ? row.recipients.map(String) : [],
    sender: String(row.sender ?? ""),
    subject: String(row.subject ?? ""),
    status: String(row.status) as MailLogStatus,
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
  };
}

/** Protokolliert einen Versandversuch. Wirft nie: ein Protokollfehler darf den Versand nicht stören. */
export async function recordMailLog(input: MailLogInput): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      memoryLog.unshift({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
      return;
    }
    const { error } = await supabase.from("funnel_mail_log").insert({
      kind: input.kind,
      funnel_id: input.funnelId,
      funnel_title: input.funnelTitle,
      application_id: input.applicationId,
      recipients: input.recipients,
      sender: input.sender,
      subject: input.subject,
      status: input.status,
      provider_message_id: input.providerMessageId,
      error: input.error,
    });
    if (error) throw error;
  } catch (error) {
    console.error("[mail-log] Versandprotokoll konnte nicht geschrieben werden", error);
  }
}

export async function listMailLog(options: { limit?: number } = {}): Promise<MailLogEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const supabase = getSupabase();
  if (!supabase) return structuredClone(memoryLog.slice(0, limit));
  const { data, error } = await supabase
    .from("funnel_mail_log")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}
