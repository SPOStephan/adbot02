import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { defaultFunnel } from "@shared/defaultFunnel";
import { FUNNEL_OPTION_ICONS, FUNNEL_STATUSES } from "@shared/funnel";
import type {
  ApplicationRecord,
  ApplicationStatus,
  ApplicationSubmission,
  ChoicePage,
  FunnelBrand,
  FunnelConfig,
  FunnelOptionIcon,
  FunnelPage,
  FunnelStatus,
  FunnelSummary,
} from "@shared/funnel";
import { decryptMetaSecret, encryptMetaSecret } from "./metaSecrets";

const PAGE_SIZE = 1_000;
const memoryStartedAt = new Date().toISOString();

type StoredMemoryFunnel = {
  config: FunnelConfig;
  createdAt: string;
  updatedAt: string;
};

type WithOptionalEyebrow<T> = T extends FunnelPage ? Omit<T, "eyebrow"> & { eyebrow?: string } : never;
type LegacyFunnelPage = WithOptionalEyebrow<FunnelPage>;
type LegacyFunnelConfig = Omit<FunnelConfig, "status" | "brand" | "legal" | "postSubmit" | "metaTracking" | "pages"> & {
  status?: FunnelStatus;
  brand?: Partial<FunnelBrand>;
  legal?: Partial<FunnelConfig["legal"]>;
  postSubmit?: Partial<FunnelConfig["postSubmit"]>;
  metaTracking?: Partial<FunnelConfig["metaTracking"]>;
  pages: LegacyFunnelPage[];
};

let memoryFunnels: StoredMemoryFunnel[] = [
  { config: structuredClone(defaultFunnel), createdAt: memoryStartedAt, updatedAt: memoryStartedAt },
];
const memoryApplications: ApplicationRecord[] = [];
const memoryMetaServerSettings = new Map<string, MetaServerSettings>();
let client: SupabaseClient | null | undefined;
const funnelOptionIconSet = new Set<string>(FUNNEL_OPTION_ICONS);

export type MetaServerSettings = {
  accessToken?: string;
  testEventCode: string;
};

type StoredServerPrivate = {
  meta?: {
    accessTokenEncrypted?: string;
    testEventCode?: string;
  };
};

function readServerPrivate(config: unknown): StoredServerPrivate {
  if (!config || typeof config !== "object") return {};
  const value = (config as Record<string, unknown>).__serverPrivate;
  return value && typeof value === "object" ? value as StoredServerPrivate : {};
}

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;
  return client;
}

export function isPersistentStoreConfigured() {
  return Boolean(getSupabase());
}

export function slugifyFunnel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "funnel";
}

function normalizeStatus(config: Partial<LegacyFunnelConfig>, published?: boolean): FunnelStatus {
  if (config.status && FUNNEL_STATUSES.includes(config.status)) return config.status;
  return (published ?? config.isPublished) ? "published" : "draft";
}

export function normalizeFunnelConfig(config: LegacyFunnelConfig, published?: boolean): FunnelConfig {
  const { __serverPrivate: _serverPrivate, ...publicConfig } = config as LegacyFunnelConfig & { __serverPrivate?: unknown };
  const status = normalizeStatus(config, published);
  const pages = config.pages.map(page => {
    const normalizedPage = {
      ...page,
      eyebrow: typeof page.eyebrow === "string"
      ? page.eyebrow
      : page.type === "choice-grid" || page.type === "choice-list"
        ? "Kurze Frage"
        : page.type === "contact"
          ? "Fast geschafft"
          : "",
    };
    if (page.type === "choice-grid" || page.type === "choice-list") {
      return {
        ...normalizedPage,
        options: page.options.map(option => ({
          ...option,
          icon: typeof option.icon === "string" && funnelOptionIconSet.has(option.icon) ? option.icon as FunnelOptionIcon : "sparkles",
        })),
      };
    }
    return normalizedPage;
  }) as FunnelPage[];
  return {
    ...publicConfig,
    brand: { ...defaultFunnel.brand, ...(config.brand ?? {}) },
    legal: { ...defaultFunnel.legal, ...(config.legal ?? {}) },
    postSubmit: { ...defaultFunnel.postSubmit, ...(config.postSubmit ?? {}) },
    metaTracking: { ...defaultFunnel.metaTracking, ...(config.metaTracking ?? {}) },
    pages,
    status,
    isPublished: status === "published",
  } as FunnelConfig;
}

