"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  Rocket,
  Save,
  Target,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type {
  AutomationOnboardingData,
  ConfirmedPixelView,
  RecentLaunchPlanView,
} from "@/components/AutomationOnboardingControls";
import {
  MetaAdAccountPicker,
  type MetaAdAccountOption,
} from "@/components/MetaAdAccountPicker";
import {
  CreativePickerModal,
  type PickerAsset,
} from "@/components/CreativePickerModal";
import type { LaunchAdActorOption } from "@/components/TrafficLaunchCanary";
import { CreativeTextVariantFields } from "@/components/CreativeTextVariantFields";
import { DynamicCreativeImagesField } from "@/components/DynamicCreativeImagesField";
import {
  fallbackCountryCode,
  toMetaAdSetTargeting,
  toMetaEmploymentAdSetTargeting,
  type MetaAdSetTargeting,
} from "@/lib/campaign-geo/adapters";
import { fetchCampaignGeoTarget } from "@/lib/campaign-geo/client";
import type { CampaignGeoTarget } from "@/lib/campaign-geo/types";
import type {
  MetaCampaignDraftPayload,
  MetaCampaignDraftView,
} from "@/lib/meta/campaign-draft-types";
import { useCampaignDraftAutosave } from "@/lib/meta/use-campaign-draft-autosave";
import { buildLinkCreativeBlueprintParts } from "@/lib/meta/creative-text-variants";
import {
  MAX_DYNAMIC_CREATIVE_IMAGES,
  normalizeLaunchAssetIds,
  resolveDynamicCreativeAssetIds,
  type LaunchLibraryAsset,
} from "@/lib/meta/creative-image-variants";
import {
  canUseQualifiedLeadOptimization,
  metaOptimizationGoal,
  type LeadPerformanceGoal,
} from "@/lib/meta/lead-performance-goal";
import {
  campaignPathForBinding,
  destinationUrlForHostname,
  type CustomerCustomDomainView,
} from "@/lib/custom-domains/types";
import { FUNNEL_SITE_URL } from "@/lib/site-urls";
import type { FunnelAdCategory, FunnelPurposeHint } from "@/lib/funnel-purpose-hint-types";

type Notice = { tone: "success" | "error"; message: string } | null;

type HeldPlan = {
  id: string;
  payloadHash: string;
  objective: string;
  destinationUrl: string;
  campaignName: string;
  adSetName: string;
  creativeName: string;
  adName: string;
  brandAssetIds: string[];
  budgetType: "DAILY";
  budgetOwnerType: "CAMPAIGN" | "AD_SET";
  dailyBudgetMinor: string;
  pixelId: string;
  customEventType: string;
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  structuralAdCount: 1 | 2;
  structuralAdSetCount?: 1 | 2;
  structuralAds?: Array<{
    message: string;
    name: string;
    description: string;
  }>;
  dynamicCreativeImages?: boolean;
  variantDestinationUrl?: string;
  useMetaExperiment?: boolean;
};

function objectiveLabel(objective: string): string {
  if (objective === "OUTCOME_LEADS") return "Lead-Generierung";
  if (objective === "OUTCOME_TRAFFIC") return "Traffic (Link-Klicks)";
  return objective;
}

function friendlyCampaignLabel(name: string): string {
  const trimmed = name.replace(/\s*\[[0-9a-f-]{8,}\]\s*$/i, "").trim();
  const withoutStamp = trimmed.replace(
    /\s+\d{4}-\d{2}-\d{2}T[\d-]+$/i,
    "",
  );
  return withoutStamp.trim() || "Lead-Kampagne";
}

type Props = {
  adAccounts?: MetaAdAccountOption[];
  brandProfileId: string | null;
  currency: string;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED";
  policyLaunchReady: boolean;
  launchPolicy: {
    accountDailyHardCapMinor: number | null;
    campaignDailyHardCapMinor: number | null;
    allowBudgetChanges: boolean;
  };
  writeScopeGranted: boolean;
  data: AutomationOnboardingData;
  /** Globale READY Custom Domains für Ziel-URL-Auswahl. */
  readyCustomDomains?: CustomerCustomDomainView[];
  funnelPurposeHints?: FunnelPurposeHint[];
  facebookPages?: LaunchAdActorOption[];
  instagramAccounts?: LaunchAdActorOption[];
  initialDestinationUrl?: string | null;
  initialFacebookPageId?: string | null;
  initialInstagramActorId?: string | null;
  campaignDraftEnabled?: boolean;
  campaignGeo?: CampaignGeoTarget | null;
  initialDraft?: MetaCampaignDraftView | null;
};

/** Lead blueprint — separate from Traffic (`LINK_CLICKS`). */
const DEFAULT_LEAD_BLUEPRINT = {
  campaign: { special_ad_categories: [] as string[] } as {
    special_ad_categories: string[];
    special_ad_category_country?: string[];
  },
  ad_set: {
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: { geo_locations: { countries: ["DE"] } } as MetaAdSetTargeting,
  },
  creative: {
    object_story_spec: {
      link_data: {
        message: "Jetzt bewerben.",
        name: "Jetzt bewerben",
        description: "",
        call_to_action: { type: "APPLY_NOW" },
      },
    },
  },
  ad: {},
};

/** Protocol-only; never shown in the customer dashboard. */
const PROTOCOL_APPROVE_REASON =
  "Kontrollierter Lead-Canary mit Funnel und bestätigtem Pixel";

const COPY_LIMITS = {
  primary: { recommended: 125, max: 500 },
  headline: { recommended: 40, max: 255 },
  description: { recommended: 30, max: 255 },
} as const;

function copyLengthHint(value: string, recommended: number, max: number): string {
  const length = value.length;
  const tone =
    length === 0
      ? "noch leer"
      : length <= recommended
        ? "im empfohlenen Bereich"
        : "länger als empfohlen — oft ok, kürzer wirkt meist klarer";
  return `${length}/${max} Zeichen · Meta empfiehlt ca. ${recommended} · ${tone}`;
}

async function apiJson<T extends Record<string, unknown> = Record<string, unknown>>(
  method: "POST" | "PUT",
  url: string,
  body: Record<string, unknown>,
): Promise<T & { ok?: boolean; message?: string }> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || !result.ok) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Die Aktion konnte nicht sicher abgeschlossen werden.",
    );
  }
  return result;
}

function guessRegistrableDomain(hostname: string): string {
  const parts = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(".");
  }
  const lastTwo = parts.slice(-2).join(".");
  const multiTld = new Set(["co.uk", "com.au", "co.at", "com.br"]);
  if (multiTld.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

function parseLandingUrl(raw: string): { href: string; hostname: string } {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") {
    throw new Error("Die Funnel-/Landingpage muss eine HTTPS-URL sein.");
  }
  if (url.username || url.password || url.port || url.hash) {
    throw new Error(
      "URL ohne Benutzer, Passwort, Port oder Hash-Fragment verwenden.",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".")) {
    throw new Error("Die URL braucht einen gültigen öffentlichen Host.");
  }
  return { href: url.toString(), hostname };
}

