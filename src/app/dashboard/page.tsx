import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  Bell,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  EyeOff,
  Filter,
  Gift,
  HelpCircle,
  ImageIcon,
  LayoutDashboard,
  Megaphone,
  MousePointerClick,
  Pin,
  Play,
  Plus,
  Images,
  Rocket,
  Scale,
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
import {
  CampaignAssistantBrief,
  type CampaignBriefView,
} from "@/components/CampaignAssistantBrief";
import { FreebieWorkspaceCard } from "@/components/FreebieWorkspaceCard";
import { FunnelWorkspaceCard } from "@/components/FunnelWorkspaceCard";
import type {
  AllowedDomainView,
  AutomationOnboardingData,
  ConfirmedPixelView,
  ObjectiveBlueprintView,
  ReadyBrandAssetView,
  RecentLaunchPlanView,
  SyncedCreativeView,
} from "@/components/AutomationOnboardingControls";
import type { BudgetCanaryPlanView } from "@/components/AutomationBudgetCanaryManager";
import type { AutomationScopeCampaignView } from "@/components/AutomationScopeManager";
import type {
  BoostEligibleAssetView,
  BoostSettingsView,
} from "@/components/AutomationBoostSettings";
import {
  type ContentBoostOverrideView,
  type HeldOrganicBoostPlanView,
} from "@/components/ContentCandidateBoostControls";
import {
  MetaCampaignOverview,
  deriveOrganicBoostDelivery,
  formatOrganicBoostFailureDetail,
  type OrganicBoostCampaignView,
} from "@/components/MetaCampaignOverview";
import {
  type MetaConnectedAssetView,
} from "@/components/MetaConnectedAssets";
import { MetaContentSyncPanel } from "@/components/MetaContentSyncPanel";
import { PerformanceChart } from "@/components/PerformanceChart";
import { PlatformStatusCard } from "@/components/PlatformStatusCard";
import { CreditsSidebarBalance } from "@/components/CreditsSidebarBalance";
import { SignOutButton } from "@/components/SignOutButton";
import { SiteBrandMark } from "@/components/SiteBrandMark";
import { SiteFooter } from "@/components/SiteFooter";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { getCreditBalanceForUser } from "@/lib/billing/credits";
import { loadContentSyncSnapshot } from "@/lib/meta/content-sync-snapshot";
import {
  drainHardCapStatusExecutionsForAccount,
  forceReactivatePausedOrganicBoostCampaigns,
} from "@/lib/meta/hard-cap-status-execute";
import { planAndDrainOrganicBoostForAccount } from "@/lib/meta/organic-boost-ensure";
import { getPlatformCatalog } from "@/lib/platforms/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createFreebieSsoEntryPath, createFunnelSsoEntryPath } from "@/lib/site-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const baseNavigation = [
  { label: "Übersicht", icon: LayoutDashboard, href: "/dashboard", active: true, external: false },
  { label: "Kampagnen", icon: Megaphone, href: "#kampagnen", active: false, external: false },
  {
    label: "Assistent",
    icon: Sparkles,
    href: "#kampagnen-assistent",
    active: false,
    external: false,
  },
  {
    label: "Funnel",
    icon: Filter,
    href: createFunnelSsoEntryPath(),
    active: false,
    external: true,
  },
  {
    label: "Freebie",
    icon: Gift,
    href: createFreebieSsoEntryPath(),
    active: false,
    external: true,
  },
  {
    label: "Creatives",
    icon: ImageIcon,
    href: "/dashboard/creatives",
    active: false,
    external: false,
  },
  { label: "Zielgruppen", icon: Target, href: null, active: false, external: false },
  { label: "Autonomie", icon: ShieldCheck, href: "#automation-control-center", active: false, external: false },
  { label: "Traffic-Launch", icon: Rocket, href: "#traffic-launch", active: false, external: false },
];

const adminNavigationItems = [
  {
    label: "Logo",
    icon: Images,
    href: "/dashboard/logo",
    active: false,
    external: false,
  },
  {
    label: "Rechtliches",
    icon: Scale,
    href: "/dashboard/rechtliches",
    active: false,
    external: false,
  },
  {
    label: "Inspiration",
    icon: EyeOff,
    href: "/dashboard/inspiration",
    active: false,
    external: false,
  },
];