function normalizeConfig(row: Record<string, unknown>): FunnelConfig {
  const config = row.config as LegacyFunnelConfig;
  const normalized = normalizeFunnelConfig(config, Boolean(row.is_published));
  return {
    ...normalized,
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    notificationEmail: String(row.notification_email ?? ""),
    allowedEmbedOrigins: (row.allowed_embed_origins as string[]) ?? [],
  };
}

function funnelPayload(config: FunnelConfig, serverPrivate?: StoredServerPrivate) {
  const normalized = normalizeFunnelConfig(config);
  const storedConfig = serverPrivate && Object.keys(serverPrivate).length > 0
    ? { ...normalized, __serverPrivate: serverPrivate }
    : normalized;
  return {
    id: normalized.id,
    slug: normalized.slug,
    title: normalized.title,
    config: storedConfig,
    notification_email: normalized.notificationEmail,
    allowed_embed_origins: normalized.allowedEmbedOrigins,
    is_published: normalized.isPublished,
  };
}

export async function getFunnel(slug: string): Promise<FunnelConfig | null> {
  const supabase = getSupabase();
  if (!supabase) {
    const match = memoryFunnels.find(item => item.config.slug === slug);
    return match ? structuredClone(match.config) : null;
  }

  const { data, error } = await supabase.from("funnels").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? normalizeConfig(data) : null;
}

export async function getFunnelById(id: string): Promise<FunnelConfig | null> {
  const supabase = getSupabase();
  if (!supabase) {
    const match = memoryFunnels.find(item => item.config.id === id);
    return match ? structuredClone(match.config) : null;
  }

  const { data, error } = await supabase.from("funnels").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalizeConfig(data) : null;
}

export async function getOrCreateDefaultFunnel(): Promise<FunnelConfig> {
  const existing = await getFunnel(defaultFunnel.slug);
  if (existing) return existing;
  return createFunnel(defaultFunnel);
}

