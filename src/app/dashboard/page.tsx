import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarClock,
  CalendarDays,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  HelpCircle,
  ImageIcon,
  LayoutDashboard,
  Megaphone,
  MousePointerClick,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  WalletCards,
} from "lucide-react";

import {
  AutomationControlCenter,
  type AutomationAuditView,
  type AutomationPolicyView,
  type BrandProfileView,
  type KillSwitchView,
} from "@/components/AutomationControlCenter";
import type {
  AllowedDomainView,
  AutomationOnboardingData,
  ObjectiveBlueprintView,
  ReadyBrandAssetView,
  RecentLaunchPlanView,
  SyncedCreativeView,
} from "@/components/AutomationOnboardingControls";
import type { BudgetCanaryPlanView } from "@/components/AutomationBudgetCanaryManager";
import type { AutomationScopeCampaignView } from "@/components/AutomationScopeManager";
import type { BoostSettingsView } from "@/components/AutomationBoostSettings";
import {
  ContentCandidateBoostControls,
  type ContentBoostOverrideView,
  type HeldOrganicBoostPlanView,
} from "@/components/ContentCandidateBoostControls";
import { ContentCandidatePreview } from "@/components/ContentCandidatePreview";
import { MetaCampaignOverview } from "@/components/MetaCampaignOverview";
import { MetaSyncButton } from "@/components/MetaSyncButton";
import { PerformanceChart } from "@/components/PerformanceChart";
import { PlatformStatusCard } from "@/components/PlatformStatusCard";
import { SignOutButton } from "@/components/SignOutButton";
import { getPlatformCatalog } from "@/lib/platforms/catalog";
import { resolveCustomerNextSyncAt } from "@/lib/meta/schedule";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const navigation = [
  { label: "Übersicht", icon: LayoutDashboard, active: true },
  { label: "Kampagnen", icon: Megaphone },
  { label: "Creatives", icon: ImageIcon },
  { label: "Zielgruppen", icon: Target },
  { label: "Autonomie", icon: ShieldCheck },
];

type DashboardPageProps = {
  searchParams: Promise<{
    meta?: string | string[];
    meta_error?: string | string[];
    meta_missing_scopes?: string | string[];
    meta_unexpected_scopes?: string | string[];
    meta_callback_stage?: string | string[];
  }>;
};

type MetaNotice = {
  tone: "success" | "error";
  title: string;
  message: string;
};

const META_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Die Meta-Verbindung wurde abgebrochen. Es wurden keine Änderungen gespeichert.",
  provider: "Meta konnte die Autorisierung nicht abschließen. Bitte versuche es erneut.",
  configuration: "Der Meta-Connector ist noch nicht vollständig konfiguriert.",
  missing_response: "Meta hat keine vollständige Antwort zurückgegeben. Bitte starte die Verbindung erneut.",
  invalid_state: "Die Sicherheitsprüfung ist abgelaufen oder ungültig. Bitte starte die Verbindung erneut.",
  scope_validation: "Die von Meta gewährten Berechtigungen entsprechen nicht dem minimalen sicheren Zugriff. Bitte bestätige den Reconnect vollständig.",
  token_validation: "Die Meta-Verbindung konnte nicht sicher bestätigt werden. Bitte verbinde Meta erneut.",
  authorization_reset: "Die bisherige Meta-Autorisierung konnte nicht vollständig entfernt werden. Es wurden keine alten Assets übernommen. Bitte starte den Reconnect erneut.",
  no_assets: "Meta hat die Verbindung bestätigt, aber Adbot konnte die zugewiesenen Assets nicht lesen. Bitte trenne Meta vollständig und verbinde erneut.",
  assigned_assets_invalid_parameter: "Meta hat die Asset-Zuweisung abgelehnt (Graph-Parameter). Bitte trenne Meta vollständig und verbinde erneut — Adbot liest die Zuweisungen jetzt ohne zusätzliche Query-Parameter.",
  missing_page_targets: "Meta hat keine Facebook-Seiten-IDs aus der Dialog-Auswahl geliefert. Bitte trenne Meta vollständig und verbinde erneut mit ausdrücklicher Seitenauswahl.",
  missing_ad_account_targets: "Meta hat keine Werbekonto-IDs aus der Dialog-Auswahl geliefert. Bitte trenne Meta vollständig und verbinde erneut mit ausdrücklicher Werbekonto-Auswahl.",
  missing_instagram_targets: "Meta hat keine Instagram-IDs aus der Dialog-Auswahl geliefert. Bitte trenne Meta vollständig und verbinde erneut mit ausdrücklicher Instagram-Auswahl.",
  storage: "Die Verbindung konnte nicht sicher gespeichert werden. Es wurde keine Verbindung aktiviert.",
  callback: "Die Meta-Antwort konnte nicht verarbeitet werden. Bitte starte die Verbindung erneut.",
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const META_CALLBACK_STAGE_MESSAGES: Record<string, string> = {
  environment: "Umgebungskonfiguration",
  state_validation: "Sicherheitsstatus",
  code_exchange: "Code-Austausch",
  long_lived_token_exchange: "Token-Verlängerung",
  token_debug: "Token-Prüfung",
  identity: "Identitätsprüfung",
  scope_validation: "Berechtigungsprüfung",
  asset_discovery: "Asset-Ermittlung",
  token_encryption: "Token-Verschlüsselung",
  storage: "Speichern",
  revalidation: "Aktualisierung",
};

function getMetaNotice(
  meta: string | undefined,
  errorReason: string | undefined,
  metaConnected: boolean,
  writeScopeGranted: boolean,
  missingScopes?: string,
  unexpectedScopes?: string,
  callbackStage?: string,
): MetaNotice | null {
  if (meta === "connected") {
    return {
      tone: "success",
      title: "Meta wurde erfolgreich verbunden.",
      message: metaConnected
        ? writeScopeGranted
          ? "Der minimale Meta-Schreibscope wurde bestätigt. Ausführung bleibt bis zu Kunden-Policy, EUR-Caps, Readiness-Gates und ausdrücklichem ALLOW fail-closed."
          : "Der Connector ist verbunden, aber der minimale Schreibscope fehlt. Bitte führe den sicheren Reconnect aus."
        : "Die Meta-Berechtigungen wurden bestätigt. Die verbundenen Kontodaten werden gerade aktualisiert.",
    };
  }

  if (meta === "error" || errorReason) {
    let message =
      META_ERROR_MESSAGES[errorReason ?? ""] ??
      "Die Verbindung wurde nicht abgeschlossen. Bitte starte den Vorgang erneut.";

    if (errorReason === "scope_validation") {
      const parts: string[] = [];
      if (missingScopes) {
        parts.push(`Es fehlen: ${missingScopes}`);
      }
      if (unexpectedScopes) {
        parts.push(`Unerlaubt/zusätzlich: ${unexpectedScopes}`);
      }
      if (parts.length) {
        message = `${message} ${parts.join(". ")}. Erlaubt sind nur: ads_read, ads_management, instagram_basic, pages_read_engagement, pages_show_list.`;
      }
    }

    if (errorReason === "callback" && callbackStage) {
      const stageLabel =
        META_CALLBACK_STAGE_MESSAGES[callbackStage] ?? callbackStage;
      message = `${message} Schritt: ${stageLabel}.`;
    }

    return {
      tone: "error",
      title: "Meta konnte nicht verbunden werden.",
      message,
    };
  }

  return null;
}

