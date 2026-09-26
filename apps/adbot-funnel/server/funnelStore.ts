import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { defaultFunnel } from "@shared/defaultFunnel";
import { FUNNEL_STATUSES } from "@shared/funnel";
import { isSelectableFunnelIcon } from "@shared/funnelIconCatalog";
import { sanitizeFormattedText } from "@shared/formattedText";
import type {
  ApplicationRecord,
  ApplicationStatus,
  ApplicationSubmission,
  ChoicePage,
  FunnelBrand,
  FunnelConfig,
  FunnelOwner,
  FunnelPage,
  FunnelStatus,
  FunnelSummary,
  LeadQuality,
  StartBadge,
  StartBenefit,
  StartPage,
} from "@shared/funnel";
import { defaultProgressIcon, normalizeProgress } from "@shared/progressLayout";
import { clampHeroBackgroundFocusX, clampHeroBackgroundOpacity, clampHeroImageRadius, MAX_START_BADGES, MAX_START_BENEFIT_TEXT, resolveBenefitsTileGap, resolveBenefitsTileLayout, resolveHeroImageLayout, resolveStartLayout } from "@shared/startLayout";
import { computeApplicationLeadValue, parseLeadValue } from "@shared/leadValue";
import { decryptMetaSecret, encryptMetaSecret } from "./metaSecrets";
import { resetFunnelMediaStoreForTests } from "./funnelMediaStore";

const PAGE_SIZE = 1_000;
const memoryStartedAt = new Date().toISOString();

type StoredMemoryFunnel = {
  config: FunnelConfig;
  owner: FunnelOwner;
  createdAt: string;
  updatedAt: string;
};

type WithOptionalEyebrow<T> = T extends FunnelPage ? Omit<T, "eyebrow" | "progressTitle" | "progressHint" | "progressIcon"> & {
  eyebrow?: string;
  progressTitle?: string;
  progressHint?: string;
  progressIcon?: string;
} : never;
type LegacyFunnelPage = WithOptionalEyebrow<FunnelPage>;
type LegacyFunnelConfig = Omit<FunnelConfig, "status" | "brand" | "legal" | "postSubmit" | "metaTracking" | "progress" | "pages"> & {
  status?: FunnelStatus;
  brand?: Partial<FunnelBrand>;
  legal?: Partial<FunnelConfig["legal"]>;
  postSubmit?: Partial<FunnelConfig["postSubmit"]>;
  metaTracking?: Partial<FunnelConfig["metaTracking"]>;
  progress?: Partial<FunnelConfig["progress"]> & { colors?: Partial<FunnelConfig["progress"]["colors"]> };
  pages: LegacyFunnelPage[];
};

const emptyOwner = (): FunnelOwner => ({ userId: null, email: null });

function normalizeOwner(owner?: Partial<FunnelOwner> | null): FunnelOwner {
  return {
    userId: owner?.userId?.trim() || null,
    email: owner?.email?.trim() || null,
  };
}

let memoryFunnels: StoredMemoryFunnel[] = [
  {
    config: structuredClone(defaultFunnel),
    owner: emptyOwner(),
    createdAt: memoryStartedAt,
    updatedAt: memoryStartedAt,
  },
];
const memoryApplications: ApplicationRecord[] = [];
const memoryMetaServerSettings = new Map<string, MetaServerSettings>();
let client: SupabaseClient | null | undefined;
function resolveStoredIcon(value: unknown): string {
  return typeof value === "string" && isSelectableFunnelIcon(value) ? value : "sparkles";
}