function normalizedDestinationKey(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin.toLowerCase()}${pathname}`;
  } catch {
    return null;
  }
}

function purposeHintForUrl(
  hints: readonly FunnelPurposeHint[],
  destinationUrl: string,
): FunnelPurposeHint | null {
  const key = normalizedDestinationKey(destinationUrl);
  if (!key) return null;
  return hints.find(hint => normalizedDestinationKey(hint.destinationUrl) === key) ?? null;
}

function displayMinor(value: string): string {
  if (!/^[0-9]+$/.test(value)) return "—";
  const padded = value.padStart(3, "0");
  return `${padded.slice(0, -2)},${padded.slice(-2)} €`;
}

function policyLimitInput(value: number | null, fallback: string): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  return (value / 100).toFixed(2);
}

function planLooksHeld(plan: RecentLaunchPlanView): boolean {
  if (plan.status === "HELD") return true;
  if (plan.status !== "PENDING") return false;
  if (!plan.notBefore) return false;
  if (plan.notBefore.toLowerCase() === "infinity") return true;
  const ms = Date.parse(plan.notBefore);
  return Number.isFinite(ms) && ms > Date.now() + 30 * 24 * 60 * 60 * 1000;
}

function toHeldFromRecent(
  plan: RecentLaunchPlanView,
  pixels: ConfirmedPixelView[],
): HeldPlan | null {
  if (
    !planLooksHeld(plan) ||
    !plan.payloadHash ||
    plan.objective !== "OUTCOME_LEADS" ||
    !plan.destinationUrl ||
    plan.targetStatus !== "ACTIVE" ||
    plan.budgetType !== "DAILY" ||
    (plan.budgetOwnerType !== "CAMPAIGN" && plan.budgetOwnerType !== "AD_SET") ||
    !plan.dailyBudgetMinor ||
    !plan.campaignName ||
    !plan.adSetName ||
    !plan.creativeName ||
    !plan.adName ||
    plan.brandAssetIds.length < 1
  ) {
    return null;
  }
  const pixel = pixels[0];
  if (!pixel) return null;
  return {
    id: plan.id,
    payloadHash: plan.payloadHash,
    objective: plan.objective,
    destinationUrl: plan.destinationUrl,
    campaignName: plan.campaignName,
    adSetName: plan.adSetName,
    creativeName: plan.creativeName,
    adName: plan.adName,
    brandAssetIds: plan.brandAssetIds,
    budgetType: "DAILY",
    budgetOwnerType: plan.budgetOwnerType,
    dailyBudgetMinor: plan.dailyBudgetMinor,
    pixelId: pixel.pixelId,
    customEventType: pixel.customEventType,
    primaryTexts: plan.primaryText ? [plan.primaryText] : [""],
    headlines: plan.headline ? [plan.headline] : [""],
    descriptions: plan.description ? [plan.description] : [""],
    structuralAdCount: 1,
    structuralAdSetCount: 1,
    dynamicCreativeImages: plan.brandAssetIds.length > 1,
  };
}

export function LeadLaunchCanary({
  adAccounts = [],
  brandProfileId,
  currency,
  launchPolicy,
  policyLaunchReady,
  writeScopeGranted,
  data,
  readyCustomDomains = [],
  funnelPurposeHints = [],
  facebookPages = [],
  instagramAccounts = [],
  initialDestinationUrl = null,
  initialFacebookPageId = null,
  initialInstagramActorId = null,
  campaignDraftEnabled = false,
  campaignGeo = null,
  initialDraft = null,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [capiPending, setCapiPending] = useState(false);
  const [policyEnsured, setPolicyEnsured] = useState(policyLaunchReady);
  const [suggestPending, setSuggestPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [prepareElapsedSec, setPrepareElapsedSec] = useState(0);
  const initialDraftPayload = initialDraft?.payload ?? null;
  const startingDestinationUrl =
    initialDraftPayload?.destinationUrl || initialDestinationUrl;
  const defaultFunnelHint = `${FUNNEL_SITE_URL}/f/`;
  const initialFunnelIndex = startingDestinationUrl
    ? funnelPurposeHints.findIndex(
        (hint) =>
          normalizedDestinationKey(hint.destinationUrl) ===
          normalizedDestinationKey(startingDestinationUrl),
      )
    : -1;
  const [destinationUrl, setDestinationUrl] = useState(() => {
    if (startingDestinationUrl) return startingDestinationUrl;
    const firstFunnel = funnelPurposeHints[0];
    if (firstFunnel) return firstFunnel.destinationUrl;
    const firstReady = readyCustomDomains[0];
    return firstReady
      ? destinationUrlForHostname(
          firstReady.hostname,
          campaignPathForBinding(firstReady.bindingKind),
        )
      : defaultFunnelHint;
  });
  const [destinationMode, setDestinationMode] = useState<string>(() =>
    initialFunnelIndex >= 0
      ? `funnel:${initialFunnelIndex}`
      : startingDestinationUrl
      ? "manual"
      : funnelPurposeHints[0]
      ? "funnel:0"
      : readyCustomDomains[0]
        ? readyCustomDomains[0].id
        : "manual",
  );
  const [adCategory, setAdCategory] = useState<FunnelAdCategory | "">(
    initialDraftPayload?.adCategory ?? "",
  );
  const preloadedPurposeHint = useMemo(
    () => purposeHintForUrl(funnelPurposeHints, destinationUrl),
    [destinationUrl, funnelPurposeHints],
  );
  const destinationKey = normalizedDestinationKey(destinationUrl);
  const [resolvedPurpose, setResolvedPurpose] = useState<{
    key: string;
    hint: FunnelPurposeHint | null;
  } | null>(null);
  useEffect(() => {
    if (preloadedPurposeHint?.metaTracking || !destinationKey) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/funnel-purpose?url=${encodeURIComponent(destinationUrl.trim())}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() : null)
        .then((result: { hint?: FunnelPurposeHint | null } | null) => {
          if (!controller.signal.aborted) setResolvedPurpose({ key: destinationKey, hint: result?.hint ?? null });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResolvedPurpose({ key: destinationKey, hint: null });
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [destinationKey, destinationUrl, preloadedPurposeHint]);
  const resolvedPurposeHint = resolvedPurpose?.key === destinationKey
    ? resolvedPurpose.hint
    : null;
  const purposeLookupPending = Boolean(
    destinationKey &&
      !preloadedPurposeHint?.metaTracking &&
      resolvedPurpose?.key !== destinationKey,
  );
  const detectedPurposeHint = preloadedPurposeHint?.metaTracking
    ? preloadedPurposeHint
    : resolvedPurposeHint ?? preloadedPurposeHint;
  const effectiveAdCategory = detectedPurposeHint?.category ?? adCategory;
  const suggestedCampaignName = `${detectedPurposeHint?.title || "Adbot Lead-Kampagne"} – ${effectiveAdCategory === "employment" ? "Recruiting" : "Meta Leads"}`;
  const [campaignNameOverride, setCampaignNameOverride] = useState<string | null>(
    initialDraftPayload?.campaignName ?? null,
  );
  const campaignName =
    campaignNameOverride === null
      ? suggestedCampaignName
      : campaignNameOverride.trim();
  const [dailyBudget, setDailyBudget] = useState(
    initialDraftPayload?.dailyBudget ?? "20.00",
  );
  const [facebookPageId, setFacebookPageId] = useState(
    initialDraftPayload?.facebookPageId &&
      facebookPages.some((page) => page.id === initialDraftPayload.facebookPageId)
      ? initialDraftPayload.facebookPageId
      : initialFacebookPageId && facebookPages.some((page) => page.id === initialFacebookPageId)
      ? initialFacebookPageId
      : (facebookPages[0]?.id ?? ""),
  );
  const [instagramActorId, setInstagramActorId] = useState(
    initialDraftPayload?.instagramActorId &&
      instagramAccounts.some((account) => account.id === initialDraftPayload.instagramActorId)
      ? initialDraftPayload.instagramActorId
      : initialInstagramActorId && instagramAccounts.some((account) => account.id === initialInstagramActorId)
      ? initialInstagramActorId
      : (instagramAccounts[0]?.id ?? ""),
  );
  const [primaryTexts, setPrimaryTexts] = useState<string[]>(
    initialDraftPayload?.primaryTexts ?? ["Jetzt mehr erfahren."],
  );
  const [headlines, setHeadlines] = useState<string[]>(
    initialDraftPayload?.headlines ?? ["Mehr erfahren"],
  );
  const [descriptions, setDescriptions] = useState<string[]>(
    initialDraftPayload?.descriptions ?? [""],
  );
  const [structuralMode, setStructuralMode] = useState<
    "off" | "two_ads" | "two_ad_sets" | "funnel_split"
  >(initialDraftPayload?.structuralMode ?? "off");
  const structuralOn = structuralMode !== "off";
  const [variantDestinationUrl, setVariantDestinationUrl] = useState(
    initialDraftPayload?.variantDestinationUrl ?? "",
  );
  const [useMetaExperiment, setUseMetaExperiment] = useState(
    initialDraftPayload?.useMetaExperiment ?? false,
  );
  const [pendingStudyPlanId, setPendingStudyPlanId] = useState<string | null>(
    null,
  );
  const [dynamicCreativeImages, setDynamicCreativeImages] = useState(
    initialDraftPayload?.dynamicCreativeImages ?? false,
  );
  const [includeFormatSiblings, setIncludeFormatSiblings] = useState(
    initialDraftPayload?.includeFormatSiblings ?? true,
  );
  const [extraAssetIds, setExtraAssetIds] = useState<string[]>(
    initialDraftPayload?.extraAssetIds ?? [],
  );
  const [ad2Primary, setAd2Primary] = useState(
    initialDraftPayload?.ad2Primary ?? "Jetzt mehr erfahren — Variante B.",
  );
  const [ad2Headline, setAd2Headline] = useState(
    initialDraftPayload?.ad2Headline ?? "Mehr erfahren",
  );
  const [ad2Description, setAd2Description] = useState(
    initialDraftPayload?.ad2Description ?? "",
  );
  const [pixelRowId, setPixelRowId] = useState(
    initialDraftPayload?.pixelRowId &&
      data.pixels.some((pixel) => pixel.id === initialDraftPayload.pixelRowId)
      ? initialDraftPayload.pixelRowId
      : (data.pixels[0]?.id ?? ""),
  );
  const [pickerAssets, setPickerAssets] = useState<PickerAsset[]>(() =>
    data.brandAssets.map((asset) => ({
      id: asset.id,
      originalFilename: asset.originalFilename,
      width: asset.width,
      height: asset.height,
      label: null,
    })),
  );
  const [assetId, setAssetId] = useState(
    initialDraftPayload?.assetId ?? data.brandAssets[0]?.id ?? "",
  );
  const libraryAssets: LaunchLibraryAsset[] = pickerAssets.map((asset) => {
    const fromDashboard = data.brandAssets.find((row) => row.id === asset.id);
    return {
      id: asset.id,
      originalFilename: asset.originalFilename,
      width: asset.width,
      height: asset.height,
      parentAssetId: fromDashboard?.parentAssetId ?? null,
      metaFormatKey: fromDashboard?.metaFormatKey ?? null,
    };
  });
  const resolvedDynamicAssets = resolveDynamicCreativeAssetIds({
    primaryId: assetId,
    extraIds: extraAssetIds,
    library: libraryAssets,
    includeFormatSiblings: dynamicCreativeImages && includeFormatSiblings,
  });
  const pickerSelectedAssetIds = normalizeLaunchAssetIds(
    [assetId, ...extraAssetIds],
    { max: MAX_DYNAMIC_CREATIVE_IMAGES },
  );
  const selectedAsset =
    pickerAssets.find((asset) => asset.id === assetId) ?? null;
  const selectedPixel =
    data.pixels.find((pixel) => pixel.id === pixelRowId) ?? data.pixels[0] ?? null;
  const needsAdAccountSelection =
    adAccounts.length > 1 && !adAccounts.some((account) => account.selectedForAds);
  const [performanceGoal, setPerformanceGoal] =
    useState<LeadPerformanceGoal>(initialDraftPayload?.performanceGoal ?? "volume");
  const qualityCapiReady = canUseQualifiedLeadOptimization(selectedPixel);
  const funnelTracking = detectedPurposeHint?.metaTracking;
  const funnelTrackingReady =
    Boolean(funnelTracking) &&
    Boolean(funnelTracking?.enabled) &&
      Boolean(selectedPixel) &&
      funnelTracking?.pixelId === selectedPixel?.pixelId;
  const [heldPlan, setHeldPlan] = useState<HeldPlan | null>(() => {
    for (const plan of data.recentLaunchPlans) {
      const held = toHeldFromRecent(plan, data.pixels);
      if (held) return held;
    }
    return null;
  });
  const prepareInFlight = pending && !heldPlan;
  const [launchSucceeded, setLaunchSucceeded] = useState(false);

  const campaignDraftPayload = useMemo<MetaCampaignDraftPayload>(
    () => ({
      campaignName: campaignName || suggestedCampaignName,
      destinationUrl,
      adCategory: effectiveAdCategory,
      dailyBudget,
      facebookPageId,
      instagramActorId,
      primaryTexts,
      headlines,
      descriptions,
      structuralMode,
      variantDestinationUrl,
      useMetaExperiment,
      dynamicCreativeImages,
      includeFormatSiblings,
      assetId,
      extraAssetIds,
      ad2Primary,
      ad2Headline,
      ad2Description,
      pixelRowId,
      performanceGoal,
      geo: campaignGeo,
    }),
    [
      ad2Description,
      ad2Headline,
      ad2Primary,
      assetId,
      campaignGeo,
      campaignName,
      dailyBudget,
      descriptions,
      destinationUrl,
      dynamicCreativeImages,
      effectiveAdCategory,
      extraAssetIds,
      facebookPageId,
      headlines,
      includeFormatSiblings,
      instagramActorId,
      performanceGoal,
      pixelRowId,
      primaryTexts,
      structuralMode,
      suggestedCampaignName,
      useMetaExperiment,
      variantDestinationUrl,
    ],
  );
  const campaignDraft = useCampaignDraftAutosave({
    enabled: campaignDraftEnabled && !launchSucceeded,
    initialDraft,
    payload: campaignDraftPayload,
  });

  const gates = useMemo(
    () => [
      { label: "Meta-Berechtigung", ready: writeScopeGranted },
      { label: "Währung EUR", ready: currency === "EUR" },
      ...(adAccounts.length > 1
        ? [{ label: "Werbekonto gewählt", ready: !needsAdAccountSelection }]
        : []),
      { label: "Pixel bestätigt", ready: Boolean(selectedPixel) },
      { label: "Conversions API", ready: qualityCapiReady },
      { label: "Ziel-URL geprüft", ready: !purposeLookupPending },
      ...(detectedPurposeHint
        ? [{ label: "Funnel-Tracking aktiv", ready: funnelTrackingReady }]
        : []),
      {
        label: "Werbemittel bereit",
        ready: pickerAssets.length > 0 || Boolean(assetId),
      },
    ],
    [
      assetId,
      adAccounts.length,
      currency,
      needsAdAccountSelection,
      performanceGoal,
      pickerAssets.length,
      qualityCapiReady,
      selectedPixel,
      funnelTracking,
      funnelTrackingReady,
      detectedPurposeHint,
      purposeLookupPending,
      writeScopeGranted,
    ],
  );
  const gatesReady = gates.every((gate) => gate.ready);

  function refresh() {
    router.refresh();
  }

  async function verifyCapiAndSyncFunnel() {
    if (!selectedPixel) return;
    if (needsAdAccountSelection) {
      setNotice({
        tone: "error",
        message:
          "Bitte wähle direkt im Bereich „Pixel und Conversions API“ zuerst das aktive Werbekonto.",
      });
      return;
    }
    setCapiPending(true);
    setNotice(null);
    try {
      const result = await apiJson<{
        capiViaConnection?: boolean;
        capiProbeStatus?: "ok" | "denied" | "error";
      }>("POST", "/api/meta/automation/pixel", {
        action: "probe",
        pixelId: selectedPixel.pixelId,
      });
      if (result.capiViaConnection !== true || result.capiProbeStatus !== "ok") {
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Die Conversions API konnte nicht bestätigt werden.",
        );
      }
      setNotice({
        tone: "success",
        message:
          "Conversions API bestätigt. Der Pixel wurde erneut sicher mit den Adbot-Funnel synchronisiert.",
      });
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Conversions API konnte nicht geprüft werden.",
      });
    } finally {
      setCapiPending(false);
    }
  }

  async function ensureCampaignLaunchPolicy() {
    if (policyLaunchReady || policyEnsured) return;
    await apiJson("POST", "/api/meta/automation/launch-policy", {
      accountDailyHardCap: policyLimitInput(
        launchPolicy.accountDailyHardCapMinor,
        "100.00",
      ),
      campaignDailyHardCap: policyLimitInput(
        launchPolicy.campaignDailyHardCapMinor,
        "50.00",
      ),
      allowBudgetChanges: launchPolicy.allowBudgetChanges,
      allowStatusChanges: true,
      allowNewLaunches: true,
      enableAutomation: true,
    });
    setPolicyEnsured(true);
  }

  useEffect(() => {
    if (!prepareInFlight) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a completed request must reset the displayed timer immediately
      setPrepareElapsedSec(0);
      return;
    }
    setPrepareElapsedSec(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setPrepareElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [prepareInFlight]);

  /**
   * No save required: reads the Funnel-URL from the form, fills the same
   * editable copy fields. Customer can edit further or prepare immediately.
   */
  async function suggestCopyFromUrl() {
    setSuggestPending(true);
    setNotice(null);
    try {
      const landing = parseLandingUrl(destinationUrl);
      const result = await apiJson<{
        primaryText?: string;
        headline?: string;
        description?: string;
        billing?: { creditsCharged?: number };
      }>("POST", "/api/meta/automation/ad-copy-suggest", {
        destinationUrl: landing.href,
        objective: "OUTCOME_LEADS",
      });
      if (!result.primaryText || !result.headline) {
        throw new Error("Server lieferte unvollständige Textvorschläge.");
      }
      setPrimaryTexts([result.primaryText]);
      setHeadlines([result.headline]);
      setDescriptions([
        typeof result.description === "string" ? result.description : "",
      ]);
      const credits =
        typeof result.billing?.creditsCharged === "number"
          ? result.billing.creditsCharged
          : null;
      setNotice({
        tone: "success",
        message:
          credits !== null
            ? `Textvorschlag eingefügt (${credits} Credits). Du kannst die Felder noch anpassen.`
            : "Textvorschlag eingefügt. Du kannst die Felder noch anpassen.",
      });
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Textvorschlag konnte nicht erzeugt werden.",
      });
    } finally {
      setSuggestPending(false);
    }
  }

  async function ensureFreeze(): Promise<void> {
    await apiJson("POST", "/api/meta/automation/kill-switch", {
      mode: "FREEZE_WRITES",
      reason: "Lead-Canary: kurze Freeze-Phase für Freigabe",
    });
  }

  /**
   * Blueprint = Rezept. Formular-Texte dieses Launches haben immer Vorrang:
   * frische Blueprint-Version mit aktuellen Copy-Feldern speichern/aktivieren.
   */
  async function ensureLeadBlueprint(): Promise<string> {
    const template = structuredClone(DEFAULT_LEAD_BLUEPRINT);
    const employment = effectiveAdCategory === "employment";
    template.ad_set.optimization_goal = metaOptimizationGoal(performanceGoal);
    const parts = buildLinkCreativeBlueprintParts({
      primaryTexts: structuralOn
        ? [primaryTexts[0] ?? (employment ? "Jetzt bewerben." : "Jetzt mehr erfahren.")]
        : primaryTexts,
      headlines: structuralOn
        ? [headlines[0] ?? (employment ? "Jetzt bewerben" : "Mehr erfahren")]
        : headlines,
      descriptions: structuralOn
        ? [descriptions[0] ?? ""]
        : descriptions,
      callToActionType: employment ? "APPLY_NOW" : "LEARN_MORE",
      defaultPrimary: employment ? "Jetzt bewerben." : "Jetzt mehr erfahren.",
      defaultHeadline: employment ? "Jetzt bewerben" : "Mehr erfahren",
      forceDynamicCreative:
        !structuralOn &&
        dynamicCreativeImages &&
        resolvedDynamicAssets.assetIds.length > 1,
    });
    template.creative.object_story_spec =
      parts.objectStorySpec as typeof template.creative.object_story_spec;
    if (!structuralOn && parts.assetFeedSpec) {
      (template.creative as Record<string, unknown>).asset_feed_spec =
        parts.assetFeedSpec;
      (template.ad_set as Record<string, unknown>).is_dynamic_creative = true;
    }
    const geo = campaignGeo ?? await fetchCampaignGeoTarget();
    if (employment) {
      template.campaign.special_ad_categories = ["EMPLOYMENT"];
      template.campaign.special_ad_category_country = [fallbackCountryCode(geo)];
      template.ad_set.targeting = toMetaEmploymentAdSetTargeting(geo);
    } else {
      template.campaign.special_ad_categories = [];
      delete template.campaign.special_ad_category_country;
      template.ad_set.targeting = toMetaAdSetTargeting(geo);
    }

    const saved = await apiJson<{ blueprintId?: string }>(
      "POST",
      "/api/meta/automation/blueprint",
      {
        action: "save",
        objective: "OUTCOME_LEADS",
        name: "Lead-Kampagne",
        payloadTemplate: template,
        requiredInputs: ["destination_url"],
      },
    );
    if (!saved.blueprintId) {
      throw new Error("Lead-Blueprint konnte nicht gespeichert werden.");
    }
    await apiJson("POST", "/api/meta/automation/blueprint", {
      action: "activate",
      blueprintId: saved.blueprintId,
    });
    return saved.blueprintId;
  }

  async function ensureDomain(hostname: string): Promise<string> {
    const existing = data.domains.find(
      (domain) =>
        domain.hostname === hostname && domain.status === "VERIFIED",
    );
    if (existing) {
      return existing.id;
    }

    const pendingDomain = data.domains.find(
      (domain) =>
        domain.hostname === hostname && domain.status === "PENDING",
    );
    if (pendingDomain) {
      const confirmed = await apiJson<{ domainId?: string }>(
        "POST",
        "/api/meta/automation/domain",
        { action: "confirm", domainId: pendingDomain.id },
      );
      if (!confirmed.domainId) {
        throw new Error("Domain-Bestätigung fehlgeschlagen.");
      }
      return confirmed.domainId;
    }

    const registered = await apiJson<{ domainId?: string }>(
      "POST",
      "/api/meta/automation/domain",
      {
        action: "register",
        hostname,
        registrableDomain: guessRegistrableDomain(hostname),
        verificationMethod: "CUSTOMER_CONFIRMATION",
      },
    );
    if (!registered.domainId) {
      throw new Error("Domain-Registrierung fehlgeschlagen.");
    }
    const confirmed = await apiJson<{ domainId?: string }>(
      "POST",
      "/api/meta/automation/domain",
      { action: "confirm", domainId: registered.domainId },
    );
    if (!confirmed.domainId) {
      throw new Error("Domain-Bestätigung fehlgeschlagen.");
    }
    return confirmed.domainId;
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      if (!gatesReady || !selectedPixel) {
        throw new Error(
          "Bitte vervollständige zuerst Meta-Berechtigung, Pixel, Conversions API, Funnel-Tracking und Werbemittel.",
        );
      }
      if (!assetId) {
        throw new Error("Bitte ein hochgeladenes Werbemittel wählen.");
      }
      if (facebookPages.length > 0 && !facebookPageId) {
        throw new Error("Bitte die Facebook-Seite für die Anzeige wählen.");
      }
      if (!effectiveAdCategory) {
        throw new Error("Bitte die Anzeigenkategorie wählen.");
      }
      if (!campaignName) {
        throw new Error("Bitte einen Kampagnennamen eingeben.");
      }

      const landing = parseLandingUrl(destinationUrl);
      const variantLanding =
        structuralMode === "funnel_split"
          ? parseLandingUrl(variantDestinationUrl)
          : null;
      if (variantLanding && variantLanding.href === landing.href) {
        throw new Error("Funnel B braucht eine andere URL als Funnel A.");
      }
      const variantPurposeHint = variantLanding
        ? purposeHintForUrl(funnelPurposeHints, variantLanding.href)
        : null;
      if (variantPurposeHint && variantPurposeHint.category !== effectiveAdCategory) {
        throw new Error("Funnel A und Funnel B müssen dieselbe Anzeigenkategorie haben.");
      }
      // Do NOT freeze here: server prepare uses a transient FREEZE window and
      // restores Freigeben so Beitrag-Push AUTO is not stranded.
      await ensureCampaignLaunchPolicy();
      const blueprintId = await ensureLeadBlueprint();
      const allowedDomainId = await ensureDomain(landing.hostname);
      const variantAllowedDomainId =
        variantLanding && variantLanding.hostname !== landing.hostname
          ? await ensureDomain(variantLanding.hostname)
          : undefined;

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const structuralAds = structuralOn
        ? [
            {
              message: (primaryTexts[0] ?? "").trim() || (effectiveAdCategory === "employment" ? "Jetzt bewerben." : "Jetzt mehr erfahren."),
              name: (headlines[0] ?? "").trim() || (effectiveAdCategory === "employment" ? "Jetzt bewerben" : "Mehr erfahren"),
              description: (descriptions[0] ?? "").trim(),
            },
            {
              message: ad2Primary.trim() || (effectiveAdCategory === "employment" ? "Jetzt bewerben — Variante B." : "Jetzt mehr erfahren — Variante B."),
              name: ad2Headline.trim() || (effectiveAdCategory === "employment" ? "Stelle sichern" : "Mehr erfahren"),
              description: ad2Description.trim(),
            },
          ]
        : undefined;
      const result = await apiJson<{
        planId?: string;
        status?: string;
        payloadHash?: string;
        objective?: string;
        destinationUrl?: string;
        targetStatus?: string;
        budgetType?: string;
        budgetOwnerType?: string;
        dailyBudgetMinor?: string;
        campaignName?: string;
        adSetName?: string;
        creativeName?: string;
        adName?: string;
        brandAssetIds?: string[];
      }>("POST", "/api/meta/automation/launch", {
        blueprintId,
        ...(brandProfileId ? { brandProfileId } : {}),
        ...(facebookPageId ? { facebookPageId } : {}),
        ...(instagramActorId ? { instagramActorId } : {}),
        brandAssetId: assetId,
        allowedDomainId,
        budgetType: "DAILY",
        budgetOwnerType: "AD_SET",
        dailyBudget,
        destinationUrl: landing.href,
        campaignName,
        adSetName: `Zielgruppe ${stamp}`,
        creativeName: `Werbemittel ${stamp}`,
        adName: `Anzeige ${stamp}`,
        pixelId: selectedPixel.pixelId,
        customEventType: selectedPixel.customEventType,
        reason: PROTOCOL_APPROVE_REASON,
        confirmation: "AKTIV-LAUNCH VORBEREITEN",
        ...(structuralOn
          ? {
              structuralAdCount: 2,
              structuralAdSetCount:
                structuralMode === "two_ad_sets" ||
                structuralMode === "funnel_split"
                  ? 2
                  : structuralMode === "two_ads"
                    ? 1
                    : undefined,
              structuralAds,
              ...(variantLanding
                ? {
                    variantDestinationUrl: variantLanding.href,
                    ...(variantAllowedDomainId
                      ? { variantAllowedDomainId }
                      : {}),
                  }
                : {}),
              ...(useMetaExperiment &&
              (structuralMode === "two_ad_sets" ||
                structuralMode === "funnel_split")
                ? { useMetaExperiment: true }
                : {}),
            }
          : dynamicCreativeImages
            ? {
                useDynamicCreativeImages: true,
                extraBrandAssetIds: extraAssetIds.filter(
                  (id) => id !== assetId,
                ),
                includeFormatSiblings,
              }
            : {}),
      });

      if (
        !result.planId ||
        result.status !== "HELD" ||
        !result.payloadHash ||
        result.objective !== "OUTCOME_LEADS" ||
        !result.destinationUrl ||
        result.targetStatus !== "ACTIVE" ||
        result.budgetType !== "DAILY" ||
        (result.budgetOwnerType !== "CAMPAIGN" &&
          result.budgetOwnerType !== "AD_SET") ||
        !result.dailyBudgetMinor ||
        !result.campaignName ||
        !result.adSetName ||
        !result.creativeName ||
        !result.adName ||
        !result.brandAssetIds?.length
      ) {
        throw new Error("Server lieferte keine vollständige HELD-Vorschau.");
      }

      setHeldPlan({
        id: result.planId,
        payloadHash: result.payloadHash,
        objective: result.objective,
        destinationUrl: result.destinationUrl,
        campaignName: result.campaignName,
        adSetName: result.adSetName,
        creativeName: result.creativeName,
        adName: result.adName,
        brandAssetIds: result.brandAssetIds,
        budgetType: "DAILY",
        budgetOwnerType: result.budgetOwnerType,
        dailyBudgetMinor: result.dailyBudgetMinor,
        pixelId: selectedPixel.pixelId,
        customEventType: selectedPixel.customEventType,
        primaryTexts: structuralOn
          ? [structuralAds![0].message]
          : primaryTexts,
        headlines: structuralOn
          ? [structuralAds![0].name]
          : headlines,
        descriptions: structuralOn
          ? [structuralAds![0].description]
          : descriptions,
        structuralAdCount: structuralOn ? 2 : 1,
        ...(structuralMode === "two_ad_sets"
          ? { structuralAdSetCount: 2 as const }
          : structuralMode === "two_ads"
            ? { structuralAdSetCount: 1 as const }
            : {}),
        ...(structuralOn ? { structuralAds } : {}),
        dynamicCreativeImages:
          !structuralOn &&
          (dynamicCreativeImages || result.brandAssetIds.length > 1),
        ...(variantLanding
          ? { variantDestinationUrl: variantLanding.href }
          : {}),
        ...(useMetaExperiment &&
        (structuralMode === "two_ad_sets" || structuralMode === "funnel_split")
          ? { useMetaExperiment: true }
          : {}),
      });
      setNotice({
        tone: "success",
        message:
          "Lead-Plan vorbereitet (noch nichts an Meta). Prüfe die Vorschau unten und starte mit Freigabe.",
      });
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Kampagne konnte nicht vorbereitet werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!heldPlan) return;
    setPending(true);
    setNotice(null);
    try {
      await ensureCampaignLaunchPolicy();
      await ensureFreeze();
      const result = await apiJson<{
        planStatus?: string;
        approvalId?: string;
        executionWarning?: string | null;
        executorSucceeded?: number;
      }>("PUT", "/api/meta/automation/launch", {
        planId: heldPlan.id,
        payloadHash: heldPlan.payloadHash,
        objective: heldPlan.objective,
        destinationUrl: heldPlan.destinationUrl,
        targetStatus: "ACTIVE",
        budgetType: "DAILY",
        budgetOwnerType: heldPlan.budgetOwnerType,
        dailyBudgetMinor: heldPlan.dailyBudgetMinor,
        campaignName: heldPlan.campaignName,
        adSetName: heldPlan.adSetName,
        creativeName: heldPlan.creativeName,
        adName: heldPlan.adName,
        reason: PROTOCOL_APPROVE_REASON,
        confirmation: "AKTIV-LAUNCH FREIGEBEN",
      });
      if (!result.approvalId || result.planStatus !== "PENDING") {
        throw new Error("Freigabe wurde vom Server nicht bestätigt.");
      }
      const studyPlanId = heldPlan.useMetaExperiment ? heldPlan.id : null;
      setHeldPlan(null);
      let experimentNote = "";
      if (studyPlanId) {
        setPendingStudyPlanId(studyPlanId);
        if (result.executorSucceeded === 1) {
          try {
            const study = await apiJson<{ studyId?: string }>(
              "POST",
              "/api/meta/automation/ad-study",
              { planId: studyPlanId },
            );
            if (study.studyId) {
              experimentNote = ` Meta-Experiment ${study.studyId} angelegt.`;
              setPendingStudyPlanId(null);
            }
          } catch (error) {
            experimentNote = ` Meta-Experiment noch nicht angelegt: ${
              error instanceof Error ? error.message : "bitte später erneut versuchen"
            }`;
          }
        } else {
          experimentNote =
            " Meta-Experiment folgt, sobald beide Ad Sets bei Meta stehen — Button unten.";
        }
      }
      if (
        typeof result.executionWarning === "string" &&
        result.executionWarning.trim()
      ) {
        setLaunchSucceeded(false);
        setNotice({
          tone: "error",
          message: `${result.executionWarning.trim()}${experimentNote}`,
        });
      } else {
        let draftWarning = "";
        try {
          await campaignDraft.markLaunched();
        } catch {
          draftWarning = " Der gestartete Entwurf konnte nicht aus der Entwurfsliste entfernt werden.";
        }
        if (result.executorSucceeded === 1) {
        setLaunchSucceeded(true);
        setNotice({
          tone: "success",
          message:
            `Kampagne bei Meta angelegt und aktiviert. Prüfe im Werbeanzeigenmanager Kampagne, Anzeigengruppe und Anzeige.${experimentNote}${draftWarning}`,
        });
        } else {
          setLaunchSucceeded(true);
          setNotice({
            tone: "success",
            message:
              `Kampagne freigegeben. Adbot legt sie bei Meta an und schaltet sie aktiv — das kann kurz dauern. Schau im Werbeanzeigenmanager nach Kampagne und Anzeige.${experimentNote}${draftWarning}`,
          });
        }
      }
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Kampagne konnte nicht gestartet werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function retryMetaExperiment() {
    if (!pendingStudyPlanId) return;
    setPending(true);
    try {
      const study = await apiJson<{ studyId?: string }>(
        "POST",
        "/api/meta/automation/ad-study",
        { planId: pendingStudyPlanId },
      );
      if (!study.studyId) {
        throw new Error("Meta hat keine Experiment-ID zurückgegeben.");
      }
      setPendingStudyPlanId(null);
      setNotice({
        tone: "success",
        message: `Meta-Experiment ${study.studyId} angelegt.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Meta-Experiment konnte nicht angelegt werden.",
      });
    } finally {
      setPending(false);
    }
  }

  function startAnotherLeadCampaign() {
    campaignDraft.resetDraft();
    setLaunchSucceeded(false);
    setHeldPlan(null);
    setPendingStudyPlanId(null);
    setNotice(null);
    setCampaignNameOverride(null);
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";
  const buttonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section
      className="border-t border-slate-200 bg-slate-50/40 px-5 py-7 sm:px-7"
      id="lead-launch"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
          <Target className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
            Meta-Kampagne
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            2. Anzeige gestalten und Kampagne starten
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Adbot hat den gewählten Funnel bereits übernommen. Ergänze Werbemittel,
            Anzeigentexte und Budget. Pixel, Lead-Event und Anzeigenkategorie werden
            geprüft, bevor du die Kampagne startest.
          </p>
          {campaignDraftEnabled ? (
            <p
              className={`mt-2 text-xs font-semibold ${
                campaignDraft.state === "error" ? "text-rose-700" : "text-slate-500"
              }`}
              role="status"
            >
              {campaignDraft.state === "saving"
                ? "Entwurf wird gespeichert …"
                : campaignDraft.state === "error"
                  ? "Automatisches Speichern fehlgeschlagen — bitte unten erneut speichern."
                  : campaignDraft.state === "saved"
                    ? "Entwurf gespeichert · Fortsetzung unter Kampagnen > Entwürfe"
                    : "Änderungen werden automatisch als Entwurf gespeichert."}
            </p>
          ) : null}
        </div>
      </div>

      {launchSucceeded ? (
        <div
          className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-extrabold text-emerald-950">
                Erledigt — Kampagne ist live
              </h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-emerald-900">
                {notice?.tone === "success"
                  ? notice.message
                  : "Kampagne bei Meta angelegt und aktiviert. Prüfe im Werbeanzeigenmanager Kampagne, Anzeigengruppe und Anzeige."}
              </p>
              {pendingStudyPlanId ? (
                <button
                  className={`${buttonClass} mt-5`}
                  disabled={pending}
                  onClick={() => void retryMetaExperiment()}
                  type="button"
                >
                  {pending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <PlayCircle className="size-4" />
                  )}
                  Meta-Experiment erneut versuchen
                </button>
              ) : null}
              <button
                className={`${buttonClass} mt-5`}
                disabled={pending}
                onClick={startAnotherLeadCampaign}
                type="button"
              >
                <Rocket className="size-4" />
                Weitere Lead-Kampagne starten
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>

      <ul className="mt-5 flex flex-wrap gap-2">
        {gates.map((gate) => (
          <li
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
              gate.ready
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800"
            }`}
            key={gate.label}
          >
            {gate.ready ? (
              <Check className="size-3.5" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            {gate.label}
          </li>
        ))}
      </ul>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            qualityCapiReady
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <p className="font-extrabold">Pixel und Conversions API</p>
          {selectedPixel ? (
            <p className="mt-1 text-xs leading-5">
              {selectedPixel.label || "Meta Pixel"} · {selectedPixel.pixelId} ·{" "}
              {qualityCapiReady
                ? "Browser-Pixel und serverseitige Lead-Meldung sind bereit."
                : "Die serverseitige Lead-Meldung muss einmal geprüft werden."}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-5">
              Wähle oder bestätige oben auf dieser Seite zuerst ein Meta Pixel.
            </p>
          )}
          {adAccounts.length > 1 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 px-3 py-3">
              <p className="text-xs font-extrabold text-slate-900">
                Aktives Werbekonto für diese Prüfung
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Wähle hier das Werbekonto aus. Danach kann Adbot die Conversions API
                und die zugehörigen Kampagnendaten eindeutig prüfen.
              </p>
              <MetaAdAccountPicker accounts={adAccounts} compact />
            </div>
          ) : null}
          {selectedPixel &&
          (!qualityCapiReady || Boolean(detectedPurposeHint && !funnelTrackingReady)) ? (
            <button
              className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              disabled={capiPending || pending || needsAdAccountSelection}
              onClick={() => void verifyCapiAndSyncFunnel()}
              type="button"
            >
              {capiPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {capiPending
                ? "Wird geprüft …"
                : needsAdAccountSelection
                  ? "Zuerst Werbekonto wählen"
                : qualityCapiReady
                  ? "Funnel-Tracking synchronisieren"
                  : "Conversions API jetzt prüfen"}
            </button>
          ) : null}
        </div>
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            !detectedPurposeHint || !funnelTracking
              ? "border-slate-200 bg-slate-50 text-slate-800"
              : funnelTrackingReady
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          <p className="font-extrabold">Funnel-Tracking</p>
          <p className="mt-1 text-xs leading-5">
            {!detectedPurposeHint
              ? "Die Ziel-URL wird geprüft, sobald ein Adbot-Funnel erkannt wird."
              : !funnelTracking
                ? "Der Trackingstatus dieses Funnels wird gerade geladen."
                : funnelTrackingReady
                ? `Im Funnel „${detectedPurposeHint.title}“ sind Pixel und Lead-Event aktiv.`
                : "Tracking ist im gewählten Funnel noch nicht mit diesem Pixel aktiv. Starte links die Prüfung beziehungsweise Synchronisierung; Adbot aktualisiert den Funnel dabei automatisch."}
          </p>
        </div>
      </div>

      {notice && !heldPlan ? (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-800"
          }`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}

      <form className="mt-6 grid gap-4 lg:grid-cols-2" onSubmit={prepare}>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Kampagnenname
          <input
            className={inputClass}
            disabled={pending || Boolean(heldPlan)}
            maxLength={240}
            onBlur={() => {
              if (campaignNameOverride !== null && !campaignNameOverride.trim()) {
                setCampaignNameOverride(null);
              }
            }}
            onChange={(event) => setCampaignNameOverride(event.target.value)}
            required
            value={campaignNameOverride ?? suggestedCampaignName}
          />
          <span className="mt-1 block text-xs font-medium text-slate-500">
            Dieser Name wird für die Kampagne im Meta Werbeanzeigenmanager verwendet.
            Ohne Änderung schlägt Adbot einen Namen aus dem gewählten Funnel vor;
            zur sicheren technischen Zuordnung ergänzt Adbot nur eine kurze Kennung.
          </span>
        </label>
        {facebookPages.length > 0 ? (
          <label className="text-sm font-bold text-slate-800">
            Facebook-Seite (Werbetreibender)
            <select
              className={inputClass}
              disabled={pending}
              onChange={(event) => setFacebookPageId(event.target.value)}
              required
              value={facebookPageId}
            >
              {facebookPages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {instagramAccounts.length > 0 ? (
          <label className="text-sm font-bold text-slate-800">
            Instagram-Konto{" "}
            <span className="font-medium text-slate-500">(empfohlen)</span>
            <select
              className={inputClass}
              disabled={pending}
              onChange={(event) => setInstagramActorId(event.target.value)}
              value={instagramActorId}
            >
              <option value="">Ohne Instagram-Platzierung</option>
              {instagramAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-sm font-bold text-slate-800">
          Bestätigtes Pixel
          <select
            className={inputClass}
            disabled={pending || data.pixels.length === 0}
            onChange={(event) => setPixelRowId(event.target.value)}
            required
            value={selectedPixel?.id ?? ""}
          >
            {data.pixels.length === 0 ? (
              <option value="">Zuerst oben auf dieser Seite bestätigen</option>
            ) : (
              data.pixels.map((pixel) => (
                <option key={pixel.id} value={pixel.id}>
                  {pixel.label || "Pixel"} · {pixel.pixelId} ·{" "}
                  {pixel.customEventType}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-sm font-bold text-slate-800">
          Tagesbudget (EUR)
          <input
            className={inputClass}
            disabled={pending}
            inputMode="decimal"
            onChange={(event) => setDailyBudget(event.target.value)}
            placeholder="20.00"
            required
            value={dailyBudget}
          />
        </label>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Performance-Ziel
          <select
            className={inputClass}
            disabled={pending}
            onChange={(event) =>
              setPerformanceGoal(event.target.value as LeadPerformanceGoal)
            }
            value={performanceGoal}
          >
            <option value="volume">Möglichst viele Leads (Start ohne Qualitätsdaten)</option>
            <option disabled={!qualityCapiReady} value="quality">
              Möglichst viele qualifizierte Leads (CAPI-Feedback aktiv)
            </option>
          </select>
          <span className="mt-1 block text-xs font-medium text-slate-500">
            {performanceGoal === "quality"
              ? "Meta optimiert dieses neue Ad Set auf Personen, die nach dem Absenden als guter Lead bewertet werden."
              : qualityCapiReady
                ? "Für neue Kampagnen mit genügend Bewertungsdaten kannst du später „qualifizierte Leads“ wählen. Bestehende Ad Sets werden nicht automatisch verändert."
                : "Für den Start ohne Historie korrekt. Prüfe die Conversions API direkt oben, bevor du später auf qualifizierte Leads umstellst."}
          </span>
        </label>
        <fieldset className="rounded-xl border border-slate-200 bg-white px-4 py-3 lg:col-span-2">
          <legend className="px-1 text-sm font-bold text-slate-800">Zielgruppe</legend>
          <p className="text-sm font-semibold text-slate-900">
            Automatische Zielgruppenfindung durch Meta
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Standardmäßig schränkt Adbot Interessen, Alter oder Geschlecht nicht ein.
            Meta optimiert innerhalb des oben gewählten Zielgebiets auf Personen, die
            den Funnel voraussichtlich abschließen. Bei Jobanzeigen gelten automatisch
            die Regeln der Kategorie EMPLOYMENT.
          </p>
        </fieldset>
        <div className="text-sm font-bold text-slate-800">
          Werbemittel
          <button
            className="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-300 bg-white p-3 text-left transition hover:border-blue-400 hover:bg-slate-50 disabled:opacity-50"
            disabled={pending}
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
              {selectedAsset ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="size-full object-cover"
                  src={`/api/media-library/preview?assetId=${selectedAsset.id}`}
                />
              ) : (
                <span className="grid size-full place-items-center text-slate-400">
                  <ImagePlus className="size-5" />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-extrabold text-slate-950">
                {pickerSelectedAssetIds.length > 1
                  ? `${pickerSelectedAssetIds.length} Werbemittel ausgewählt`
                  : selectedAsset
                    ? selectedAsset.originalFilename
                    : "Werbemittel wählen oder hochladen"}
              </span>
              {pickerSelectedAssetIds.length > 1 ? (
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  Gemeinsame Dynamic Creative · Meta optimiert die Motivausspielung
                </span>
              ) : selectedAsset?.width && selectedAsset?.height ? (
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {selectedAsset.width}×{selectedAsset.height}
                </span>
              ) : null}
            </span>
          </button>
        </div>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Ausgewählter Funnel
          <select
            className={inputClass}
            disabled={pending || suggestPending}
            onChange={(event) => {
              const value = event.target.value;
              setDestinationMode(value);
              if (value.startsWith("funnel:")) {
                const selectedFunnel = funnelPurposeHints[Number(value.slice(7))];
                if (selectedFunnel) setDestinationUrl(selectedFunnel.destinationUrl);
                return;
              }
              if (value === "manual") {
                setDestinationUrl(defaultFunnelHint);
                return;
              }
              const selected = readyCustomDomains.find(
                (domain) => domain.id === value,
              );
              if (selected) {
                setDestinationUrl(
                  destinationUrlForHostname(
                    selected.hostname,
                    campaignPathForBinding(selected.bindingKind),
                  ),
                );
              }
            }}
            value={destinationMode}
          >
            {funnelPurposeHints.map((hint, index) => (
              <option key={`${hint.destinationUrl}:${index}`} value={`funnel:${index}`}>
                {hint.title} · {hint.category === "employment" ? "Jobanzeige" : "Lead-Funnel"}
              </option>
            ))}
            {readyCustomDomains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.hostname}
                {domain.label ? ` (${domain.label})` : ""}
              </option>
            ))}
            <option value="manual">
              {readyCustomDomains.length > 0
                ? "Andere URL eingeben…"
                : `Shared Funnel (${FUNNEL_SITE_URL.replace(/^https?:\/\//, "")}/f/…)`}
            </option>
          </select>
          {readyCustomDomains.length === 0 ? (
            <span className="mt-1 block text-xs font-medium text-slate-500">
              Noch keine verbundene Custom Domain —{" "}
              <a
                className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                href="/dashboard/domains"
              >
                unter Domains verbinden
              </a>
              .
            </span>
          ) : (
            <span className="mt-1 block text-xs font-medium text-slate-500">
              Verbundene Domains aus der globalen Domains-Seite. Pfad in der URL
              unten bei Bedarf anpassen.
            </span>
          )}
        </label>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Ziel-URL (HTTPS)
          <input
            className={inputClass}
            disabled={pending || suggestPending}
            onChange={(event) => {
              setDestinationMode("manual");
              setDestinationUrl(event.target.value);
            }}
            placeholder={`${FUNNEL_SITE_URL}/f/dein-slug`}
            required
            type="url"
            value={destinationUrl}
          />
          <span className="mt-1 block text-xs font-medium text-slate-500">
            Veröffentlichter Funnel oder Custom Domain. Domain muss in Meta für
            Conversion-Tracking passen (wird beim Launch geprüft).
          </span>
        </label>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Anzeigenkategorie
          <select
            className={inputClass}
            disabled={pending || suggestPending || Boolean(detectedPurposeHint)}
            onChange={(event) => setAdCategory(event.target.value as FunnelAdCategory)}
            required
            value={effectiveAdCategory}
          >
            <option disabled value="">Bitte auswählen …</option>
            <option value="standard">Normale Lead-Kampagne</option>
            <option value="employment">Social Recruiting / Jobanzeige (EMPLOYMENT)</option>
          </select>
          <span className="mt-1 block text-xs font-medium text-slate-500">
            {detectedPurposeHint
              ? `Automatisch aus dem Funnel „${detectedPurposeHint.title}“ übernommen.`
              : effectiveAdCategory === "employment"
                ? "Adbot setzt EMPLOYMENT und erweitert kleinere Umkreise automatisch auf mindestens 17 km."
                : effectiveAdCategory === "standard"
                  ? "Keine Meta-Sonderkategorie; die normale regionale Einstellung bleibt unverändert."
                  : "Bei Adbot-Funnel wird die Auswahl künftig automatisch aus dem Funnel-Zweck übernommen."}
          </span>
        </label>
        <div className="lg:col-span-2">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              pending ||
              suggestPending ||
              !destinationUrl.trim() ||
              Boolean(heldPlan)
            }
            onClick={() => void suggestCopyFromUrl()}
            type="button"
          >
            {suggestPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Textvorschlag aus URL
          </button>
        </div>
        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 lg:col-span-2">
          <legend className="px-1 text-sm font-bold text-slate-800">
            Anzeigenvarianten
          </legend>
          <p className="mt-1 text-xs font-medium text-slate-500">
            Optional getrennte Anzeigen statt Dynamic Creative. Standard bleibt
            eine Anzeige. Nicht kombinierbar mit mehreren Motiven.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
            {(
              [
                { value: "off" as const, label: "Aus" },
                { value: "two_ads" as const, label: "2 Anzeigen" },
                { value: "two_ad_sets" as const, label: "2 Ad Sets" },
                {
                  value: "funnel_split" as const,
                  label: "Zwei Funnel vergleichen",
                },
              ] as const
            ).map((option) => (
              <label
                className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800"
                key={option.value}
              >
                <input
                  checked={structuralMode === option.value}
                  className="size-4 border-slate-300 text-blue-700 focus:ring-blue-500"
                  disabled={
                    pending ||
                    Boolean(heldPlan) ||
                    (dynamicCreativeImages && option.value !== "off")
                  }
                  name="structural-mode-lead"
                  onChange={() => {
                    setStructuralMode(option.value);
                    if (option.value !== "off") {
                      setDynamicCreativeImages(false);
                      setExtraAssetIds([]);
                    }
                  }}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </div>
          {structuralMode === "two_ads" ? (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Eine Kampagne, eine Anzeigengruppe, zwei getrennte Anzeigen mit
              gleichem Bild und unterschiedlichem Text. Deaktiviert Textvarianten
              (Dynamic Creative).
            </p>
          ) : null}
          {structuralMode === "two_ad_sets" ? (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Eine Kampagne, zwei Anzeigengruppen, je eine Anzeige.
              Startbudget wird zunächst aufgeteilt; danach schichtet Adbot nach
              Erfolg um (Summe bleibt gleich). Deaktiviert Textvarianten
              (Dynamic Creative).
            </p>
          ) : null}
          {structuralMode === "funnel_split" ? (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Vergleich zweier Funnel: eine Kampagne, zwei Anzeigengruppen, je eine
              Anzeige mit eigener Funnel-URL. Das Startbudget wird zunächst hälftig
              aufgeteilt; danach schichtet Adbot nach Erfolg um. Deaktiviert Textvarianten
              (Dynamic Creative).
            </p>
          ) : null}
          {structuralMode === "funnel_split" ? (
            <label className="mt-3 block text-sm font-bold text-slate-800">
              Funnel B (HTTPS)
              <input
                className={inputClass}
                disabled={pending || Boolean(heldPlan)}
                onChange={(event) =>
                  setVariantDestinationUrl(event.target.value)
                }
                placeholder={`${FUNNEL_SITE_URL}/f/variante-b`}
                required
                type="url"
                value={variantDestinationUrl}
              />
            </label>
          ) : null}
          {structuralMode === "two_ad_sets" ||
          structuralMode === "funnel_split" ? (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-800">
              <input
                checked={useMetaExperiment}
                className="mt-0.5 size-4 border-slate-300 text-blue-700 focus:ring-blue-500"
                disabled={pending || Boolean(heldPlan)}
                onChange={(event) => setUseMetaExperiment(event.target.checked)}
                type="checkbox"
              />
              <span>
                Offizielles Meta-Experiment nach dem Launch versuchen
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  Best effort: legt ein SPLIT_TEST um die beiden Ad Sets. Der
                  Launch bleibt bestehen, wenn Meta das Experiment ablehnt.
                </span>
              </span>
            </label>
          ) : null}
        </fieldset>
        {!structuralOn ? (
          <DynamicCreativeImagesField
            assets={libraryAssets}
            disabled={pending || Boolean(heldPlan)}
            enabled={dynamicCreativeImages}
            extraAssetIds={extraAssetIds}
            includeFormatSiblings={includeFormatSiblings}
            onEnabledChange={(enabled) => {
              setDynamicCreativeImages(enabled);
              if (!enabled) setExtraAssetIds([]);
            }}
            onExtraAssetIdsChange={setExtraAssetIds}
            onIncludeFormatSiblingsChange={setIncludeFormatSiblings}
            primaryAssetId={assetId}
          />
        ) : null}
        {structuralOn ? (
          <>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <p className="text-sm font-extrabold text-slate-900">Anzeige 1</p>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Anzeigentext (Primary Text)
                </span>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  disabled={pending}
                  maxLength={COPY_LIMITS.primary.max}
                  onChange={(event) =>
                    setPrimaryTexts([event.target.value])
                  }
                  required
                  value={primaryTexts[0] ?? ""}
                />
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {copyLengthHint(
                    primaryTexts[0] ?? "",
                    COPY_LIMITS.primary.recommended,
                    COPY_LIMITS.primary.max,
                  )}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Überschrift (Headline)
                </span>
                <input
                  className={inputClass}
                  disabled={pending}
                  maxLength={COPY_LIMITS.headline.max}
                  onChange={(event) => setHeadlines([event.target.value])}
                  required
                  value={headlines[0] ?? ""}
                />
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {copyLengthHint(
                    headlines[0] ?? "",
                    COPY_LIMITS.headline.recommended,
                    COPY_LIMITS.headline.max,
                  )}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Beschreibung{" "}
                  <span className="font-medium text-slate-500">(optional)</span>
                </span>
                <input
                  className={inputClass}
                  disabled={pending}
                  maxLength={COPY_LIMITS.description.max}
                  onChange={(event) => setDescriptions([event.target.value])}
                  value={descriptions[0] ?? ""}
                />
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {copyLengthHint(
                    descriptions[0] ?? "",
                    COPY_LIMITS.description.recommended,
                    COPY_LIMITS.description.max,
                  )}
                </span>
              </label>
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
              <p className="text-sm font-extrabold text-slate-900">Anzeige 2</p>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Anzeigentext (Primary Text)
                </span>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  disabled={pending}
                  maxLength={COPY_LIMITS.primary.max}
                  onChange={(event) => setAd2Primary(event.target.value)}
                  required
                  value={ad2Primary}
                />
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {copyLengthHint(
                    ad2Primary,
                    COPY_LIMITS.primary.recommended,
                    COPY_LIMITS.primary.max,
                  )}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Überschrift (Headline)
                </span>
                <input
                  className={inputClass}
                  disabled={pending}
                  maxLength={COPY_LIMITS.headline.max}
                  onChange={(event) => setAd2Headline(event.target.value)}
                  required
                  value={ad2Headline}
                />
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {copyLengthHint(
                    ad2Headline,
                    COPY_LIMITS.headline.recommended,
                    COPY_LIMITS.headline.max,
                  )}
                </span>
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Beschreibung{" "}
                  <span className="font-medium text-slate-500">(optional)</span>
                </span>
                <input
                  className={inputClass}
                  disabled={pending}
                  maxLength={COPY_LIMITS.description.max}
                  onChange={(event) => setAd2Description(event.target.value)}
                  value={ad2Description}
                />
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {copyLengthHint(
                    ad2Description,
                    COPY_LIMITS.description.recommended,
                    COPY_LIMITS.description.max,
                  )}
                </span>
              </label>
            </div>
          </>
        ) : (
          <>
            <CreativeTextVariantFields
              disabled={pending}
              hint="eine Anzeige, Meta kombiniert die Texte"
              inputClass={inputClass}
              label="Anzeigentext (Primary Text)"
              lengthHint={copyLengthHint}
              maxLength={COPY_LIMITS.primary.max}
              multiline
              onChange={setPrimaryTexts}
              recommended={COPY_LIMITS.primary.recommended}
              values={primaryTexts}
            />
            <CreativeTextVariantFields
              disabled={pending}
              hint="Varianten für dieselbe Anzeige"
              inputClass={inputClass}
              label="Überschrift (Headline)"
              lengthHint={copyLengthHint}
              maxLength={COPY_LIMITS.headline.max}
              onChange={setHeadlines}
              recommended={COPY_LIMITS.headline.recommended}
              values={headlines}
            />
            <CreativeTextVariantFields
              disabled={pending}
              hint="optional"
              inputClass={inputClass}
              label="Beschreibung"
              lengthHint={copyLengthHint}
              maxLength={COPY_LIMITS.description.max}
              onChange={setDescriptions}
              optional
              recommended={COPY_LIMITS.description.recommended}
              values={descriptions}
            />
          </>
        )}
        {prepareInFlight ? (
          <div
            className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-950 lg:col-span-2"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-blue-700" />
            <div className="min-w-0 space-y-1">
              <p className="font-extrabold">Kampagne wird vorbereitet…</p>
              <p className="font-medium leading-6 text-blue-900/90">
                Adbot legt die Launch-Vorschau an. Meist dauert das nur wenige
                Sekunden — bitte diese Seite nicht schließen.
              </p>
              {prepareElapsedSec >= 20 ? (
                <p className="text-xs font-bold text-blue-800">
                  Noch aktiv ({prepareElapsedSec}s). Falls Meta-Kontodaten fehlen,
                  läuft ein kurzer Abgleich mit — bitte warten.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:col-span-2">
          <button
            className={buttonClass}
            disabled={pending || !gatesReady || !assetId || Boolean(heldPlan)}
            type="submit"
          >
            {prepareInFlight ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            {prepareInFlight ? "Bitte warten…" : "Vorschau erstellen"}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            disabled={pending}
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <ImagePlus className="size-4" />
            Werbemittel wechseln
          </button>
          {campaignDraftEnabled ? (
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              disabled={pending || campaignDraft.state === "saving"}
              onClick={() => {
                void campaignDraft.saveNow().catch((error) => {
                  setNotice({
                    tone: "error",
                    message:
                      error instanceof Error
                        ? error.message
                        : "Der Entwurf konnte nicht gespeichert werden.",
                  });
                });
              }}
              type="button"
            >
              {campaignDraft.state === "saving" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Entwurf speichern
            </button>
          ) : null}
        </div>
      </form>

      <CreativePickerModal
        assets={pickerAssets}
        brandProfileId={brandProfileId}
        maxSelected={MAX_DYNAMIC_CREATIVE_IMAGES}
        multiSelect
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => setAssetId(id)}
        onSelectionChange={(ids) => {
          setAssetId(ids[0] ?? "");
          setExtraAssetIds(ids.slice(1));
          setDynamicCreativeImages(ids.length > 1);
          if (ids.length > 1) setStructuralMode("off");
        }}
        onUploaded={({ assets }) => {
          setPickerAssets((previous) => {
            const map = new Map(previous.map((asset) => [asset.id, asset]));
            for (const asset of assets) {
              map.set(asset.id, asset);
            }
            return [...map.values()];
          });
          refresh();
        }}
        open={pickerOpen}
        selectedAssetId={assetId || null}
        selectedAssetIds={pickerSelectedAssetIds}
      />

      {heldPlan ? (
        <form
          className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/40 p-5"
          onSubmit={approve}
        >
          <h3 className="text-sm font-extrabold text-slate-950">
            Vorschau prüfen
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            So geht die Anzeige live — noch nichts ist bei Meta angelegt.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Werbemittel-Vorschau"
                  className="aspect-square w-full object-cover"
                  src={`/api/media-library/preview?assetId=${heldPlan.brandAssetIds[0]}`}
                />
              </div>
              {heldPlan.brandAssetIds.length > 1 ? (
                <div className="grid grid-cols-3 gap-2">
                  {heldPlan.brandAssetIds.slice(1).map((id) => (
                    <div
                      className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                      key={id}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Weiteres Motiv"
                        className="aspect-square w-full object-cover"
                        src={`/api/media-library/preview?assetId=${id}`}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {heldPlan.dynamicCreativeImages ||
              heldPlan.brandAssetIds.length > 1 ? (
                <p className="text-xs font-semibold text-slate-600">
                  Dynamic Creative: {heldPlan.brandAssetIds.length} Motive
                </p>
              ) : null}
            </div>
            <div className="min-w-0 space-y-4">
              {heldPlan.structuralAdCount === 2 && heldPlan.structuralAds ? (
                <>
                  <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                    {heldPlan.variantDestinationUrl
                      ? "Funnel-Vergleich: 1 Kampagne → 2 Anzeigengruppen → je 1 Anzeige + eigene URL (Startbudget aufgeteilt, danach Erfolgsumschichtung)"
                      : heldPlan.structuralAdSetCount === 2
                      ? "Struktur: 1 Kampagne → 2 Anzeigengruppen → je 1 Anzeige (Startbudget aufgeteilt, danach Erfolgsumschichtung)"
                      : "Struktur: 1 Kampagne → 1 Anzeigengruppe → 2 Anzeigen"}
                  </p>
                  {heldPlan.structuralAds.map((ad, index) => (
                  <div
                    className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"
                    key={`structural-ad-${index}`}
                  >
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                      Anzeige {index + 1}
                      {heldPlan.structuralAdSetCount === 2
                        ? ` · Anzeigengruppe ${index + 1}`
                        : ""}
                    </p>
                    <p className="text-sm font-bold leading-6 text-slate-950">
                      {ad.name || "Überschrift"}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {ad.message || "Anzeigentext"}
                    </p>
                    {ad.description ? (
                      <p className="text-sm text-slate-500">{ad.description}</p>
                    ) : null}
                  </div>
                ))}
                </>
              ) : (
                <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="space-y-2">
                    {(heldPlan.headlines.filter(Boolean).length
                      ? heldPlan.headlines.filter(Boolean)
                      : ["Überschrift"]
                    ).map((line, index) => (
                      <p
                        className="text-sm font-bold leading-6 text-slate-950"
                        key={`h-${index}`}
                      >
                        {heldPlan.headlines.filter(Boolean).length > 1
                          ? `${index + 1}. ${line}`
                          : line}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(heldPlan.primaryTexts.filter(Boolean).length
                      ? heldPlan.primaryTexts.filter(Boolean)
                      : ["Anzeigentext"]
                    ).map((line, index) => (
                      <p
                        className="whitespace-pre-wrap text-sm leading-6 text-slate-700"
                        key={`p-${index}`}
                      >
                        {heldPlan.primaryTexts.filter(Boolean).length > 1
                          ? `${index + 1}. ${line}`
                          : line}
                      </p>
                    ))}
                  </div>
                  {heldPlan.descriptions.filter(Boolean).length ? (
                    <div className="space-y-1">
                      {heldPlan.descriptions
                        .filter(Boolean)
                        .map((line, index) => (
                          <p className="text-sm text-slate-500" key={`d-${index}`}>
                            {heldPlan.descriptions.filter(Boolean).length > 1
                              ? `${index + 1}. ${line}`
                              : line}
                          </p>
                        ))}
                    </div>
                  ) : null}
                  <p className="break-all text-xs font-medium text-blue-700">
                    {heldPlan.destinationUrl}
                  </p>
                </div>
              )}
              {heldPlan.structuralAdCount === 2 ? (
                <div className="space-y-1">
                  <p className="break-all text-xs font-medium text-blue-700">
                    Funnel A: {heldPlan.destinationUrl}
                  </p>
                  {heldPlan.variantDestinationUrl ? (
                    <p className="break-all text-xs font-medium text-blue-700">
                      Funnel B: {heldPlan.variantDestinationUrl}
                    </p>
                  ) : null}
                  {heldPlan.useMetaExperiment ? (
                    <p className="text-xs font-semibold text-slate-600">
                      Nach dem Start: Meta-Experiment (SPLIT_TEST) versuchen
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <dl className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="font-bold text-slate-500">Ziel</dt>
              <dd>{objectiveLabel(heldPlan.objective)}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Budget / Tag</dt>
              <dd>{displayMinor(heldPlan.dailyBudgetMinor)}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Pixel</dt>
              <dd>
                {heldPlan.pixelId} · {heldPlan.customEventType}
              </dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Kampagne</dt>
              <dd>{friendlyCampaignLabel(heldPlan.campaignName)}</dd>
            </div>
          </dl>

          {notice ? (
            <p
              className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
                notice.tone === "success"
                  ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                  : "bg-rose-50 text-rose-900 ring-1 ring-rose-200"
              }`}
              role="status"
            >
              {notice.message}
            </p>
          ) : null}

          <button className={`${buttonClass} mt-4`} disabled={pending} type="submit">
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Kampagne starten
          </button>
        </form>
      ) : null}
        </>
      )}
    </section>
  );
}