const SYNC_STATUS = {
  idle: {
    label: "Bereit für den ersten Abruf",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    description: "Die Verbindung steht. Der sichere Ausgangsbestand kann jetzt eingelesen werden.",
  },
  reconnected: {
    label: "Wieder verbunden",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    description: "Die Verbindung wurde erneuert. Der gespeicherte Ausgangsbestand bleibt erhalten.",
  },
  syncing: {
    label: "Abruf läuft",
    className: "bg-blue-50 text-blue-700 ring-blue-200",
    description: "Facebook- und Instagram-Beiträge werden gerade abgeglichen.",
  },
  success: {
    label: "Aktuell",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    description: "Der letzte Abruf wurde vollständig abgeschlossen.",
  },
  partial: {
    label: "Teilweise aktualisiert",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description: "Mindestens eine Quelle war kurzzeitig nicht erreichbar.",
  },
  error: {
    label: "Abruf wird wiederholt",
    className: "bg-red-50 text-red-700 ring-red-200",
    description: "Der automatische Abruf versucht es nach einer sicheren Pause erneut.",
  },
  rate_limited: {
    label: "Meta-Pause aktiv",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    description: "Der Abruf pausiert automatisch, um Meta-Nutzungslimits einzuhalten.",
  },
  reconnect_required: {
    label: "Verbindung erneuern",
    className: "bg-red-50 text-red-700 ring-red-200",
    description: "Der Lesezugriff ist abgelaufen oder wurde von Meta widerrufen.",
  },
} as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Noch nicht ausgeführt";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Zeitpunkt nicht verfügbar";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value: number | null, currency: string) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInteger(value: number | null) {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `${new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2,
  }).format(value)} %`;
}

function normalizeKillSwitchMode(
  value: unknown,
): NonNullable<KillSwitchView>["mode"] {
  return value === "ALLOW" ||
    value === "FREEZE_WRITES" ||
    value === "PAUSE_MANAGED"
    ? value
    : "FREEZE_WRITES";
}

function sumAvailableMetric(
  rows: readonly Record<string, unknown>[],
  key: string,
) {
  let hasValue = false;
  let total = 0;

  for (const row of rows) {
    const value = toFiniteNumber(row[key]);

    if (value !== null) {
      hasValue = true;
      total += value;
    }
  }

  return hasValue ? total : null;
}