type DashboardPageProps = {
  searchParams: Promise<{
    meta?: string | string[];
    meta_error?: string | string[];
    meta_missing_scopes?: string | string[];
    meta_unexpected_scopes?: string | string[];
    meta_callback_stage?: string | string[];
    assetId?: string | string[];
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
  missing_page_targets: "Meta hat keine Facebook-Seiten-IDs aus der Dialog-Auswahl geliefert. Bitte trenne Meta vollständig und verbinde erneut mit ausdrücklicher Seitenauswahl.",
  missing_ad_account_targets: "Meta hat keine Werbekonto-IDs aus der Dialog-Auswahl geliefert. Bitte trenne Meta vollständig und verbinde erneut mit ausdrücklicher Werbekonto-Auswahl.",
  missing_instagram_targets: "Meta hat keine Instagram-IDs aus der Dialog-Auswahl geliefert. Bitte trenne Meta vollständig und verbinde erneut mit ausdrücklicher Instagram-Auswahl.",
  storage: "Die Verbindung konnte nicht sicher gespeichert werden. Es wurde keine Verbindung aktiviert.",
  extend_storage: "Die zusätzlichen Assets konnten nicht gespeichert werden. Bestehende Verbindungen bleiben unverändert.",
  extend_no_assets: "Meta hat keine neuen Assets aus der Dialog-Auswahl geliefert. Bestehende Verbindungen bleiben unverändert — bitte im Dialog die zusätzlichen Seiten/Konten auswählen.",
  extend_stale_system_user: "Meta lieferte ein Token ohne neue Ziel-IDs. Für additive Erweiterung bitte im Dialog die neuen Assets explizit wählen; bei Bedarf Meta einmal sicher neu verbinden.",
  extend_start: "Der Erweiterungs-Dialog konnte nicht gestartet werden. Bestehende Verbindungen bleiben unverändert.",
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

  if (meta === "extended") {
    return {
      tone: "success",
      title: "Meta-Assets wurden erweitert.",
      message:
        "Neue Seiten oder Konten wurden additiv hinzugefügt. Bereits verbundene Assets und der Kampagnenstand bleiben erhalten. Bitte einmal Abruf starten.",
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

  const userIsSiteAdmin = await isSiteAdmin(user.id);
  const navigation = userIsSiteAdmin
    ? [...baseNavigation, ...adminNavigationItems]
    : [...baseNavigation];

  let creditBalance: Awaited<ReturnType<typeof getCreditBalanceForUser>> = null;
  try {
    creditBalance = await getCreditBalanceForUser(user.id);
  } catch (error) {
    console.error("dashboard_credit_balance_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  const { data: connectedAccounts, error: connectedAccountsError } = await supabase
    .from("platform_accounts")
    .select(
      "id, platform, account_name, connected_at, revoked_at, meta_scopes, sync_status, sync_error_code, last_sync_started_at, last_synced_at, next_sync_at, baseline_completed_at, last_sync_seen_count, last_sync_new_count, marketing_currency, marketing_sync_status, marketing_sync_error_code, marketing_sync_id, marketing_last_success_at, marketing_campaign_count, marketing_ad_set_count, marketing_ad_count, marketing_creative_count, marketing_insight_count, marketing_recommendation_count, marketing_insights_since, marketing_insights_until, marketing_spend_total, marketing_spend_today, marketing_insight_spend_rows, instagram_account_ids",
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
  const writeScopeGranted =
    Array.isArray(metaAccount?.meta_scopes) &&
    metaAccount.meta_scopes.includes("ads_management");
  // Dashboard load: plan+drain once, then cooldown so LiveRefresh polls do not
  // re-enter Meta WRITE every 15s (lease fights + endless "Aktualisiert…").
  if (metaConnected && metaAccount && writeScopeGranted) {
    // Clear sticky lease banners from a prior parallel Abruf/Drain.
    const stickyLease =
      metaAccount.marketing_sync_error_code === "marketing_operation_locked" ||
      metaAccount.marketing_sync_error_code === "marketing_operation_lease_failed";
    if (stickyLease && metaAccount.marketing_sync_status === "success") {
      try {
        await createAdminClient()
          .from("platform_accounts")
          .update({
            marketing_sync_error_code: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", metaAccount.id)
          .eq("user_id", user.id);
        metaAccount.marketing_sync_error_code = null;
      } catch {
        // Non-fatal display cleanup.
      }
    }

    try {
      const ensured = await planAndDrainOrganicBoostForAccount({
        userId: user.id,
        platformAccountId: metaAccount.id,
        ownerPrefix: "organic-boost-dashboard",
        maxRuns: 4,
        skipIfRecentMs: 60_000,
      });
      const drain = ensured.drain;
      if (
        !ensured.skippedRecent &&
        (ensured.planner?.lastError ||
          (ensured.planner?.plansCreated ?? 0) > 0 ||
          drain?.lastError ||
          (drain?.runs ?? 0) > 0 ||
          (drain?.duePlans ?? 0) > 0)
      ) {
        console.error("organic_boost_dashboard_ensure", {
          platformAccountId: metaAccount.id,
          plannerStatus: ensured.planner?.status ?? null,
          plansCreated: ensured.planner?.plansCreated ?? 0,
          plansExisting: ensured.planner?.plansExisting ?? 0,
          plannerError: ensured.planner?.lastError ?? null,
          duePlans: drain?.duePlans ?? 0,
          runs: drain?.runs ?? 0,
          succeeded: drain?.succeeded ?? 0,
          failed: drain?.failed ?? 0,
          lastOutcome: drain?.lastOutcome ?? null,
          lastError: drain?.lastError ?? null,
          prepareDetail: drain?.prepareDetail ?? null,
          preflightOkCount: drain?.preflightOkCount ?? null,
          killSwitchMode: drain?.killSwitchMode ?? null,
          divertedToOtherAccount: drain?.divertedToOtherAccount ?? false,
        });
      }
    } catch (error) {
      console.error("organic_boost_dashboard_ensure_exception", {
        platformAccountId: metaAccount.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }

    try {
      const marketingSyncId =
        typeof metaAccount.marketing_sync_id === "string"
          ? metaAccount.marketing_sync_id
          : null;
      if (marketingSyncId) {
        const forceResume = await forceReactivatePausedOrganicBoostCampaigns({
          userId: user.id,
          platformAccountId: metaAccount.id,
          marketingSyncId,
        });
        if (
          forceResume.error ||
          forceResume.created > 0 ||
          forceResume.existing > 0 ||
          forceResume.candidates > 0
        ) {
          console.error("organic_boost_dashboard_force_reactivate", {
            platformAccountId: metaAccount.id,
            ...forceResume,
          });
        }
      }

      const hardCapDrain = await drainHardCapStatusExecutionsForAccount({
        userId: user.id,
        platformAccountId: metaAccount.id,
        maxRuns: 20,
      });
      if (
        hardCapDrain.lastError ||
        hardCapDrain.runs > 0 ||
        hardCapDrain.duePlans > 0
      ) {
        console.error("hard_cap_status_dashboard_drain", {
          platformAccountId: metaAccount.id,
          duePlans: hardCapDrain.duePlans,
          runs: hardCapDrain.runs,
          succeeded: hardCapDrain.succeeded,
          failed: hardCapDrain.failed,
          lastOutcome: hardCapDrain.lastOutcome,
          lastError: hardCapDrain.lastError,
          divertedToOtherAccount: hardCapDrain.divertedToOtherAccount,
        });
      }
    } catch (error) {
      console.error("hard_cap_status_dashboard_drain_exception", {
        platformAccountId: metaAccount.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  const [{ data: metaAssets }, contentSyncSnapshot] =
    metaConnected && metaAccount
      ? await Promise.all([
          supabase
            .from("meta_assets")
            .select("id, asset_type, meta_asset_id, name, username, last_synced_at")
            .eq("platform_account_id", metaAccount.id)
            .eq("user_id", user.id)
            .order("asset_type", { ascending: true }),
          loadContentSyncSnapshot({
            supabase,
            userId: user.id,
            platformAccountId: metaAccount.id,
            connector: {
              sync_status: metaAccount.sync_status,
              sync_error_code: metaAccount.sync_error_code,
              last_sync_started_at: metaAccount.last_sync_started_at,
              last_synced_at: metaAccount.last_synced_at,
              next_sync_at: metaAccount.next_sync_at,
              last_sync_seen_count: metaAccount.last_sync_seen_count,
              last_sync_new_count: metaAccount.last_sync_new_count,
              baseline_completed_at: metaAccount.baseline_completed_at,
            },
            now: renderedAt,
          }),
        ])
      : [
          { data: [] as never[] },
          null,
        ];
  const contentCandidates = contentSyncSnapshot?.candidates ?? [];
  const syncStatus = metaAccount?.sync_status ?? "idle";
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
  const connectedAssetViews: MetaConnectedAssetView[] = [
    ...pageAssets.map((asset) => ({
      id: asset.id,
      assetType: "facebook_page" as const,
      label: `Facebook: ${asset.name?.trim() || asset.meta_asset_id}`,
      removable: pageAssets.length > 1,
    })),
    ...instagramAssets.map((asset) => ({
      id: asset.id,
      assetType: "instagram_account" as const,
      label: `Instagram: ${
        asset.username
          ? `@${asset.username}`
          : asset.name?.trim() || asset.meta_asset_id
      }`,
      removable: instagramAssets.length > 1,
    })),
    ...adAccountAssets.map((asset) => ({
      id: asset.id,
      assetType: "ad_account" as const,
      label: `Werbekonto: ${asset.name?.trim() || asset.meta_asset_id}`,
      removable: adAccountAssets.length > 1,
    })),
  ];
  const showExtraAssetHint =
    pageAssets.length > 1
    || instagramAssets.length > 1
    || adAccountAssets.length > 1;
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
            .select(
              "id, name, objective, status, effective_status, platform_updated_time, daily_budget_minor, lifetime_budget_minor, budget_remaining_minor, start_time, stop_time",
            )
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
    { data: organicBoostPlans },
    { data: recentExposureSnapshots },
    { data: automationTargets },
    { data: budgetCanaryPlans },
    { data: boostSettingsRow },
    { data: boostOverrideRows },
    { data: organicBoostLinks },
    { data: boostAssetSettingRows },
    { data: organicBoostCampaignRows },
    { data: organicBoostPlannerRow },
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
            "id,version,display_name,brand_name,facebook_page_id,instagram_actor_id,guidelines,forbidden_content,generation_defaults,generated_asset_approval_mode,activated_at",
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
          .eq("library_scope", "CUSTOMER")
          .eq("status", "READY")
          .eq("moderation_status", "APPROVED")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.rpc("list_current_meta_creatives_for_import", {
          p_platform_account_id: metaAccount.id,
        }),
        supabase
          .from("mutation_plans")
          .select(
            "id,status,created_at,payload_hash,planned_payload,source_rule_key,not_before",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("action_type", "LAUNCH_CHAIN")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("mutation_plans")
          .select(
            "id,status,created_at,payload_hash,planned_payload,source_rule_key,not_before",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("source_rule_key", "organic-boost")
          .order("created_at", { ascending: false })
          .limit(50),
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
            "id,version,boost_mode,enabled,auto_boost_new_candidates,require_manual_approval,budget_mode,daily_budget_minor,lifetime_budget_minor,duration_days,budget_owner_type,objective,source_filter,default_countries,default_cta_type,default_destination_url,asset_scope,customer_confirmed_at",
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
          .select("content_candidate_id,plan_id,object_story_id,created_at")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("meta_boost_asset_settings")
          .select("meta_asset_id,included,daily_budget_minor,duration_days")
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .limit(100),
        supabase.rpc("list_meta_organic_boost_campaigns", {
          p_platform_account_id: metaAccount.id,
        }),
        supabase
          .from("platform_accounts")
          .select(
            "sync_usage,organic_boost_planner_status,organic_boost_planner_detail,organic_boost_planner_last_run_at",
          )
          .eq("id", metaAccount.id)
          .eq("user_id", user.id)
          .maybeSingle(),
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
        { data: [] },
        { data: null },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: null },
      ];
  const { data: campaignBriefRows } =
    metaConnected && metaAccount
      ? await supabase
          .from("campaign_briefs")
          .select(
            "id,status,objective,landing_url,landing_hostname,notes,created_at,updated_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .in("status", ["DRAFT", "READY"])
          .order("updated_at", { ascending: false })
          .limit(20)
      : { data: [] };
  // Additive Lead prerequisite — independent of Traffic onboarding queries.
  const { data: confirmedPixelRows } =
    metaConnected && metaAccount
      ? await supabase
          .from("meta_confirmed_pixels")
          .select(
            "id,pixel_id,label,custom_event_type,status,customer_confirmed_at",
          )
          .eq("user_id", user.id)
          .eq("platform_account_id", metaAccount.id)
          .eq("status", "CONFIRMED")
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] };
  const campaignBriefViews: CampaignBriefView[] = (
    campaignBriefRows ?? []
  ).flatMap((row) => {
    const status = String(row.status ?? "");
    if (
      status !== "DRAFT" &&
      status !== "READY" &&
      status !== "CONSUMED" &&
      status !== "ARCHIVED"
    ) {
      return [];
    }
    return [
      {
        id: String(row.id),
        status,
        objective: String(row.objective ?? ""),
        landingUrl: String(row.landing_url ?? ""),
        landingHostname: String(row.landing_hostname ?? ""),
        notes: row.notes == null ? null : String(row.notes),
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? ""),
      } satisfies CampaignBriefView,
    ];
  });
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
        facebookPageId:
          typeof activeBrandProfile.facebook_page_id === "string" &&
          /^\d{1,64}$/.test(activeBrandProfile.facebook_page_id)
            ? activeBrandProfile.facebook_page_id
            : null,
        instagramActorId:
          typeof activeBrandProfile.instagram_actor_id === "string" &&
          /^\d{1,64}$/.test(activeBrandProfile.instagram_actor_id)
            ? activeBrandProfile.instagram_actor_id
            : null,
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
  const launchFacebookPages = pageAssets.map((asset) => ({
    id: String(asset.meta_asset_id),
    label: asset.name?.trim() || String(asset.meta_asset_id),
  }));
  const launchInstagramAccounts = instagramAssets.map((asset) => ({
    id: String(asset.meta_asset_id),
    label: asset.username
      ? `@${asset.username}`
      : asset.name?.trim() || String(asset.meta_asset_id),
  }));
  const killSwitchView: KillSwitchView = latestKillSwitch
    ? {
        mode: normalizeKillSwitchMode(latestKillSwitch.mode),
        reason: String(latestKillSwitch.reason),
        actorType: String(latestKillSwitch.actor_type),
        createdAt: String(latestKillSwitch.created_at),
      }
    : null;
  const boostEligibleAssets: BoostEligibleAssetView[] = [
    ...pageAssets.map((asset) => ({
      id: String(asset.id),
      assetType: "facebook_page" as const,
      label: `Facebook: ${asset.name?.trim() || asset.meta_asset_id}`,
    })),
    ...instagramAssets.map((asset) => ({
      id: String(asset.id),
      assetType: "instagram_account" as const,
      label: `Instagram: ${
        asset.username
          ? `@${asset.username}`
          : asset.name?.trim() || asset.meta_asset_id
      }`,
    })),
  ];
  const syncUsage =
    organicBoostPlannerRow?.sync_usage &&
    typeof organicBoostPlannerRow.sync_usage === "object"
      ? (organicBoostPlannerRow.sync_usage as Record<string, unknown>)
      : null;
  const organicFromUsage =
    syncUsage?.organic_boost && typeof syncUsage.organic_boost === "object"
      ? (syncUsage.organic_boost as Record<string, unknown>)
      : null;
  const organicFromColumns =
    organicBoostPlannerRow?.organic_boost_planner_detail &&
    typeof organicBoostPlannerRow.organic_boost_planner_detail === "object"
      ? (organicBoostPlannerRow.organic_boost_planner_detail as Record<
          string,
          unknown
        >)
      : null;
  const organicPlannerStatus =
    typeof organicBoostPlannerRow?.organic_boost_planner_status === "string"
      ? organicBoostPlannerRow.organic_boost_planner_status
      : typeof organicFromUsage?.status === "string"
        ? organicFromUsage.status
        : typeof organicFromColumns?.status === "string"
          ? organicFromColumns.status
          : null;
  const organicPlannerLastErrorRaw =
    organicFromColumns?.last_error ?? organicFromUsage?.last_error ?? null;
  const organicPlannerLastError =
    typeof organicPlannerLastErrorRaw === "string"
      ? organicPlannerLastErrorRaw
      : organicPlannerLastErrorRaw == null
        ? null
        : String(organicPlannerLastErrorRaw);
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
        assetScope:
          boostSettingsRow.asset_scope === "SELECTED" ? "SELECTED" : "ALL",
        assetSettings: (boostAssetSettingRows ?? []).map((row) => ({
          metaAssetId: String(row.meta_asset_id),
          included: Boolean(row.included),
          dailyBudgetMinor: toFiniteNumber(row.daily_budget_minor),
          durationDays: toFiniteNumber(row.duration_days),
        })),
        customerConfirmedAt: boostSettingsRow.customer_confirmed_at
          ? String(boostSettingsRow.customer_confirmed_at)
          : null,
      }
    : null;
  const organicBoostCampaignViewsFromRpc: OrganicBoostCampaignView[] = (
    (organicBoostCampaignRows ?? []) as Record<string, unknown>[]
  ).flatMap((row) => {
    const planId = String(row.plan_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(planId)) return [];
    const planStatus = String(row.plan_status ?? "UNKNOWN");
    const status = row.status ? String(row.status) : null;
    const effectiveStatus = row.effective_status
      ? String(row.effective_status)
      : null;
    const hasRemoteCampaignBinding = row.has_remote_campaign_binding === true;
    const anyStepRemoteApplied = row.any_step_remote_applied === true;
    const anyStepDispatchStarted = row.any_step_dispatch_started === true;
    const startTime = row.start_time ? String(row.start_time) : null;
    const endTime = row.end_time ? String(row.end_time) : null;
    const delivery = deriveOrganicBoostDelivery({
      planStatus,
      status,
      effectiveStatus,
      endTime,
      hasRemoteCampaignBinding,
      anyStepRemoteApplied,
      anyStepDispatchStarted,
    });
    const failureDetail = formatOrganicBoostFailureDetail({
      planErrorClass: row.plan_error_class
        ? String(row.plan_error_class)
        : null,
      planBlockedReason: row.plan_blocked_reason
        ? String(row.plan_blocked_reason)
        : null,
      failedStepKey: row.failed_step_key
        ? String(row.failed_step_key)
        : null,
      failedStepErrorCode: row.failed_step_error_code
        ? String(row.failed_step_error_code)
        : null,
      failedStepErrorDetail: row.failed_step_error_detail
        ? String(row.failed_step_error_detail)
        : null,
      writesAllowed: killSwitchView?.mode === "ALLOW",
    });
    return [
      {
        planId,
        planStatus,
        campaignId: row.campaign_id ? String(row.campaign_id) : null,
        campaignName: String(row.campaign_name ?? "Beitrag-Push"),
        status,
        effectiveStatus,
        deliveryState: delivery.deliveryState,
        deliveryLabel: delivery.deliveryLabel,
        failureDetail:
          delivery.deliveryState === "failed" ||
          delivery.deliveryState === "starting" ||
          delivery.deliveryState === "queued" ||
          delivery.deliveryState === "waiting_meta"
            ? failureDetail
            : null,
        budgetMode: row.budget_mode === "LIFETIME" ? "LIFETIME" : "DAILY",
        dailyBudgetMinor: toFiniteNumber(row.daily_budget_minor),
        lifetimeBudgetMinor: toFiniteNumber(row.lifetime_budget_minor),
        budgetRemainingMinor: toFiniteNumber(row.budget_remaining_minor),
        durationDays: toFiniteNumber(row.duration_days),
        startTime,
        endTime,
        spend: toFiniteNumber(row.spend),
        impressions: toFiniteNumber(row.impressions),
        postEngagements: toFiniteNumber(row.post_engagements),
        currency: String(
          row.currency ?? metaAccount?.marketing_currency ?? "EUR",
        ),
        createdAt: String(row.created_at ?? new Date().toISOString()),
      } satisfies OrganicBoostCampaignView,
    ];
  });
  const organicBoostPlanRows = [
    ...((organicBoostPlans ?? []) as Record<string, unknown>[]),
    ...((recentLaunchPlans ?? []) as Record<string, unknown>[]).filter(
      (plan) => {
        const payload =
          plan.planned_payload && typeof plan.planned_payload === "object"
            ? (plan.planned_payload as Record<string, unknown>)
            : {};
        return (
          plan.source_rule_key === "organic-boost" ||
          payload.launch_kind === "ORGANIC_BOOST"
        );
      },
    ),
  ];
  const organicBoostPlanById = new Map<string, Record<string, unknown>>();
  for (const plan of organicBoostPlanRows) {
    const id = String(plan.id ?? "");
    if (id && !organicBoostPlanById.has(id)) {
      organicBoostPlanById.set(id, plan);
    }
  }
  const organicBoostCampaignViewsFallback: OrganicBoostCampaignView[] = (
    organicBoostLinks ?? []
  ).flatMap((link) => {
    const plan = organicBoostPlanById.get(String(link.plan_id));
    if (!plan) return [];
    const payload =
      plan.planned_payload && typeof plan.planned_payload === "object"
        ? (plan.planned_payload as Record<string, unknown>)
        : {};
    if (
      payload.launch_kind !== "ORGANIC_BOOST" &&
      plan.source_rule_key !== "organic-boost"
    ) {
      return [];
    }
    const planStatus = String(plan.status ?? "UNKNOWN");
    const endTime =
      typeof payload.end_time === "string" ? payload.end_time : null;
    const delivery = deriveOrganicBoostDelivery({
      planStatus,
      status: null,
      effectiveStatus: null,
      endTime,
      hasRemoteCampaignBinding: false,
      anyStepRemoteApplied: false,
      anyStepDispatchStarted: false,
    });
    const failureDetail = formatOrganicBoostFailureDetail({
      planErrorClass: plan.error_class ? String(plan.error_class) : null,
      planBlockedReason: plan.blocked_reason
        ? String(plan.blocked_reason)
        : null,
      writesAllowed: killSwitchView?.mode === "ALLOW",
    });
    const campaignName =
      typeof payload.campaign === "object" &&
      payload.campaign !== null &&
      typeof (payload.campaign as Record<string, unknown>).name === "string"
        ? String((payload.campaign as Record<string, unknown>).name)
        : "Beitrag-Push";
    return [
      {
        planId: String(plan.id),
        planStatus,
        campaignId: null,
        campaignName,
        status: null,
        effectiveStatus: null,
        deliveryState: delivery.deliveryState,
        deliveryLabel: delivery.deliveryLabel,
        failureDetail:
          delivery.deliveryState === "failed" ||
          delivery.deliveryState === "starting" ||
          delivery.deliveryState === "queued" ||
          delivery.deliveryState === "waiting_meta"
            ? failureDetail
            : null,
        budgetMode: payload.budget_mode === "LIFETIME" ? "LIFETIME" : "DAILY",
        dailyBudgetMinor: toFiniteNumber(payload.daily_budget_minor),
        lifetimeBudgetMinor: toFiniteNumber(payload.lifetime_budget_minor),
        budgetRemainingMinor: null,
        durationDays: toFiniteNumber(payload.duration_days),
        startTime: payload.start_time ? String(payload.start_time) : null,
        endTime: payload.end_time ? String(payload.end_time) : null,
        spend: null,
        impressions: null,
        postEngagements: null,
        currency: metaAccount?.marketing_currency ?? "EUR",
        createdAt: String(
          link.created_at ?? plan.created_at ?? new Date().toISOString(),
        ),
      } satisfies OrganicBoostCampaignView,
    ];
  });
  const organicBoostCampaignViews: OrganicBoostCampaignView[] =
    organicBoostCampaignViewsFromRpc.length > 0
      ? organicBoostCampaignViewsFromRpc
      : organicBoostCampaignViewsFallback;
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
    const plan = organicBoostPlanById.get(String(link.plan_id));
    if (!plan) continue;
    const payload =
      plan.planned_payload && typeof plan.planned_payload === "object"
        ? (plan.planned_payload as Record<string, unknown>)
        : {};
    if (
      payload.launch_kind !== "ORGANIC_BOOST" &&
      plan.source_rule_key !== "organic-boost"
    ) {
      continue;
    }
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
      notBefore:
        typeof plan.not_before === "string" ? plan.not_before : null,
    });
  }
  const eligiblePendingBoostCandidates = contentCandidates.filter(
    (candidate) => {
      if (organicBoostPlanByCandidate.has(candidate.id)) {
        return false;
      }
      const override = boostOverrideByCandidate.get(candidate.id);
      if (override?.mode === "SKIP") {
        return false;
      }
      if (!boostSettingsView) {
        return true;
      }
      const source = candidate.source;
      if (
        boostSettingsView.sourceFilter !== "both" &&
        source !== boostSettingsView.sourceFilter
      ) {
        return false;
      }
      if (boostSettingsView.assetScope === "SELECTED") {
        const assetId = candidate.metaAssetId ?? "";
        const included = boostSettingsView.assetSettings.some(
          (asset) => asset.metaAssetId === assetId && asset.included,
        );
        if (!included) {
          return false;
        }
      }
      return true;
    },
  );
  const shouldAutoPlanOrganicBoost = Boolean(
    writeScopeGranted &&
      boostSettingsView?.boostMode === "AUTO" &&
      boostSettingsView.autoBoostNewCandidates &&
      killSwitchView?.mode === "ALLOW" &&
      policyView?.status === "ACTIVE" &&
      policyView.allowNewLaunches &&
      policyView.allowStatusChanges &&
      eligiblePendingBoostCandidates.length > 0,
  );
  const pendingBoostCandidateCount = eligiblePendingBoostCandidates.length;
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
  const pixelViews: ConfirmedPixelView[] = (confirmedPixelRows ?? []).flatMap(
    (pixel) => {
      if (String(pixel.status) !== "CONFIRMED") return [];
      const pixelId = String(pixel.pixel_id ?? "");
      if (!/^\d{5,25}$/.test(pixelId)) return [];
      return [
        {
          id: String(pixel.id),
          pixelId,
          label: String(pixel.label ?? ""),
          customEventType: String(pixel.custom_event_type ?? "LEAD"),
          status: "CONFIRMED" as const,
          customerConfirmedAt: pixel.customer_confirmed_at
            ? String(pixel.customer_confirmed_at)
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
      notBefore:
        typeof plan.not_before === "string" ? plan.not_before : null,
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
    pixels: pixelViews,
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
        dailyBudgetMinor: toFiniteNumber(campaign.daily_budget_minor),
        lifetimeBudgetMinor: toFiniteNumber(campaign.lifetime_budget_minor),
        budgetRemainingMinor: toFiniteNumber(campaign.budget_remaining_minor),
        startTime: campaign.start_time ? String(campaign.start_time) : null,
        stopTime: campaign.stop_time ? String(campaign.stop_time) : null,
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
  const organicBoostCampaignViewsFromLive = campaignRows
    .filter(
      (campaign) =>
        typeof campaign.name === "string" &&
        campaign.name.startsWith("Organic Boost"),
    )
    .map((campaign) => {
      // Live marketing rows are Meta-synced objects — treat as bound.
      const delivery = deriveOrganicBoostDelivery({
        planStatus: "SUCCEEDED",
        status: campaign.status ? String(campaign.status) : null,
        effectiveStatus: campaign.effectiveStatus
          ? String(campaign.effectiveStatus)
          : null,
        endTime: campaign.stopTime,
        hasRemoteCampaignBinding: true,
        anyStepRemoteApplied: true,
        anyStepDispatchStarted: true,
      });
      return {
        planId: String(campaign.id),
        planStatus: "SYNCED",
        campaignId: String(campaign.id),
        campaignName: String(campaign.name),
        status: campaign.status ? String(campaign.status) : null,
        effectiveStatus: campaign.effectiveStatus
          ? String(campaign.effectiveStatus)
          : null,
        deliveryState: delivery.deliveryState,
        deliveryLabel: delivery.deliveryLabel,
        failureDetail: null,
        budgetMode: campaign.lifetimeBudgetMinor != null ? "LIFETIME" : "DAILY",
        dailyBudgetMinor: campaign.dailyBudgetMinor,
        lifetimeBudgetMinor: campaign.lifetimeBudgetMinor,
        budgetRemainingMinor: campaign.budgetRemainingMinor,
        durationDays: null,
        startTime: campaign.startTime,
        endTime: campaign.stopTime,
        spend: campaign.spend,
        impressions: campaign.impressions,
        postEngagements: null,
        currency: campaign.currency,
        createdAt: new Date().toISOString(),
      } satisfies OrganicBoostCampaignView;
    });
  const organicBoostCampaignViewsResolved: OrganicBoostCampaignView[] = (
    organicBoostCampaignViews.length > 0
      ? organicBoostCampaignViews
      : organicBoostCampaignViewsFromLive
  ).map((campaign) => {
    // Prefer Ampel RPC metrics; if still empty, fill from the same Abruf
    // rollup used by the campaign table / dashboard totals.
    if (
      (campaign.spend != null && campaign.spend > 0) ||
      (campaign.impressions != null && campaign.impressions > 0)
    ) {
      return campaign;
    }

    const live =
      (campaign.campaignId
        ? campaignRows.find((row) => row.id === campaign.campaignId)
        : undefined) ??
      campaignRows.find((row) => row.name === campaign.campaignName);

    if (!live) {
      return campaign;
    }

    return {
      ...campaign,
      spend: live.spend ?? campaign.spend,
      impressions: live.impressions ?? campaign.impressions,
      currency: live.currency || campaign.currency,
    };
  });
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
  const dailySpendTotal = sumAvailableMetric(dailyRows, "spend");
  const accountSpendTotal = toFiniteNumber(metaAccount?.marketing_spend_total);
  // Account-level Meta rollup wins when daily ad-grain rows under-report (common
  // right after Beitrag-Push goes live).
  const totalSpend =
    accountSpendTotal != null &&
    accountSpendTotal > 0 &&
    (dailySpendTotal == null || accountSpendTotal > dailySpendTotal)
      ? accountSpendTotal
      : dailySpendTotal;
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
        <div className="px-2">
          <SiteBrandMark href="/dashboard" tone="light" />
        </div>

        <nav className="mt-10 space-y-1">
          {navigation.map(({ label, icon: Icon, href, active, external }) =>
            href ? (
              external ? (
                <a
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                  href={href}
                  key={label}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon className="size-5" />
                  <span className="flex-1">{label}</span>
                  <ExternalLink className="size-3.5 opacity-60" aria-hidden="true" />
                </a>
              ) : (
                <Link
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                  href={href}
                  key={label}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              )
            ) : (
              <span
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400"
                key={label}
              >
                <Icon className="size-5" />
                {label}
              </span>
            ),
          )}
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-100 pt-5">
          <CreditsSidebarBalance
            balance={creditBalance ? creditBalance.balance : null}
            planName={creditBalance?.planName ?? null}
            periodEnd={creditBalance?.periodEnd ?? null}
          />
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
              <SiteBrandMark href="/dashboard" size="sm" tone="light" />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <span className="lg:hidden">
                <CreditsSidebarBalance
                  balance={creditBalance ? creditBalance.balance : null}
                  compact
                />
              </span>
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

          <FunnelWorkspaceCard userEmail={user.email} />

          <FreebieWorkspaceCard userEmail={user.email} />

          {metaConnected && metaAccount ? (
            <CampaignAssistantBrief briefs={campaignBriefViews} />
          ) : null}

          {metaConnected && metaAccount ? (
            <AutomationControlCenter
              accountName={metaAccount.account_name ?? "Meta-Werbekonto"}
              auditEvents={automationAuditViews}
              automationScope={automationScopeView}
              boostEligibleAssets={boostEligibleAssets}
              boostSettings={boostSettingsView}
              brandProfile={brandProfileView}
              budgetCanaries={budgetCanaryViews}
              canPrepareBudgetCanary={canPrepareBudgetCanary}
              canConfirmBudgetCanary={canConfirmBudgetCanary}
              currency={marketingCurrency}
              facebookPages={launchFacebookPages}
              instagramAccounts={launchInstagramAccounts}
              killSwitch={killSwitchView}
              onboarding={onboardingData}
              initialTrafficAssetId={
                typeof query.assetId === "string" &&
                /^[0-9a-f-]{36}$/i.test(query.assetId)
                  ? query.assetId
                  : null
              }
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
              organicBoostCampaigns={organicBoostCampaignViewsResolved}
              organicBoostConfigured={Boolean(
                boostSettingsView &&
                  boostSettingsView.boostMode !== "OFF" &&
                  boostSettingsView.enabled,
              )}
              killSwitchMode={killSwitchView?.mode ?? null}
              organicPlannerLastError={organicPlannerLastError}
              organicPlannerStatus={organicPlannerStatus}
              pendingBoostCandidateCount={pendingBoostCandidateCount}
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

          <section className="mt-10 scroll-mt-24" id="plattformen">
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

          {metaConnected && metaAccount && contentSyncSnapshot ? (
            <MetaContentSyncPanel
              boost={{
                autoPlanEnabled: shouldAutoPlanOrganicBoost,
                boostEnabled: Boolean(boostSettingsView?.enabled),
                boostMode: boostSettingsView?.boostMode ?? "OFF",
                canApprove: Boolean(
                  writeScopeGranted &&
                    killSwitchView?.mode === "FREEZE_WRITES" &&
                    boostSettingsView?.enabled,
                ),
                canPrepare: Boolean(
                  writeScopeGranted &&
                    killSwitchView?.mode === "FREEZE_WRITES" &&
                    boostSettingsView?.enabled &&
                    policyView?.status === "ACTIVE" &&
                    policyView.allowNewLaunches,
                ),
                heldPlanByCandidate: Object.fromEntries(
                  organicBoostPlanByCandidate.entries(),
                ),
                killSwitchMode: killSwitchView?.mode ?? null,
                organicPlannerLastError: organicPlannerLastError,
                organicPlannerStatus: organicPlannerStatus,
                overrideByCandidate: Object.fromEntries(
                  boostOverrideByCandidate.entries(),
                ),
                pendingBoostCandidateIds: eligiblePendingBoostCandidates.map(
                  (candidate) => candidate.id,
                ),
                policyActive: Boolean(
                  policyView?.status === "ACTIVE" &&
                    policyView.allowNewLaunches &&
                    policyView.allowStatusChanges,
                ),
              }}
              connectedAssets={connectedAssetViews}
              initial={{
                status: contentSyncSnapshot.status,
                lastSyncStartedAt: contentSyncSnapshot.lastSyncStartedAt,
                lastSyncedAt: contentSyncSnapshot.lastSyncedAt,
                nextSyncAt: contentSyncSnapshot.nextSyncAt,
                displayNextSyncAt: contentSyncSnapshot.displayNextSyncAt,
                baselineCompleted: contentSyncSnapshot.baselineCompleted,
                seenCount: contentSyncSnapshot.seenCount,
                newCount: contentSyncSnapshot.newCount,
                storedCandidateCount: contentSyncSnapshot.storedCandidateCount,
                candidates: contentSyncSnapshot.candidates,
              }}
              reconnectRequired={reconnectRequired}
              showExtraAssetHint={showExtraAssetHint}
              writeScopeGranted={writeScopeGranted}
            />
          ) : null}
        </div>
        <SiteFooter tone="light" />
      </div>
    </main>
  );
}