export async function getUniqueFunnelSlug(value: string, excludeId?: string) {
  const base = slugifyFunnel(value);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await getFunnel(candidate);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base.slice(0, Math.max(1, 120 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }
}

export async function createFunnel(config: FunnelConfig): Promise<FunnelConfig> {
  const normalized = normalizeFunnelConfig(config);
  const supabase = getSupabase();
  if (!supabase) {
    if (memoryFunnels.some(item => item.config.id === normalized.id || item.config.slug === normalized.slug)) {
      throw new Error("Ein Funnel mit dieser ID oder diesem URL-Slug existiert bereits.");
    }
    const now = new Date().toISOString();
    memoryFunnels.unshift({ config: structuredClone(normalized), createdAt: now, updatedAt: now });
    return structuredClone(normalized);
  }

  const { data, error } = await supabase.from("funnels").insert(funnelPayload(normalized)).select("*").single();
  if (error) throw error;
  return normalizeConfig(data);
}

export async function saveFunnel(config: FunnelConfig): Promise<FunnelConfig> {
  const normalized = normalizeFunnelConfig(config);
  const supabase = getSupabase();
  if (!supabase) {
    const duplicateSlug = memoryFunnels.find(item => item.config.slug === normalized.slug && item.config.id !== normalized.id);
    if (duplicateSlug) throw new Error("Dieser URL-Slug wird bereits von einem anderen Funnel verwendet.");
    const existing = memoryFunnels.find(item => item.config.id === normalized.id);
    const now = new Date().toISOString();
    if (existing) {
      existing.config = structuredClone(normalized);
      existing.updatedAt = now;
    } else {
      memoryFunnels.unshift({ config: structuredClone(normalized), createdAt: now, updatedAt: now });
    }
    return structuredClone(normalized);
  }

  const { data: existingRow, error: readError } = await supabase.from("funnels").select("config").eq("id", normalized.id).maybeSingle();
  if (readError) throw readError;
  const serverPrivate = readServerPrivate(existingRow?.config);
  const { data, error } = await supabase
    .from("funnels")
    .upsert(funnelPayload(normalized, serverPrivate), { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return normalizeConfig(data);
}

export async function getMetaServerSettings(funnelId: string): Promise<MetaServerSettings> {
  const supabase = getSupabase();
  if (!supabase) return structuredClone(memoryMetaServerSettings.get(funnelId) ?? { testEventCode: "" });
  const { data, error } = await supabase.from("funnels").select("config").eq("id", funnelId).maybeSingle();
  if (error) throw error;
  const stored = readServerPrivate(data?.config).meta;
  if (!stored) return { testEventCode: "" };
  return {
    accessToken: stored.accessTokenEncrypted ? decryptMetaSecret(stored.accessTokenEncrypted) : undefined,
    testEventCode: stored.testEventCode ?? "",
  };
}

export async function getMetaServerSettingsSummary(funnelId: string) {
  const supabase = getSupabase();
  if (!supabase) {
    const value = memoryMetaServerSettings.get(funnelId);
    return { hasAccessToken: Boolean(value?.accessToken), testEventCode: value?.testEventCode ?? "" };
  }
  const { data, error } = await supabase.from("funnels").select("config").eq("id", funnelId).maybeSingle();
  if (error) throw error;
  const stored = readServerPrivate(data?.config).meta;
  return { hasAccessToken: Boolean(stored?.accessTokenEncrypted), testEventCode: stored?.testEventCode ?? "" };
}

export async function saveMetaServerSettings(
  funnelId: string,
  input: { accessToken?: string; clearAccessToken: boolean; testEventCode: string },
) {
  const supabase = getSupabase();
  if (!supabase) {
    const current = memoryMetaServerSettings.get(funnelId) ?? { testEventCode: "" };
    const accessToken = input.clearAccessToken ? undefined : input.accessToken?.trim() || current.accessToken;
    memoryMetaServerSettings.set(funnelId, { accessToken, testEventCode: input.testEventCode.trim() });
    return { hasAccessToken: Boolean(accessToken), testEventCode: input.testEventCode.trim() };
  }

  const { data, error } = await supabase.from("funnels").select("config").eq("id", funnelId).maybeSingle();
  if (error) throw error;
  if (!data?.config || typeof data.config !== "object") throw new Error("Funnel-Konfiguration nicht gefunden.");
  const rawConfig = data.config as Record<string, unknown>;
  const serverPrivate = readServerPrivate(rawConfig);
  const currentEncrypted = serverPrivate.meta?.accessTokenEncrypted;
  const nextEncrypted = input.clearAccessToken
    ? undefined
    : input.accessToken?.trim()
      ? encryptMetaSecret(input.accessToken.trim())
      : currentEncrypted;
  const nextPrivate: StoredServerPrivate = {
    ...serverPrivate,
    meta: {
      ...(nextEncrypted ? { accessTokenEncrypted: nextEncrypted } : {}),
      testEventCode: input.testEventCode.trim(),
    },
  };
  const { error: updateError } = await supabase
    .from("funnels")
    .update({ config: { ...rawConfig, __serverPrivate: nextPrivate } })
    .eq("id", funnelId);
  if (updateError) throw updateError;
  return { hasAccessToken: Boolean(nextEncrypted), testEventCode: input.testEventCode.trim() };
}

async function readAllFunnelRows(supabase: SupabaseClient) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("funnels")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

async function readAllApplicationCountRows(supabase: SupabaseClient) {
  const rows: Array<{ funnel_id: string; status: ApplicationStatus }> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("applications")
      .select("funnel_id,status")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Array<{ funnel_id: string; status: ApplicationStatus }>));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

export async function listFunnels(): Promise<FunnelSummary[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return memoryFunnels
      .map(item => {
        const applications = memoryApplications.filter(application => application.funnelId === item.config.id);
        return {
          id: item.config.id,
          slug: item.config.slug,
          title: item.config.title,
          status: item.config.status,
          applicationCount: applications.length,
          newApplicationCount: applications.filter(application => application.status === "new").length,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        } satisfies FunnelSummary;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  const [funnelRows, applicationRows] = await Promise.all([
    readAllFunnelRows(supabase),
    readAllApplicationCountRows(supabase),
  ]);
  const counts = new Map<string, { all: number; new: number }>();
  for (const application of applicationRows) {
    const current = counts.get(application.funnel_id) ?? { all: 0, new: 0 };
    current.all += 1;
    if (application.status === "new") current.new += 1;
    counts.set(application.funnel_id, current);
  }
  return funnelRows.map(row => {
    const config = normalizeConfig(row);
    const count = counts.get(config.id) ?? { all: 0, new: 0 };
    return {
      id: config.id,
      slug: config.slug,
      title: config.title,
      status: config.status,
      applicationCount: count.all,
      newApplicationCount: count.new,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    } satisfies FunnelSummary;
  });
}

function regeneratePages(config: FunnelConfig): FunnelConfig["pages"] {
  return config.pages.map(page => {
    const base = { ...structuredClone(page), id: randomUUID() };
    if (base.type !== "choice-grid" && base.type !== "choice-list") return base;
    return {
      ...base,
      questionKey: `question-${randomUUID()}`,
      options: (base as ChoicePage).options.map(option => ({ ...option, id: randomUUID() })),
    };
  });
}

export function createFunnelFromTemplate(template: FunnelConfig, title: string, slug: string): FunnelConfig {
  return normalizeFunnelConfig({
    ...structuredClone(template),
    id: randomUUID(),
    title: title.trim(),
    slug: slugifyFunnel(slug),
    status: "draft",
    isPublished: false,
    pages: regeneratePages(template),
  });
}

export async function createApplication(submission: ApplicationSubmission): Promise<ApplicationRecord> {
  const funnel = await getFunnel(submission.funnelSlug);
  if (!funnel || funnel.status !== "published") throw new Error("Funnel nicht gefunden oder nicht veröffentlicht.");

  const now = new Date().toISOString();
  const record: ApplicationRecord = {
    id: randomUUID(),
    funnelId: funnel.id,
    funnelSlug: funnel.slug,
    status: "new",
    answers: submission.answers,
    contact: submission.contact,
    consentAt: now,
    metaEventId: submission.metaEventId,
    resume: submission.resume,
    sourceUrl: submission.sourceUrl,
    utm: submission.utm ?? {},
    createdAt: now,
  };

  const supabase = getSupabase();
  if (!supabase) {
    memoryApplications.unshift(record);
    return structuredClone(record);
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      id: record.id,
      funnel_id: record.funnelId,
      funnel_slug: record.funnelSlug,
      status: record.status,
      answers: record.answers,
      contact: record.contact,
      consent_at: record.consentAt,
      resume: record.resume ?? null,
      source_url: record.sourceUrl ?? null,
      utm: {
        ...record.utm,
        ...(record.trackingConsentAt ? { __trackingConsentAt: record.trackingConsentAt } : {}),
        ...(record.metaEventId ? { __metaEventId: record.metaEventId } : {}),
      },
      created_at: record.createdAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapApplication(data);
}

function mapApplication(row: Record<string, unknown>): ApplicationRecord {
  const storedUtm = (row.utm as Record<string, string>) ?? {};
  const { __trackingConsentAt, __metaEventId, ...utm } = storedUtm;
  return {
    id: String(row.id),
    funnelId: String(row.funnel_id),
    funnelSlug: String(row.funnel_slug),
    status: row.status as ApplicationStatus,
    answers: row.answers as ApplicationRecord["answers"],
    contact: row.contact as ApplicationRecord["contact"],
    consentAt: String(row.consent_at),
    trackingConsentAt: __trackingConsentAt || undefined,
    metaEventId: __metaEventId || undefined,
    resume: (row.resume as ApplicationRecord["resume"]) ?? undefined,
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    utm,
    createdAt: String(row.created_at),
  };
}

export async function listApplications(funnelId?: string): Promise<ApplicationRecord[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return structuredClone(funnelId ? memoryApplications.filter(item => item.funnelId === funnelId) : memoryApplications);
  }
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const baseQuery = supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = funnelId ? await baseQuery.eq("funnel_id", funnelId) : await baseQuery;
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows.map(mapApplication);
}

export async function getApplication(id: string): Promise<ApplicationRecord | null> {
  const supabase = getSupabase();
  if (!supabase) return structuredClone(memoryApplications.find(item => item.id === id) ?? null);
  const { data, error } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapApplication(data) : null;
}

export async function updateApplicationStatus(id: string, status: ApplicationStatus) {
  const supabase = getSupabase();
  if (!supabase) {
    const item = memoryApplications.find(application => application.id === id);
    if (!item) return null;
    item.status = status;
    return structuredClone(item);
  }
  const { data, error } = await supabase.from("applications").update({ status }).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? mapApplication(data) : null;
}

export function resetMemoryStoreForTests() {
  const now = new Date().toISOString();
  memoryFunnels = [{ config: structuredClone(defaultFunnel), createdAt: now, updatedAt: now }];
  memoryApplications.splice(0, memoryApplications.length);
  memoryMetaServerSettings.clear();
  client = undefined;
}