const platformVisuals = {
  meta: {
    accentClass: "bg-blue-50 text-blue-600",
    icon: Megaphone,
  },
  google: {
    accentClass: "bg-emerald-50 text-emerald-600",
    icon: Search,
  },
  tiktok: {
    accentClass: "bg-slate-100 text-slate-800",
    icon: Play,
  },
  pinterest: {
    accentClass: "bg-red-50 text-red-600",
    icon: Pin,
  },
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const renderedAt = new Date();
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: connectedAccounts, error: connectedAccountsError } = await supabase
    .from("platform_accounts")
    .select(
      "id, platform, account_name, connected_at, revoked_at, meta_scopes, sync_status, sync_error_code, last_sync_started_at, last_synced_at, next_sync_at, baseline_completed_at, last_sync_seen_count, last_sync_new_count, marketing_currency, marketing_sync_status, marketing_sync_error_code, marketing_sync_id, marketing_last_success_at, marketing_campaign_count, marketing_ad_set_count, marketing_ad_count, marketing_creative_count, marketing_insight_count, marketing_recommendation_count, marketing_insights_since, marketing_insights_until, instagram_account_ids",
    )
    .eq("user_id", user.id)
    .is("revoked_at", null);
  const platformAccountReadFailed = Boolean(connectedAccountsError);

  const platforms = getPlatformCatalog().map((platform) => {
    const account = connectedAccounts?.find(
      (item) => item.platform === platform.id && !item.revoked_at,
    );

    const isMeta = platform.id === "meta";
    const metaWriteScopeGranted =
      isMeta &&
      Array.isArray(account?.meta_scopes) &&
      account.meta_scopes.includes("ads_management");

    return {
      id: platform.id,
      name: platform.name,
      description: platform.description,
      status: platformAccountReadFailed && isMeta
        ? "Verbindungsstatus vorübergehend nicht verfügbar"
        : account
          ? isMeta
            ? "Verbunden"
            : account.account_name
              ? `Verbunden: ${account.account_name}`
              : "Verbunden"
          : platform.configured
            ? "Bereit zur Verbindung"
            : "API-Zugang noch nicht hinterlegt",
      connected: Boolean(account),
      badge:
        isMeta && platform.configured
          ? platformAccountReadFailed
            ? "Lesestatus prüfen"
            : metaWriteScopeGranted
              ? "Minimaler Schreibscope bestätigt"
              : "Reconnect für Autonomie"
          : undefined,
      helperText: isMeta
        ? platformAccountReadFailed
          ? "Die vorhandene Verbindung konnte nicht gelesen werden und bleibt unverändert. Bitte keinen Reconnect starten."
          : metaWriteScopeGranted
            ? "Liest Werbedaten und erlaubt ausschließlich policy-gedeckte Budget-, Status- und Active-Launch-Schritte. Keine Messaging- oder Beitrags-Publishing-Rechte."
            : "Liest Kampagnen, Insights sowie Seiten- und Instagram-Beiträge. Wähle im Meta-Dialog das Business-Portfolio, die Facebook-Seite, das Werbekonto und das Instagram-Konto jeweils ausdrücklich aus. Schreibvorgänge bleiben bis zum expliziten Scope-Reconnect blockiert."
        : undefined,
      actionHref:
        isMeta && platform.configured && !account && !platformAccountReadFailed
          ? "/api/connectors/meta/start"
          : undefined,
      actionLabel:
        isMeta && platform.configured && !account && !platformAccountReadFailed
          ? "Meta verbinden"
          : undefined,
      showMetaConnectionActions:
        isMeta && platform.configured && Boolean(account) && !platformAccountReadFailed,
      ...platformVisuals[platform.id],
    };
  });

  const hasConnectedPlatform = platforms.some((platform) => platform.connected);
  const metaAccount = connectedAccounts?.find(
    (account) => account.platform === "meta" && !account.revoked_at,
  );
  const metaConnected = Boolean(metaAccount?.connected_at);
  const customerNextSyncAt = resolveCustomerNextSyncAt(
    metaAccount?.next_sync_at,
    renderedAt,
  );
  const writeScopeGranted =
    Array.isArray(metaAccount?.meta_scopes) &&
    metaAccount.meta_scopes.includes("ads_management");
  const [
    { data: metaAssets },
    { data: contentCandidates },
    { count: storedCandidateCount },
  ] = metaConnected && metaAccount
    ? await Promise.all([
          supabase
            .from("meta_assets")
            .select("id, asset_type, meta_asset_id, name, username, last_synced_at")
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .order("asset_type", { ascending: true }),
          supabase
            .from("meta_content_candidates")
            .select(
              "id, source, content_type, caption_excerpt, permalink_url, preview_url, published_at, first_seen_at",
            )
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .eq("is_new", true)
            .order("published_at", { ascending: false, nullsFirst: false })
            .limit(8),
          supabase
            .from("meta_content_candidates")
            .select("id", { count: "exact", head: true })
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id),
        ])
      : [{ data: [] }, { data: [] }, { count: 0 }];
  const syncStatus = metaAccount?.sync_status ?? "idle";
  const syncInfo =
    syncStatus === "idle" && metaAccount?.baseline_completed_at
      ? SYNC_STATUS.reconnected
      : (SYNC_STATUS[syncStatus as keyof typeof SYNC_STATUS] ?? SYNC_STATUS.idle);
  const reconnectRequired =
    syncStatus === "reconnect_required" || !writeScopeGranted;
  const pageAssets = (metaAssets ?? []).filter(
    (asset) => asset.asset_type === "facebook_page",
  );
  const selectedInstagramIds = new Set(
    Array.isArray(metaAccount?.instagram_account_ids)
      ? metaAccount.instagram_account_ids.filter(
          (id): id is string => typeof id === "string" && /^\d{1,64}$/.test(id),
        )
      : [],
  );
  const instagramAssets = (metaAssets ?? []).filter(
    (asset) =>
      asset.asset_type === "instagram_account" &&
      selectedInstagramIds.has(asset.meta_asset_id),
  );
  const adAccountAssets = (metaAssets ?? []).filter(
    (asset) => asset.asset_type === "ad_account",
  );
  const metaNotice = getMetaNotice(
    firstQueryValue(query.meta),
    firstQueryValue(query.meta_error),
    metaConnected,
    writeScopeGranted,
    firstQueryValue(query.meta_missing_scopes),
    firstQueryValue(query.meta_unexpected_scopes),
    firstQueryValue(query.meta_callback_stage),
  );
  const [
    { data: liveCampaigns },
    { data: campaignPerformance },
    { data: dailyPerformance },
    { data: campaignRecommendations },
  ] = metaConnected && metaAccount
      ? await Promise.all([
          supabase
            .from("campaigns")
            .select("id, name, objective, status, effective_status, platform_updated_time")
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .eq("is_current", true)
            .order("platform_updated_time", { ascending: false, nullsFirst: false })
            .limit(50),
          supabase
            .from("meta_campaign_performance_30d")
            .select(
              "campaign_id, currency, spend, impressions, inline_link_clicks, leads, purchases, link_ctr, link_cpc, window_start, window_end",
            )
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id),
          supabase
            .from("meta_account_performance_daily")
            .select(
              "date, currency, spend, impressions, inline_link_clicks, leads, purchases",
            )
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .order("date", { ascending: false })
            .limit(30),
          supabase
            .from("campaign_recommendations")
            .select(
              "id, campaign_id, rule_key, rule_version, severity, priority, title, summary, evidence, window_start, window_end",
            )
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .eq("status", "active")
            .gt("expires_at", new Date().toISOString())
            .order("priority", { ascending: false })
            .order("generated_at", { ascending: false })
            .limit(50),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const [
    { data: currentPolicy },
    { data: activeBrandProfile },
    { data: latestKillSwitch },
    { data: controlAuditEvents },
    { data: customerDomains },
    { data: customerBlueprints },
    { data: readyBrandAssets },
    { data: syncedCreatives },
    { data: recentLaunchPlans },
    { data: recentExposureSnapshots },
    { data: automationTargets },
    { data: budgetCanaryPlans },
    { data: boostSettingsRow },
    { data: boostOverrideRows },
    { data: organicBoostLinks },
  ] = metaConnected && metaAccount
    ? await Promise.all([
        supabase
          .from("automation_policies")
          .select(
            "id,version,status,account_daily_hard_cap_minor,default_campaign_daily_hard_cap_minor,budget_change_limit_bps,cooldown_seconds,allow_budget_changes,allow_status_changes,allow_new_launches,customer_confirmed_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("brand_profiles")
          .select(
            "id,version,display_name,brand_name,guidelines,forbidden_content,generation_defaults,generated_asset_approval_mode,activated_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("status", "ACTIVE")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("kill_switch_state")
          .select("mode,reason,actor_type,created_at")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("scope_type", "ACCOUNT")
          .order("sequence", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("mutation_audit_events")
          .select("event_sequence,event_type,actor_type,error_class,occurred_at")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .order("event_sequence", { ascending: false })
          .limit(20),
        supabase
          .from("allowed_domains")
          .select(
            "id,hostname,registrable_domain,status,customer_confirmed_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .in("status", ["PENDING", "VERIFIED"])
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("objective_blueprints")
          .select("id,objective,name,version,status,activated_at")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .in("status", ["DRAFT", "ACTIVE"])
          .order("version", { ascending: false })
          .limit(20),
        supabase
          .from("brand_assets")
          .select(
            "id,original_filename,source_meta_asset_id,width,height,meta_image_hash",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("status", "READY")
          .eq("moderation_status", "APPROVED")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.rpc("list_current_meta_creatives_for_import", {
          p_platform_account_id: metaAccount.id,
        }),
        supabase
          .from("mutation_plans")
          .select("id,status,created_at,payload_hash,planned_payload")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("action_type", "LAUNCH_CHAIN")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("daily_budget_exposure_snapshots")
          .select(
            "policy_id,source_marketing_sync_id,status,currency,completed_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("status", "COMPLETE")
          .order("completed_at", { ascending: false })
          .limit(20),
        supabase
          .from("automation_targets")
          .select("id,target_type,campaign_id,platform_object_id,status")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .not("budget_owner_key", "is", null)
          .in("status", ["MANAGED", "SUSPENDED"])
          .order("created_at", { ascending: true })
          .limit(1000),
        supabase.rpc("list_meta_budget_canary_plans", {
          p_platform_account_id: metaAccount.id,
        }),
        supabase
          .from("meta_boost_settings")
          .select(
            "id,version,boost_mode,enabled,auto_boost_new_candidates,require_manual_approval,budget_mode,daily_budget_minor,lifetime_budget_minor,duration_days,budget_owner_type,objective,source_filter,default_countries,default_cta_type,default_destination_url,customer_confirmed_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("meta_content_boost_overrides")
          .select(
            "content_candidate_id,mode,budget_mode,daily_budget_minor,lifetime_budget_minor,duration_days,cta_type,destination_url,clear_cta",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .limit(50),
        supabase
          .from("meta_organic_boost_links")
          .select("content_candidate_id,plan_id,object_story_id")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ])
    : [
        { data: null },
        { data: null },
        { data: null },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: null },
        { data: [] },
        { data: [] },
      ];
  const policyView: AutomationPolicyView | null = currentPolicy
    ? {
        id: String(currentPolicy.id),
        version: toFiniteNumber(currentPolicy.version) ?? 1,
        status: String(currentPolicy.status),
        accountDailyHardCapMinor: toFiniteNumber(
          currentPolicy.account_daily_hard_cap_minor,
        ),
        campaignDailyHardCapMinor: toFiniteNumber(
          currentPolicy.default_campaign_daily_hard_cap_minor,
        ),
        budgetChangeLimitBps:
          toFiniteNumber(currentPolicy.budget_change_limit_bps) ?? 2000,
        cooldownSeconds: toFiniteNumber(currentPolicy.cooldown_seconds) ?? 43200,
        allowBudgetChanges: Boolean(currentPolicy.allow_budget_changes),
        allowStatusChanges: Boolean(currentPolicy.allow_status_changes),
        allowNewLaunches: Boolean(currentPolicy.allow_new_launches),
        customerConfirmedAt: currentPolicy.customer_confirmed_at
          ? String(currentPolicy.customer_confirmed_at)
          : null,
      }
    : null;
  const brandProfileView: BrandProfileView | null = activeBrandProfile
    ? {
        id: String(activeBrandProfile.id),
        version: toFiniteNumber(activeBrandProfile.version) ?? 1,
        displayName: String(activeBrandProfile.display_name),
        brandName: String(activeBrandProfile.brand_name),
        guidelines:
          activeBrandProfile.guidelines &&
          typeof activeBrandProfile.guidelines === "object" &&
          !Array.isArray(activeBrandProfile.guidelines)
            ? (activeBrandProfile.guidelines as Record<string, unknown>)
            : {},
        forbiddenContent: Array.isArray(activeBrandProfile.forbidden_content)
          ? activeBrandProfile.forbidden_content
          : [],
        generationDefaults:
          activeBrandProfile.generation_defaults &&
          typeof activeBrandProfile.generation_defaults === "object" &&
          !Array.isArray(activeBrandProfile.generation_defaults)
            ? (activeBrandProfile.generation_defaults as Record<string, unknown>)
            : {},
        generatedAssetApprovalMode: String(
          activeBrandProfile.generated_asset_approval_mode,
        ),
        activatedAt: activeBrandProfile.activated_at
          ? String(activeBrandProfile.activated_at)
          : null,
      }
    : null;
  const killSwitchView: KillSwitchView = latestKillSwitch
    ? {
        mode: normalizeKillSwitchMode(latestKillSwitch.mode),
        reason: String(latestKillSwitch.reason),
        actorType: String(latestKillSwitch.actor_type),
        createdAt: String(latestKillSwitch.created_at),
      }
    : null;
  const boostSettingsView: BoostSettingsView | null = boostSettingsRow
    ? {
        id: String(boostSettingsRow.id),
        version: toFiniteNumber(boostSettingsRow.version) ?? 1,
        boostMode:
          boostSettingsRow.boost_mode === "AUTO"
            ? "AUTO"
            : boostSettingsRow.boost_mode === "REVIEW"
              ? "REVIEW"
              : boostSettingsRow.enabled
                ? Boolean(boostSettingsRow.require_manual_approval)
                  ? "REVIEW"
                  : "AUTO"
                : "OFF",
        enabled: Boolean(boostSettingsRow.enabled),
        autoBoostNewCandidates: Boolean(boostSettingsRow.auto_boost_new_candidates),
        requireManualApproval: Boolean(boostSettingsRow.require_manual_approval),
        budgetMode:
          boostSettingsRow.budget_mode === "LIFETIME" ? "LIFETIME" : "DAILY",
        dailyBudgetMinor: toFiniteNumber(boostSettingsRow.daily_budget_minor),
        lifetimeBudgetMinor: toFiniteNumber(boostSettingsRow.lifetime_budget_minor),
        durationDays: toFiniteNumber(boostSettingsRow.duration_days) ?? 3,
        budgetOwnerType:
          boostSettingsRow.budget_owner_type === "CAMPAIGN" ? "CAMPAIGN" : "AD_SET",
        objective: String(boostSettingsRow.objective ?? "OUTCOME_ENGAGEMENT"),
        sourceFilter:
          boostSettingsRow.source_filter === "instagram"
            ? "instagram"
            : boostSettingsRow.source_filter === "both"
              ? "both"
              : "facebook",
        defaultCountries: Array.isArray(boostSettingsRow.default_countries)
          ? boostSettingsRow.default_countries.map(String)
          : ["DE"],
        defaultCtaType: boostSettingsRow.default_cta_type
          ? String(boostSettingsRow.default_cta_type)
          : null,
        defaultDestinationUrl: boostSettingsRow.default_destination_url
          ? String(boostSettingsRow.default_destination_url)
          : null,
        customerConfirmedAt: boostSettingsRow.customer_confirmed_at
          ? String(boostSettingsRow.customer_confirmed_at)
          : null,
      }
    : null;
  const boostOverrideByCandidate = new Map<string, ContentBoostOverrideView>(
    (boostOverrideRows ?? []).map((row) => [
      String(row.content_candidate_id),
      {
        mode:
          row.mode === "SKIP" || row.mode === "BOOST" ? row.mode : "INHERIT",
        budgetMode:
          row.budget_mode === "DAILY" || row.budget_mode === "LIFETIME"
            ? row.budget_mode
            : null,
        dailyBudgetMinor: toFiniteNumber(row.daily_budget_minor),
        lifetimeBudgetMinor: toFiniteNumber(row.lifetime_budget_minor),
        durationDays: toFiniteNumber(row.duration_days),
        ctaType: row.cta_type ? String(row.cta_type) : null,
        destinationUrl: row.destination_url ? String(row.destination_url) : null,
        clearCta: Boolean(row.clear_cta),
      },
    ]),
  );
  const organicBoostPlanByCandidate = new Map<string, HeldOrganicBoostPlanView>();
  for (const link of organicBoostLinks ?? []) {
    const plan = (recentLaunchPlans ?? []).find(
      (entry) => String(entry.id) === String(link.plan_id),
    );
    if (!plan) continue;
    const payload =
      plan.planned_payload && typeof plan.planned_payload === "object"
        ? (plan.planned_payload as Record<string, unknown>)
        : {};
    if (payload.launch_kind !== "ORGANIC_BOOST") continue;
    organicBoostPlanByCandidate.set(String(link.content_candidate_id), {
      planId: String(plan.id),
      payloadHash: String(plan.payload_hash ?? ""),
      objectStoryId: String(link.object_story_id),
      budgetMode: payload.budget_mode === "LIFETIME" ? "LIFETIME" : "DAILY",
      dailyBudgetMinor:
        payload.daily_budget_minor === null || payload.daily_budget_minor === undefined
          ? null
          : String(payload.daily_budget_minor),
      lifetimeBudgetMinor:
        payload.lifetime_budget_minor === null
        || payload.lifetime_budget_minor === undefined
          ? null
          : String(payload.lifetime_budget_minor),
      durationDays: toFiniteNumber(payload.duration_days) ?? 1,
      destinationUrl:
        payload.destination_url === null || payload.destination_url === undefined
          ? null
          : String(payload.destination_url),
      status: String(plan.status ?? "PENDING"),
    });
  }
  const automationAuditViews: AutomationAuditView[] = (
    controlAuditEvents ?? []
  ).map((event) => ({
    sequence: toFiniteNumber(event.event_sequence) ?? 0,
    eventType: String(event.event_type),
    actorType: String(event.actor_type),
    errorClass: event.error_class ? String(event.error_class) : null,
    occurredAt: String(event.occurred_at),
  }));
  const domainViews: AllowedDomainView[] = (customerDomains ?? []).flatMap(
    (domain) => {
      const status = String(domain.status);
      if (status !== "PENDING" && status !== "VERIFIED") return [];
      return [
        {
          id: String(domain.id),
          hostname: String(domain.hostname),
          registrableDomain: String(domain.registrable_domain),
          status,
          customerConfirmedAt: domain.customer_confirmed_at
            ? String(domain.customer_confirmed_at)
            : null,
        },
      ];
    },
  );
  const blueprintViews: ObjectiveBlueprintView[] = (
    customerBlueprints ?? []
  ).flatMap((blueprint) => {
    const status = String(blueprint.status);
    if (status !== "DRAFT" && status !== "ACTIVE" && status !== "RETIRED") {
      return [];
    }
    return [
      {
        id: String(blueprint.id),
        objective: String(blueprint.objective),
        name: String(blueprint.name),
        version: toFiniteNumber(blueprint.version) ?? 1,
        status,
        activatedAt: blueprint.activated_at
          ? String(blueprint.activated_at)
          : null,
      },
    ];
  });
  const brandAssetViews: ReadyBrandAssetView[] = (readyBrandAssets ?? []).map(
    (asset) => ({
      id: String(asset.id),
      originalFilename: String(asset.original_filename),
      sourceMetaAssetId: asset.source_meta_asset_id
        ? String(asset.source_meta_asset_id)
        : null,
      width: toFiniteNumber(asset.width),
      height: toFiniteNumber(asset.height),
      metaImageHashPresent:
        typeof asset.meta_image_hash === "string" &&
        asset.meta_image_hash.length > 0,
    }),
  );
  const syncedCreativeViews: SyncedCreativeView[] = (syncedCreatives ?? []).map(
    (creative: {
      creative_id: unknown;
      creative_name: unknown;
      has_importable_image: unknown;
    }) => ({
      id: String(creative.creative_id),
      name:
        typeof creative.creative_name === "string" && creative.creative_name.trim()
          ? creative.creative_name
          : "Meta-Creative",
      hasImportableImage: creative.has_importable_image === true,
    }),
  );
  const recentLaunchPlanViews: RecentLaunchPlanView[] = (
    recentLaunchPlans ?? []
  ).map((plan) => {
    const payload =
      plan.planned_payload &&
      typeof plan.planned_payload === "object" &&
      !Array.isArray(plan.planned_payload)
        ? (plan.planned_payload as Record<string, unknown>)
        : {};
    const nestedName = (key: string): string | null => {
      const value = payload[key];
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const name = (value as Record<string, unknown>).name;
      return typeof name === "string" && name.trim() ? name : null;
    };
    const timestamp = (key: string): string | null => {
      const value = payload[key];
      return typeof value === "string" && Number.isFinite(Date.parse(value))
        ? new Date(value).toISOString()
        : null;
    };
    const hasDailyBudget =
      typeof payload.daily_budget_minor === "number" ||
      typeof payload.daily_budget_minor === "string";
    const budgetType =
      payload.budget_type === "LIFETIME"
        ? "LIFETIME"
        : payload.budget_type === "DAILY" ||
            (payload.budget_type === undefined && hasDailyBudget)
          ? "DAILY"
          : null;
    const brandAssetIds = Array.isArray(payload.brand_asset_ids)
      ? payload.brand_asset_ids.filter(
          (assetId): assetId is string =>
            typeof assetId === "string" && /^[0-9a-f-]{36}$/i.test(assetId),
        )
      : [];

    return {
      id: String(plan.id),
      status: String(plan.status),
      createdAt: String(plan.created_at),
      payloadHash:
        typeof plan.payload_hash === "string" &&
        /^[0-9a-f]{64}$/.test(plan.payload_hash)
          ? plan.payload_hash
          : null,
      objective:
        typeof payload.objective === "string" ? payload.objective : null,
      destinationUrl:
        typeof payload.destination_url === "string"
          ? payload.destination_url
          : null,
      targetStatus: payload.target_status === "ACTIVE" ? "ACTIVE" : null,
      budgetType,
      budgetOwnerType:
        payload.budget_owner_type === "CAMPAIGN" ||
        payload.budget_owner_type === "AD_SET"
          ? payload.budget_owner_type
          : null,
      dailyBudgetMinor: hasDailyBudget
        ? String(payload.daily_budget_minor)
        : null,
      lifetimeBudgetMinor:
        typeof payload.lifetime_budget_minor === "number" ||
        typeof payload.lifetime_budget_minor === "string"
          ? String(payload.lifetime_budget_minor)
          : null,
      startTime: timestamp("start_time"),
      endTime: timestamp("end_time"),
      campaignName: nestedName("campaign"),
      adSetName: nestedName("ad_set"),
      creativeName: nestedName("creative"),
      adName: nestedName("ad"),
      brandAssetIds,
    };
  });
  const currentMarketingSyncAt = Date.parse(
    String(metaAccount?.marketing_last_success_at ?? ""),
  );
  const snapshotReady = (recentExposureSnapshots ?? []).some((snapshot) => {
    const completedAt = Date.parse(String(snapshot.completed_at ?? ""));
    return (
      String(snapshot.policy_id) === String(currentPolicy?.id ?? "") &&
      String(snapshot.source_marketing_sync_id) ===
        String(metaAccount?.marketing_sync_id ?? "") &&
      snapshot.status === "COMPLETE" &&
      snapshot.currency === "EUR" &&
      Number.isFinite(completedAt) &&
      Number.isFinite(currentMarketingSyncAt) &&
      completedAt >= currentMarketingSyncAt
    );
  });
  const onboardingData: AutomationOnboardingData = {
    domains: domainViews,
    blueprints: blueprintViews,
    brandAssets: brandAssetViews,
    syncedCreatives: syncedCreativeViews,
    recentLaunchPlans: recentLaunchPlanViews,
    snapshotReady,
  };
  const marketingCurrency = metaAccount?.marketing_currency ?? "EUR";
  const performanceRows = (campaignPerformance ?? []) as Record<string, unknown>[];
  const dailyRows = ((dailyPerformance ?? []) as Record<string, unknown>[]).reverse();
  const campaignPerformanceById = new Map(
    performanceRows.map((row) => [String(row.campaign_id), row]),
  );
  const campaignRows = (liveCampaigns ?? [])
    .map((campaign) => {
      const performance = campaignPerformanceById.get(campaign.id);

      return {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
        effectiveStatus: campaign.effective_status,
        spend: toFiniteNumber(performance?.spend),
        impressions: toFiniteNumber(performance?.impressions),
        linkClicks: toFiniteNumber(performance?.inline_link_clicks),
        linkCtr: toFiniteNumber(performance?.link_ctr),
        linkCpc: toFiniteNumber(performance?.link_cpc),
        leads: toFiniteNumber(performance?.leads),
        purchases: toFiniteNumber(performance?.purchases),
        currency: String(performance?.currency ?? marketingCurrency),
      };
    })
    .sort((left, right) => (right.spend ?? -1) - (left.spend ?? -1));
  const budgetOwnersByCampaign = new Map<
    string,
    AutomationScopeCampaignView["budgetOwners"]
  >();
  for (const row of (automationTargets ?? []) as Record<string, unknown>[]) {
    const campaignId = String(row.campaign_id ?? "");
    const targetType = row.target_type === "AD_SET" ? "AD_SET" : "CAMPAIGN";
    const status = row.status === "MANAGED" ? "MANAGED" : "SUSPENDED";
    const remoteObjectId = String(row.platform_object_id ?? "");
    const remoteSuffix = remoteObjectId ? remoteObjectId.slice(-6) : "unbekannt";
    const owners = budgetOwnersByCampaign.get(campaignId) ?? [];
    owners.push({
      id: String(row.id),
      label:
        targetType === "CAMPAIGN"
          ? "Kampagnenbudget"
          : `Anzeigengruppenbudget · …${remoteSuffix}`,
      targetType,
      status,
    });
    budgetOwnersByCampaign.set(campaignId, owners);
  }
  const automationScopeView: AutomationScopeCampaignView[] = campaignRows.map(
    (campaign) => ({
      id: String(campaign.id),
      name: String(campaign.name),
      objective: campaign.objective ? String(campaign.objective) : null,
      effectiveStatus: String(campaign.effectiveStatus ?? campaign.status ?? "UNKNOWN"),
      budgetOwners: budgetOwnersByCampaign.get(String(campaign.id)) ?? [],
    }),
  );
  const budgetCanaryViews: BudgetCanaryPlanView[] = (
    (budgetCanaryPlans ?? []) as Record<string, unknown>[]
  ).flatMap((row) => {
    const planId = String(row.plan_id ?? "");
    const targetType = row.target_type;
    const currentBudgetMinor = String(row.current_budget_minor ?? "");
    const intendedBudgetMinor = String(row.intended_budget_minor ?? "");
    const direction = row.direction;
    const changeBps = toFiniteNumber(row.change_bps);
    const payloadHash = String(row.payload_hash ?? "").toLowerCase();
    const status = String(row.status ?? "");

    if (
      !/^[0-9a-f-]{36}$/i.test(planId) ||
      (targetType !== "CAMPAIGN" && targetType !== "AD_SET") ||
      !/^[1-9][0-9]*$/.test(currentBudgetMinor) ||
      !/^[1-9][0-9]*$/.test(intendedBudgetMinor) ||
      (direction !== "INCREASE" &&
        direction !== "DECREASE" &&
        direction !== "UNCHANGED") ||
      changeBps === null ||
      !Number.isSafeInteger(changeBps) ||
      changeBps < 0 ||
      !/^[0-9a-f]{64}$/.test(payloadHash) ||
      status !== "PENDING"
    ) {
      return [];
    }

    return [
      {
        planId,
        campaignName: String(row.campaign_name ?? "Meta-Kampagne"),
        budgetOwnerLabel: String(row.budget_owner_label ?? "Budgetowner"),
        targetType,
        currentBudgetMinor,
        intendedBudgetMinor,
        direction,
        changeBps,
        payloadHash,
        reason: row.source_rule_key ? String(row.source_rule_key) : null,
        createdAt: String(row.created_at ?? ""),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        expired: row.is_expired === true,
        freshSync: row.fresh_sync === true,
        approvedAt: row.approved_at ? String(row.approved_at) : null,
        status,
      },
    ];
  });
  const managedBudgetOwnerCount = automationScopeView.reduce(
    (sum, campaign) =>
      sum + campaign.budgetOwners.filter((owner) => owner.status === "MANAGED").length,
    0,
  );
  const canPrepareBudgetCanary = Boolean(
    writeScopeGranted &&
      marketingCurrency === "EUR" &&
      metaAccount?.marketing_sync_status === "success" &&
      Boolean(metaAccount?.marketing_sync_id) &&
      managedBudgetOwnerCount === 1 &&
      policyView?.status === "ACTIVE" &&
      policyView.allowBudgetChanges &&
      !policyView.allowStatusChanges &&
      !policyView.allowNewLaunches &&
      killSwitchView?.mode === "FREEZE_WRITES" &&
      budgetCanaryViews.length === 0,
  );
  const canConfirmBudgetCanary = Boolean(
    writeScopeGranted &&
      marketingCurrency === "EUR" &&
      managedBudgetOwnerCount === 1 &&
      policyView?.status === "ACTIVE" &&
      policyView.allowBudgetChanges &&
      !policyView.allowStatusChanges &&
      !policyView.allowNewLaunches &&
      killSwitchView?.mode === "ALLOW" &&
      budgetCanaryViews.some(
        (plan) => !plan.approvedAt && !plan.expired && plan.freshSync,
      ),
  );
  const campaignNameById = new Map(
    campaignRows.map((campaign) => [campaign.id, campaign.name]),
  );
  const recommendationRows = ((campaignRecommendations ?? []) as Record<string, unknown>[])
    .map((row) => {
      const rawEvidence = row.evidence;
      const evidence =
        rawEvidence && typeof rawEvidence === "object" && !Array.isArray(rawEvidence)
          ? (rawEvidence as Record<string, unknown>)
          : {};
      const campaignId = String(row.campaign_id ?? "");
      const evidenceCampaignName =
        typeof evidence.campaign_name === "string" ? evidence.campaign_name : null;

      return {
        id: String(row.id),
        campaignName:
          campaignNameById.get(campaignId) ?? evidenceCampaignName ?? "Meta-Kampagne",
        ruleKey: String(row.rule_key),
        ruleVersion: toFiniteNumber(row.rule_version) ?? 1,
        severity: String(row.severity),
        priority: toFiniteNumber(row.priority) ?? 1,
        title: String(row.title),
        summary: String(row.summary),
        evidence,
        windowStart: String(row.window_start),
        windowEnd: String(row.window_end),
      };
    });
  const totalSpend = sumAvailableMetric(dailyRows, "spend");
  const totalImpressions = sumAvailableMetric(dailyRows, "impressions");
  const totalLinkClicks = sumAvailableMetric(dailyRows, "inline_link_clicks");
  const totalLeads = sumAvailableMetric(dailyRows, "leads");
  const totalPurchases = sumAvailableMetric(dailyRows, "purchases");
  const totalResults = totalLeads ?? totalPurchases;
  const resultLabel = totalLeads !== null ? "Generierte Leads" : "Erkannte Käufe";
  const costPerResult =
    totalSpend !== null && totalResults !== null && totalResults > 0
      ? totalSpend / totalResults
      : null;
  const linkCtr =
    totalLinkClicks !== null && totalImpressions !== null && totalImpressions > 0
      ? (totalLinkClicks * 100) / totalImpressions
      : null;
  const marketingMetrics = [
    {
      label: "Werbeausgaben",
      value: formatMoney(totalSpend, marketingCurrency),
      icon: WalletCards,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: resultLabel,
      value: formatInteger(totalResults),
      icon: Users,
      color: "bg-violet-50 text-violet-600",
    },
    {
      label: "Kosten pro Ergebnis",
      value: formatMoney(costPerResult, marketingCurrency),
      icon: CircleDollarSign,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Link-Klickrate",
      value: formatPercent(linkCtr),
      icon: MousePointerClick,
      color: "bg-amber-50 text-amber-600",
    },
  ];
  const chartPoints = dailyRows.map((row) => ({
    date: String(row.date),
    spend: toFiniteNumber(row.spend) ?? 0,
  }));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 lg:flex lg:flex-col">
        <Link className="flex items-center gap-3 px-2 font-extrabold" href="/dashboard">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
            <BarChart3 className="size-5" />
          </span>
          <span>AdPilot</span>
        </Link>

        <nav className="mt-10 space-y-1">
          {navigation.map(({ label, icon: Icon, active }) => (
            <span
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              }`}
              key={label}
            >
              <Icon className="size-5" />
              {label}
            </span>
          ))}
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-100 pt-5">
          <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500">
            <HelpCircle className="size-5" />
            Hilfe
          </span>
          <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500">
            <Settings className="size-5" />
            Einstellungen
          </span>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="grid size-9 place-items-center rounded-xl bg-blue-600 text-white">
                <BarChart3 className="size-4" />
              </span>
              <span className="font-extrabold">AdPilot</span>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <span className="hidden max-w-56 truncate text-sm text-slate-500 sm:block">
                {user.email}
              </span>
              <button
                aria-label="Benachrichtigungen"
                className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                type="button"
              >
                <Bell className="size-5" />
              </button>
              <SignOutButton />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:py-10">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    metaAccount?.marketing_sync_status === "success"
                      ? "bg-emerald-100 text-emerald-800"
                      : platformAccountReadFailed
                        ? "bg-amber-100 text-amber-900"
                        : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {metaAccount?.marketing_sync_status === "success"
                    ? "Meta Live"
                    : platformAccountReadFailed
                      ? "Live-Daten konnten nicht geladen werden"
                      : "Live-Daten noch nicht verfügbar"}
                </span>
                <span className="text-xs text-slate-400">
                  {platformAccountReadFailed
                    ? "Bestehende Verbindung bleibt unverändert"
                    : hasConnectedPlatform
                      ? `Datenstand ${formatDateTime(metaAccount?.marketing_last_success_at)}`
                      : "Noch keine Werbekonten verbunden"}
                </span>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Marketing-Übersicht</h1>
              <p className="mt-2 text-slate-500">
                Echte Meta-Kampagnenleistung mit kundenkontrollierten Automationsgrenzen.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <span className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm">
                <CalendarDays className="size-4" />
                Letzte 30 Insight-Tage
              </span>
              <a
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                href="#plattformen"
              >
                <Plus className="size-4" />
                Plattform verbinden
              </a>
            </div>
          </div>

          {metaNotice ? (
            <section
              aria-live="polite"
              className={`mt-8 flex gap-3 rounded-2xl border p-4 sm:p-5 ${
                metaNotice.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-red-200 bg-red-50 text-red-950"
              }`}
              role={metaNotice.tone === "error" ? "alert" : "status"}
            >
              {metaNotice.tone === "success" ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
              )}
              <div>
                <p className="font-bold">{metaNotice.title}</p>
                <p className="mt-1 text-sm leading-6 opacity-80">{metaNotice.message}</p>
              </div>
            </section>
          ) : null}

          {platformAccountReadFailed ? (
            <section
              aria-live="assertive"
              className="mt-8 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:p-5"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <p className="font-bold">Verbindungsdaten konnten nicht geladen werden.</p>
                <p className="mt-1 text-sm leading-6 opacity-80">
                  Die bestehende Meta-Verbindung bleibt unverändert. Bitte keinen Reconnect starten;
                  der Lesezugriff muss zuerst geprüft werden.
                </p>
              </div>
            </section>
          ) : null}

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {marketingMetrics.map(({ label, value, icon: Icon, color }) => (
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={label}>
                <div className="flex items-start justify-between gap-3">
                  <span className={`grid size-10 place-items-center rounded-xl ${color}`}>
                    <Icon className="size-5" />
                  </span>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                    Meta Live
                  </span>
                </div>
                <p className="mt-5 text-sm font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
              </article>
            ))}
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold">Tägliche Werbeausgaben</p>
                  <p className="mt-1 text-sm text-slate-500">Letzte 30 vollständige Meta-Insight-Tage</p>
                </div>
                <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {marketingCurrency}
                </span>
              </div>
              <PerformanceChart currency={marketingCurrency} points={chartPoints} />
            </article>

            <article className="overflow-hidden rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
              <span className="grid size-11 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
                <Sparkles className="size-5" />
              </span>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-blue-300">
                Regelbasierte Analyse
              </p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight">
                Hinweise mit messbarer Evidenz.
              </h2>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Adbot bewertet ausschließlich gespeicherte Live-Kennzahlen anhand fester Schwellenwerte. Jede Empfehlung bleibt ein prüfbarer Diagnosehinweis und kann keine Kampagne verändern.
              </p>
              <div className="mt-8 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-white">
                Ausführung nur mit aktiver Kunden-Policy
              </div>
            </article>
          </section>

          {metaConnected && metaAccount ? (
            <AutomationControlCenter
              accountName={metaAccount.account_name ?? "Meta-Werbekonto"}
              auditEvents={automationAuditViews}
              automationScope={automationScopeView}
              boostSettings={boostSettingsView}
              brandProfile={brandProfileView}
              budgetCanaries={budgetCanaryViews}
              canPrepareBudgetCanary={canPrepareBudgetCanary}
              canConfirmBudgetCanary={canConfirmBudgetCanary}
              currency={marketingCurrency}
              killSwitch={killSwitchView}
              onboarding={onboardingData}
              policy={policyView}
              readiness={{
                writeScopeGranted,
                verifiedDomains: domainViews.filter(
                  (domain) => domain.status === "VERIFIED",
                ).length,
                activeBlueprints: blueprintViews.filter(
                  (blueprint) => blueprint.status === "ACTIVE",
                ).length,
                readyBrandAssets: brandAssetViews.length,
              }}
            />
          ) : null}

          {metaConnected && metaAccount ? (
            <MetaCampaignOverview
              campaigns={campaignRows}
              counts={{
                campaigns: metaAccount.marketing_campaign_count ?? 0,
                adSets: metaAccount.marketing_ad_set_count ?? 0,
                ads: metaAccount.marketing_ad_count ?? 0,
                creatives: metaAccount.marketing_creative_count ?? 0,
                insights: metaAccount.marketing_insight_count ?? 0,
              }}
              currency={marketingCurrency}
              errorCode={metaAccount.marketing_sync_error_code ?? null}
              insightsSince={metaAccount.marketing_insights_since ?? null}
              insightsUntil={metaAccount.marketing_insights_until ?? null}
              lastSuccessAt={metaAccount.marketing_last_success_at ?? null}
              recommendations={recommendationRows}
              status={metaAccount.marketing_sync_status ?? "idle"}
            />
          ) : null}

          <section className="mt-10" id="plattformen">
            <div>
              <h2 className="text-xl font-extrabold">Werbeplattformen</h2>
              <p className="mt-1 text-sm text-slate-500">
                Verbinde Konten direkt im Dashboard. Jede Integration zeigt ihren Freigabeumfang vor dem Start.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                <ShieldCheck className="size-3.5" />
                Meta nutzt nur dokumentierte Lese- und policy-begrenzte Schreibrechte
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {platforms.map(({ id, ...platform }) => (
                <PlatformStatusCard key={id} {...platform} />
              ))}
            </div>
          </section>

          {metaConnected && metaAccount ? (
            <section className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                      Meta Content Sync
                    </p>
                    <h2 className="mt-2 text-xl font-extrabold tracking-tight">
                      Beiträge sicher abrufen
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                      Adbot liest veröffentlichte Beiträge deiner in Meta ausgewählten Facebook-Seiten und Instagram-Konten. Dieser Sync-Pfad führt keine Mutation aus; Meta-Änderungen laufen ausschließlich über die getrennte, policy-gedeckte Control Plane.
                    </p>
                  </div>
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${syncInfo.className}`}
                  >
                    {syncInfo.label}
                  </span>
                </div>
              </div>

              <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {syncInfo.description}
                  </p>
                  <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        <Clock3 className="size-4" />
                        Letzter Abruf
                      </dt>
                      <dd className="mt-2 text-sm font-bold text-slate-900">
                        {formatDateTime(metaAccount.last_synced_at)}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        <CalendarClock className="size-4" />
                        Nächster Abruf
                      </dt>
                      <dd className="mt-2 text-sm font-bold text-slate-900">
                        {formatDateTime(customerNextSyncAt)}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        Gesehen
                      </dt>
                      <dd className="mt-2 text-2xl font-extrabold text-slate-900">
                        {metaAccount.last_sync_seen_count ?? 0}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        Neu erkannt
                      </dt>
                      <dd className="mt-2 text-2xl font-extrabold text-blue-700">
                        {metaAccount.last_sync_new_count ?? 0}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                        Gespeichert
                      </dt>
                      <dd className="mt-2 text-2xl font-extrabold text-slate-900">
                        {storedCandidateCount ?? 0}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                    {pageAssets.map((asset) => (
                      <span
                        className="rounded-full bg-slate-100 px-3 py-1.5"
                        key={asset.id}
                      >
                        Facebook: {asset.name?.trim() || asset.meta_asset_id}
                      </span>
                    ))}
                    {instagramAssets.map((asset) => (
                      <span
                        className="rounded-full bg-slate-100 px-3 py-1.5"
                        key={asset.id}
                      >
                        Instagram:{" "}
                        {asset.username
                          ? `@${asset.username}`
                          : asset.name?.trim() || asset.meta_asset_id}
                      </span>
                    ))}
                    {adAccountAssets.map((asset) => (
                      <span
                        className="rounded-full bg-slate-100 px-3 py-1.5"
                        key={asset.id}
                      >
                        Werbekonto: {asset.name?.trim() || asset.meta_asset_id}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="lg:min-w-60">
                  {reconnectRequired ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-bold text-red-950">
                        {writeScopeGranted
                          ? "Die Meta-Verbindung muss erneuert werden."
                          : "Der minimale Schreibscope muss bestätigt werden."}
                      </p>
                      <form action="/api/connectors/meta/start" method="post">
                        <button
                          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                          type="submit"
                        >
                          Meta neu verbinden
                          <ArrowUpRight className="size-4" />
                        </button>
                      </form>
                    </div>
                  ) : (
                    <MetaSyncButton
                      lastSyncStartedAt={metaAccount.last_sync_started_at ?? null}
                    />
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Automatisch einmal pro Stunde. Der manuelle Abruf ist nach 60 Sekunden erneut verfügbar.
                  </p>
                </div>
              </div>

              {!metaAccount.baseline_completed_at ? (
                <div className="mx-5 mb-6 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 sm:mx-6">
                  <span className="font-bold">Sicherer Ausgangsbestand:</span>{" "}
                  Beim ersten Abruf werden vorhandene Beiträge eingelesen, aber nicht als neu markiert. Erst später veröffentlichte Inhalte erscheinen als neue Kandidaten.
                </div>
              ) : null}
            </section>
          ) : null}

          {metaConnected ? (
            <section className="mt-10">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                    Beitragskandidaten
                  </p>
                  <h2 className="mt-2 text-xl font-extrabold tracking-tight">
                    Neu seit dem Ausgangsbestand
                  </h2>
                </div>
                <p className="max-w-xl text-sm leading-6 text-slate-500">
                  Neue Beiträge werden stündlich erkannt. Mit aktivem Beitrag-Push kannst du sie
                  mit Fixed Budget bewerben – Standards gelten pro Konto, Overrides pro Beitrag.
                </p>
              </div>

              {contentCandidates?.length ? (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {contentCandidates.map((candidate) => (
                    <article
                      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                      key={candidate.id}
                    >
                      <ContentCandidatePreview
                        contentType={candidate.content_type}
                        previewUrl={candidate.preview_url}
                        source={candidate.source}
                      />
                      <div className="flex min-h-52 flex-col p-5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                            {candidate.source === "instagram" ? (
                              <Camera className="size-3.5" />
                            ) : (
                              <Megaphone className="size-3.5" />
                            )}
                            {candidate.source === "instagram"
                              ? "Instagram"
                              : "Facebook"}
                          </span>
                          <span className="text-xs font-semibold text-slate-500">
                            {formatDateTime(
                              candidate.published_at ?? candidate.first_seen_at,
                            )}
                          </span>
                        </div>
                        <p className="mt-5 line-clamp-4 text-sm leading-6 text-slate-700">
                          {candidate.caption_excerpt ??
                            "Beitrag ohne verfügbaren Text"}
                        </p>
                        <div className="mt-auto pt-5">
                          {candidate.permalink_url ? (
                            <a
                              className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 transition hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                              href={candidate.permalink_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Originalbeitrag ansehen
                              <ExternalLink className="size-4" />
                            </a>
                          ) : (
                            <span className="text-sm font-semibold text-slate-400">
                              Kein öffentlicher Link verfügbar
                            </span>
                          )}
                          <ContentCandidateBoostControls
                            canApprove={Boolean(
                              writeScopeGranted &&
                                killSwitchView?.mode === "FREEZE_WRITES" &&
                                boostSettingsView?.enabled,
                            )}
                            canPrepare={Boolean(
                              writeScopeGranted &&
                                killSwitchView?.mode === "FREEZE_WRITES" &&
                                boostSettingsView?.enabled &&
                                policyView?.status === "ACTIVE" &&
                                policyView.allowNewLaunches,
                            )}
                            candidateId={String(candidate.id)}
                            heldPlan={
                              organicBoostPlanByCandidate.get(String(candidate.id)) ?? null
                            }
                            override={
                              boostOverrideByCandidate.get(String(candidate.id)) ?? null
                            }
                            source={
                              candidate.source === "instagram" ? "instagram" : "facebook"
                            }
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
                  <RefreshCw className="mx-auto size-6 text-slate-400" />
                  <p className="mt-3 font-bold text-slate-900">
                    Noch keine neuen Beitragskandidaten
                  </p>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    Nach dem ersten Ausgangsbestand erscheinen hier Beiträge, die bei einem späteren manuellen oder stündlichen Abruf neu erkannt werden.
                  </p>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