function resolveFormatted(value: unknown, fallback = ""): string {
  return typeof value === "string" ? sanitizeFormattedText(value) : fallback;
}

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
    const progressIcon = resolveStoredIcon(page.progressIcon || defaultProgressIcon(page.type));
    const normalizedPage = {
      ...page,
      hidden: page.type !== "start" && page.type !== "contact" && page.hidden === true,
      eyebrowVisible: page.eyebrowVisible !== false,
      titleVisible: page.titleVisible !== false,
      subtitleVisible: page.subtitleVisible !== false,
      descriptionVisible: page.descriptionVisible !== false,
      title: resolveFormatted(page.title, page.name || "Seite"),
      subtitle: resolveFormatted(page.subtitle),
      description: resolveFormatted(page.description),
      eyebrow: typeof page.eyebrow === "string"
      ? resolveFormatted(page.eyebrow)
      : page.type === "choice-grid" || page.type === "choice-list"
        ? "Kurze Frage"
        : page.type === "contact"
          ? "Fast geschafft"
          : "",
      progressTitle: typeof page.progressTitle === "string" ? page.progressTitle.slice(0, 80) : "",
      progressHint: typeof page.progressHint === "string" ? page.progressHint.slice(0, 160) : "",
      progressIcon,
    };
    if (page.type === "choice-grid" || page.type === "choice-list") {
      return {
        ...normalizedPage,
        options: page.options.map(option => ({
          ...option,
          icon: resolveStoredIcon(option.icon),
          label: resolveFormatted(option.label, "Option"),
          description: option.description ? resolveFormatted(option.description) : option.description,
          leadValue: parseLeadValue(option.leadValue),
        })),
      };
    }
    if (page.type === "start") {
      const startPage = page as StartPage & {
        layout?: string;
        benefits?: StartBenefit[];
        benefitsTileLayout?: string;
        benefitsTileGap?: string;
        benefitsSectionBackground?: string;
        benefitsCardBackground?: string;
        heroImageLayout?: string;
        heroImageRadius?: number;
        badges?: StartBadge[];
        benefitsBandTitle?: string;
        secondaryButtonLabel?: string;
      };
      const optionalHex = (value: unknown) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
      return {
        ...normalizedPage,
        layout: resolveStartLayout(startPage),
        benefitsBandTitle: typeof startPage.benefitsBandTitle === "string" ? startPage.benefitsBandTitle : "",
        secondaryButtonLabel: typeof startPage.secondaryButtonLabel === "string" ? startPage.secondaryButtonLabel : "",
        heroBackgroundAssetId: typeof startPage.heroBackgroundAssetId === "string" ? startPage.heroBackgroundAssetId : "",
        heroBackgroundDesktopUrl: typeof startPage.heroBackgroundDesktopUrl === "string" ? startPage.heroBackgroundDesktopUrl : "",
        heroBackgroundMobileUrl: typeof startPage.heroBackgroundMobileUrl === "string" ? startPage.heroBackgroundMobileUrl : "",
        heroBackgroundOpacity: clampHeroBackgroundOpacity(startPage.heroBackgroundOpacity),
        heroBackgroundFocusX: clampHeroBackgroundFocusX(startPage.heroBackgroundFocusX),
        heroImageLayout: resolveHeroImageLayout(startPage.heroImageLayout),
        heroImageRadius: clampHeroImageRadius(startPage.heroImageRadius),
        benefitsTileLayout: resolveBenefitsTileLayout(startPage.benefitsTileLayout),
        benefitsTileGap: resolveBenefitsTileGap(startPage.benefitsTileGap),
        benefitsSectionBackground: optionalHex(startPage.benefitsSectionBackground) || "",
        benefitsCardBackground: optionalHex(startPage.benefitsCardBackground) || "",
        badges: Array.isArray(startPage.badges)
          ? startPage.badges.slice(0, MAX_START_BADGES).map(badge => ({
            id: badge.id || randomUUID(),
            label: String(badge.label ?? "").trim().slice(0, 80) || "Badge",
            backgroundColor: optionalHex(badge.backgroundColor),
            textColor: optionalHex(badge.textColor),
          }))
          : [],
        benefits: Array.isArray(startPage.benefits)
          ? startPage.benefits.slice(0, 12).map(benefit => ({
            id: benefit.id || randomUUID(),
            icon: resolveStoredIcon(benefit.icon),
            title: resolveFormatted(benefit.title, "Vorteil").slice(0, 480) || "Vorteil",
            text: resolveFormatted(benefit.text).slice(0, MAX_START_BENEFIT_TEXT * 4),
            color: optionalHex(benefit.color),
          }))
          : [],
      };
    }
    return normalizedPage;
  }) as FunnelPage[];
  return {
    ...publicConfig,
    brand: { ...defaultFunnel.brand, ...(config.brand ?? {}) },
    progress: normalizeProgress(config.progress),
    legal: { ...defaultFunnel.legal, ...(config.legal ?? {}) },
    postSubmit: { ...defaultFunnel.postSubmit, ...(config.postSubmit ?? {}) },
    metaTracking: {
      ...defaultFunnel.metaTracking,
      ...(config.metaTracking ?? {}),
      qualityGoodValue: parseLeadValue(config.metaTracking?.qualityGoodValue),
      qualityBadValue: parseLeadValue(config.metaTracking?.qualityBadValue),
    },
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

export async function createFunnel(config: FunnelConfig, owner?: Partial<FunnelOwner> | null): Promise<FunnelConfig> {
  const normalized = normalizeFunnelConfig(config);
  const nextOwner = normalizeOwner(owner);
  const supabase = getSupabase();
  if (!supabase) {
    if (memoryFunnels.some(item => item.config.id === normalized.id || item.config.slug === normalized.slug)) {
      throw new Error("Ein Funnel mit dieser ID oder diesem URL-Slug existiert bereits.");
    }
    const now = new Date().toISOString();
    memoryFunnels.unshift({
      config: structuredClone(normalized),
      owner: nextOwner,
      createdAt: now,
      updatedAt: now,
    });
    return structuredClone(normalized);
  }

  const { data, error } = await supabase
    .from("funnels")
    .insert({
      ...funnelPayload(normalized),
      owner_user_id: nextOwner.userId,
      owner_email: nextOwner.email,
    })
    .select("*")
    .single();
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
      memoryFunnels.unshift({
        config: structuredClone(normalized),
        owner: emptyOwner(),
        createdAt: now,
        updatedAt: now,
      });
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

function toFunnelSummary(
  config: FunnelConfig,
  owner: FunnelOwner,
  createdAt: string,
  updatedAt: string,
  applicationCount: number,
  newApplicationCount: number,
): FunnelSummary {
  return {
    id: config.id,
    slug: config.slug,
    title: config.title,
    status: config.status,
    applicationCount,
    newApplicationCount,
    ownerUserId: owner.userId,
    ownerEmail: owner.email,
    createdAt,
    updatedAt,
  };
}

function ownerFromRow(row: Record<string, unknown>): FunnelOwner {
  return normalizeOwner({
    userId: row.owner_user_id ? String(row.owner_user_id) : null,
    email: row.owner_email ? String(row.owner_email) : null,
  });
}

export async function listFunnels(filter?: { ownerUserId?: string }): Promise<FunnelSummary[]> {
  const ownerFilter = filter?.ownerUserId?.trim() || undefined;
  const supabase = getSupabase();
  if (!supabase) {
    return memoryFunnels
      .filter(item => !ownerFilter || item.owner.userId === ownerFilter)
      .map(item => {
        const applications = memoryApplications.filter(application => application.funnelId === item.config.id);
        return toFunnelSummary(
          item.config,
          item.owner,
          item.createdAt,
          item.updatedAt,
          applications.length,
          applications.filter(application => application.status === "new").length,
        );
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
  return funnelRows
    .map(row => {
      const config = normalizeConfig(row);
      const owner = ownerFromRow(row);
      const count = counts.get(config.id) ?? { all: 0, new: 0 };
      return toFunnelSummary(config, owner, String(row.created_at), String(row.updated_at), count.all, count.new);
    })
    .filter(summary => !ownerFilter || summary.ownerUserId === ownerFilter);
}

export async function getFunnelOwner(funnelId: string): Promise<FunnelOwner | null> {
  const supabase = getSupabase();
  if (!supabase) {
    const existing = memoryFunnels.find(item => item.config.id === funnelId);
    return existing ? { ...existing.owner } : null;
  }
  const { data, error } = await supabase
    .from("funnels")
    .select("owner_user_id,owner_email")
    .eq("id", funnelId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return ownerFromRow(data as Record<string, unknown>);
}

export async function setFunnelOwner(funnelId: string, owner: Partial<FunnelOwner> | null): Promise<FunnelSummary | null> {
  const nextOwner = normalizeOwner(owner);
  const supabase = getSupabase();
  if (!supabase) {
    const existing = memoryFunnels.find(item => item.config.id === funnelId);
    if (!existing) return null;
    existing.owner = nextOwner;
    existing.updatedAt = new Date().toISOString();
    const applications = memoryApplications.filter(application => application.funnelId === funnelId);
    return toFunnelSummary(
      existing.config,
      existing.owner,
      existing.createdAt,
      existing.updatedAt,
      applications.length,
      applications.filter(application => application.status === "new").length,
    );
  }

  const { data, error } = await supabase
    .from("funnels")
    .update({
      owner_user_id: nextOwner.userId,
      owner_email: nextOwner.email,
    })
    .eq("id", funnelId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const config = normalizeConfig(data as Record<string, unknown>);
  const counts = await readAllApplicationCountRows(supabase);
  const forFunnel = counts.filter(row => row.funnel_id === funnelId);
  return toFunnelSummary(
    config,
    ownerFromRow(data as Record<string, unknown>),
    String((data as Record<string, unknown>).created_at),
    String((data as Record<string, unknown>).updated_at),
    forFunnel.length,
    forFunnel.filter(row => row.status === "new").length,
  );
}

function regeneratePages(config: FunnelConfig): FunnelConfig["pages"] {
  return config.pages.map(page => {
    const base = { ...structuredClone(page), id: randomUUID() };
    if (base.type === "start") {
      return {
        ...base,
        benefits: (base.benefits ?? []).map(benefit => ({ ...benefit, id: randomUUID() })),
        badges: (base.badges ?? []).map(badge => ({ ...badge, id: randomUUID() })),
      };
    }
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
  const leadValue = computeApplicationLeadValue(funnel, submission.answers);
  const record: ApplicationRecord = {
    id: randomUUID(),
    funnelId: funnel.id,
    funnelSlug: funnel.slug,
    status: "new",
    answers: submission.answers,
    contact: submission.contact,
    consentAt: now,
    metaEventId: submission.metaEventId,
    leadValue,
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
      utm: encodeApplicationSidecar(record),
      created_at: record.createdAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapApplication(data);
}

const APPLICATION_SIDECAR_KEYS = [
  "__trackingConsentAt",
  "__metaEventId",
  "__leadValue",
  "__leadQuality",
  "__leadQualityAt",
  "__leadQualityEventId",
  "__leadQualityMetaStatus",
] as const;

type ApplicationSidecar = Partial<Record<(typeof APPLICATION_SIDECAR_KEYS)[number], string>>;

function encodeApplicationSidecar(record: ApplicationRecord): Record<string, string> {
  return {
    ...record.utm,
    ...(record.trackingConsentAt ? { __trackingConsentAt: record.trackingConsentAt } : {}),
    ...(record.metaEventId ? { __metaEventId: record.metaEventId } : {}),
    ...(record.leadValue !== undefined ? { __leadValue: String(record.leadValue) } : {}),
    ...(record.leadQuality ? { __leadQuality: record.leadQuality } : {}),
    ...(record.leadQualityAt ? { __leadQualityAt: record.leadQualityAt } : {}),
    ...(record.leadQualityEventId ? { __leadQualityEventId: record.leadQualityEventId } : {}),
    ...(record.leadQualityMetaStatus
      ? { __leadQualityMetaStatus: record.leadQualityMetaStatus }
      : {}),
  };
}

function decodeApplicationSidecar(stored: Record<string, string>): {
  sidecar: ApplicationSidecar;
  utm: Record<string, string>;
} {
  const sidecar: ApplicationSidecar = {};
  const utm: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if ((APPLICATION_SIDECAR_KEYS as readonly string[]).includes(key)) {
      sidecar[key as keyof ApplicationSidecar] = value;
    } else {
      utm[key] = value;
    }
  }
  return { sidecar, utm };
}

function mapApplication(row: Record<string, unknown>): ApplicationRecord {
  const storedUtm = (row.utm as Record<string, string>) ?? {};
  const { sidecar, utm } = decodeApplicationSidecar(storedUtm);
  const leadQuality =
    sidecar.__leadQuality === "good" || sidecar.__leadQuality === "bad"
      ? sidecar.__leadQuality
      : undefined;
  return {
    id: String(row.id),
    funnelId: String(row.funnel_id),
    funnelSlug: String(row.funnel_slug),
    status: row.status as ApplicationStatus,
    answers: row.answers as ApplicationRecord["answers"],
    contact: row.contact as ApplicationRecord["contact"],
    consentAt: String(row.consent_at),
    trackingConsentAt: sidecar.__trackingConsentAt || undefined,
    metaEventId: sidecar.__metaEventId || undefined,
    leadValue: parseLeadValue(sidecar.__leadValue),
    leadQuality,
    leadQualityAt: sidecar.__leadQualityAt || undefined,
    leadQualityEventId: sidecar.__leadQualityEventId || undefined,
    leadQualityMetaStatus: sidecar.__leadQualityMetaStatus || undefined,
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

export async function updateApplicationLeadQuality(
  id: string,
  input: {
    quality: LeadQuality;
    eventId: string;
    metaStatus: string;
    ratedAt: string;
  },
) {
  const patch = {
    leadQuality: input.quality,
    leadQualityAt: input.ratedAt,
    leadQualityEventId: input.eventId,
    leadQualityMetaStatus: input.metaStatus,
  };

  const supabase = getSupabase();
  if (!supabase) {
    const item = memoryApplications.find(application => application.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    return structuredClone(item);
  }

  const existing = await getApplication(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  const { data, error } = await supabase
    .from("applications")
    .update({ utm: encodeApplicationSidecar(next) })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? mapApplication(data) : null;
}

export function resetMemoryStoreForTests() {
  const now = new Date().toISOString();
  memoryFunnels = [{
    config: structuredClone(defaultFunnel),
    owner: emptyOwner(),
    createdAt: now,
    updatedAt: now,
  }];
  memoryApplications.splice(0, memoryApplications.length);
  memoryMetaServerSettings.clear();
  client = undefined;
  resetFunnelMediaStoreForTests();
}
