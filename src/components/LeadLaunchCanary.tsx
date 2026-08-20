"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  PlayCircle,
  Rocket,
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
  CreativePickerModal,
  type PickerAsset,
} from "@/components/CreativePickerModal";
import type { LaunchAdActorOption } from "@/components/TrafficLaunchCanary";
import { CreativeTextVariantFields } from "@/components/CreativeTextVariantFields";
import { buildLinkCreativeBlueprintParts } from "@/lib/meta/creative-text-variants";
import { FUNNEL_SITE_URL } from "@/lib/site-urls";

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
  brandProfileId: string | null;
  currency: string;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED";
  policyLaunchReady: boolean;
  writeScopeGranted: boolean;
  data: AutomationOnboardingData;
  facebookPages?: LaunchAdActorOption[];
  instagramAccounts?: LaunchAdActorOption[];
  initialFacebookPageId?: string | null;
  initialInstagramActorId?: string | null;
};

/** Lead blueprint — separate from Traffic (`LINK_CLICKS`). */
const DEFAULT_LEAD_BLUEPRINT = {
  campaign: { special_ad_categories: [] },
  ad_set: {
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: { geo_locations: { countries: ["DE"] } },
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

function displayMinor(value: string): string {
  if (!/^[0-9]+$/.test(value)) return "—";
  const padded = value.padStart(3, "0");
  return `${padded.slice(0, -2)},${padded.slice(-2)} €`;
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
  };
}

export function LeadLaunchCanary({
  brandProfileId,
  currency,
  killSwitchMode,
  policyLaunchReady,
  writeScopeGranted,
  data,
  facebookPages = [],
  instagramAccounts = [],
  initialFacebookPageId = null,
  initialInstagramActorId = null,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [suggestPending, setSuggestPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [prepareElapsedSec, setPrepareElapsedSec] = useState(0);
  const defaultFunnelHint = `${FUNNEL_SITE_URL}/f/`;
  const [destinationUrl, setDestinationUrl] = useState(defaultFunnelHint);
  const [dailyBudget, setDailyBudget] = useState("20.00");
  const [facebookPageId, setFacebookPageId] = useState(
    initialFacebookPageId &&
      facebookPages.some((page) => page.id === initialFacebookPageId)
      ? initialFacebookPageId
      : (facebookPages[0]?.id ?? ""),
  );
  const [instagramActorId, setInstagramActorId] = useState(
    initialInstagramActorId &&
      instagramAccounts.some((account) => account.id === initialInstagramActorId)
      ? initialInstagramActorId
      : (instagramAccounts[0]?.id ?? ""),
  );
  const [primaryTexts, setPrimaryTexts] = useState<string[]>(["Jetzt bewerben."]);
  const [headlines, setHeadlines] = useState<string[]>(["Jetzt bewerben"]);
  const [descriptions, setDescriptions] = useState<string[]>([""]);
  const [structuralMode, setStructuralMode] = useState<
    "off" | "two_ads" | "two_ad_sets"
  >("off");
  const structuralOn = structuralMode !== "off";
  const [ad2Primary, setAd2Primary] = useState("Jetzt bewerben — Variante B.");
  const [ad2Headline, setAd2Headline] = useState("Stelle sichern");
  const [ad2Description, setAd2Description] = useState("");
  const [pixelRowId, setPixelRowId] = useState(data.pixels[0]?.id ?? "");
  const [pickerAssets, setPickerAssets] = useState<PickerAsset[]>(() =>
    data.brandAssets.map((asset) => ({
      id: asset.id,
      originalFilename: asset.originalFilename,
      width: asset.width,
      height: asset.height,
      label: null,
    })),
  );
  const [assetId, setAssetId] = useState(data.brandAssets[0]?.id ?? "");
  const selectedAsset =
    pickerAssets.find((asset) => asset.id === assetId) ?? null;
  const selectedPixel =
    data.pixels.find((pixel) => pixel.id === pixelRowId) ?? data.pixels[0] ?? null;
  const [heldPlan, setHeldPlan] = useState<HeldPlan | null>(() => {
    for (const plan of data.recentLaunchPlans) {
      const held = toHeldFromRecent(plan, data.pixels);
      if (held) return held;
    }
    return null;
  });
  const prepareInFlight = pending && !heldPlan;
  const [launchSucceeded, setLaunchSucceeded] = useState(false);

  const gates = useMemo(
    () => [
      { label: "ads_management", ready: writeScopeGranted },
      { label: "EUR", ready: currency === "EUR" },
      { label: "Launch-Policy aktiv", ready: policyLaunchReady },
      { label: "Pixel bestätigt", ready: Boolean(selectedPixel) },
      {
        label: "Creative bereit",
        ready: pickerAssets.length > 0 || Boolean(assetId),
      },
    ],
    [
      assetId,
      currency,
      pickerAssets.length,
      policyLaunchReady,
      selectedPixel,
      writeScopeGranted,
    ],
  );
  const gatesReady = gates.every((gate) => gate.ready);

  function refresh() {
    router.refresh();
  }

  useEffect(() => {
    if (!prepareInFlight) {
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
    const parts = buildLinkCreativeBlueprintParts({
      primaryTexts: structuralOn
        ? [primaryTexts[0] ?? "Jetzt bewerben."]
        : primaryTexts,
      headlines: structuralOn
        ? [headlines[0] ?? "Jetzt bewerben"]
        : headlines,
      descriptions: structuralOn
        ? [descriptions[0] ?? ""]
        : descriptions,
      callToActionType: "APPLY_NOW",
      defaultPrimary: "Jetzt bewerben.",
      defaultHeadline: "Jetzt bewerben",
    });
    template.creative.object_story_spec =
      parts.objectStorySpec as typeof template.creative.object_story_spec;
    if (!structuralOn && parts.assetFeedSpec) {
      (template.creative as Record<string, unknown>).asset_feed_spec =
        parts.assetFeedSpec;
      (template.ad_set as Record<string, unknown>).is_dynamic_creative = true;
    }

    const saved = await apiJson<{ blueprintId?: string }>(
      "POST",
      "/api/meta/automation/blueprint",
      {
        action: "save",
        objective: "OUTCOME_LEADS",
        name: "Lead Canary",
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
          "Voraussetzungen fehlen (Scope, EUR, Launch-Policy, Pixel, Creative).",
        );
      }
      if (!assetId) {
        throw new Error("Bitte ein hochgeladenes Creative wählen.");
      }
      if (facebookPages.length > 0 && !facebookPageId) {
        throw new Error("Bitte die Facebook-Seite für die Anzeige wählen.");
      }

      const landing = parseLandingUrl(destinationUrl);
      // Do NOT freeze here: server prepare uses a transient FREEZE window and
      // restores Freigeben so Beitrag-Push AUTO is not stranded.
      const blueprintId = await ensureLeadBlueprint();
      const allowedDomainId = await ensureDomain(landing.hostname);

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const structuralAds = structuralOn
        ? [
            {
              message: (primaryTexts[0] ?? "").trim() || "Jetzt bewerben.",
              name: (headlines[0] ?? "").trim() || "Jetzt bewerben",
              description: (descriptions[0] ?? "").trim(),
            },
            {
              message: ad2Primary.trim() || "Jetzt bewerben — Variante B.",
              name: ad2Headline.trim() || "Stelle sichern",
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
        campaignName: `Lead Canary ${stamp}`,
        adSetName: `Lead AdSet ${stamp}`,
        creativeName: `Lead Creative ${stamp}`,
        adName: `Lead Ad ${stamp}`,
        pixelId: selectedPixel.pixelId,
        customEventType: selectedPixel.customEventType,
        reason: PROTOCOL_APPROVE_REASON,
        confirmation: "AKTIV-LAUNCH VORBEREITEN",
        ...(structuralOn
          ? {
              structuralAdCount: 2,
              structuralAdSetCount:
                structuralMode === "two_ad_sets"
                  ? 2
                  : structuralMode === "two_ads"
                    ? 1
                    : undefined,
              structuralAds,
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
            : "Lead-Canary konnte nicht vorbereitet werden.",
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
      setHeldPlan(null);
      if (
        typeof result.executionWarning === "string" &&
        result.executionWarning.trim()
      ) {
        setLaunchSucceeded(false);
        setNotice({
          tone: "error",
          message: result.executionWarning.trim(),
        });
      } else if (result.executorSucceeded === 1) {
        setLaunchSucceeded(true);
        setNotice({
          tone: "success",
          message:
            "Kampagne bei Meta angelegt und aktiviert. Prüfe im Werbeanzeigenmanager Kampagne, Anzeigengruppe und Anzeige.",
        });
      } else {
        setLaunchSucceeded(true);
        setNotice({
          tone: "success",
          message:
            "Kampagne freigegeben. Adbot legt sie bei Meta an und schaltet sie aktiv — das kann kurz dauern. Schau im Werbeanzeigenmanager nach Kampagne und Anzeige.",
        });
      }
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Lead-Canary konnte nicht freigegeben werden.",
      });
    } finally {
      setPending(false);
    }
  }

  function startAnotherLeadCampaign() {
    setLaunchSucceeded(false);
    setHeldPlan(null);
    setNotice(null);
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
            Lead Canary
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            Website-Leads mit Funnel und Pixel
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Separater Pfad vom Traffic-Canary: Objective{" "}
            <span className="font-semibold">OUTCOME_LEADS</span>, Optimierung{" "}
            <span className="font-semibold">OFFSITE_CONVERSIONS</span> auf dein
            bestätigtes Pixel-Event. Destination = veröffentlichter Funnel
              CAPI im Funnel sollte aktiv sein (Token dort setzen; Pixel-ID kommt
              automatisch aus der Pixel-Bestätigung oben).
          </p>
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
              <option value="">Zuerst Pixel oben bestätigen</option>
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
        <div className="text-sm font-bold text-slate-800">
          Creative
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
                {selectedAsset
                  ? selectedAsset.originalFilename
                  : "Creative wählen oder hochladen"}
              </span>
              {selectedAsset?.width && selectedAsset?.height ? (
                <span className="mt-1 block text-xs font-medium text-slate-500">
                  {selectedAsset.width}×{selectedAsset.height}
                </span>
              ) : null}
            </span>
          </button>
        </div>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Funnel-URL (HTTPS)
          <input
            className={inputClass}
            disabled={pending || suggestPending}
            onChange={(event) => setDestinationUrl(event.target.value)}
            placeholder={`${FUNNEL_SITE_URL}/f/dein-slug`}
            required
            type="url"
            value={destinationUrl}
          />
          <span className="mt-1 block text-xs font-medium text-slate-500">
            Veröffentlichten Funnel oder später Custom Domain. Domain muss in
            Meta für Conversion-Tracking passen.
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
            Struktur-Test
          </legend>
          <p className="mt-1 text-xs font-medium text-slate-500">
            Opt-in für getrennte Anzeigen statt Dynamic Creative. Standard bleibt
            eine Anzeige.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
            {(
              [
                { value: "off" as const, label: "Aus" },
                { value: "two_ads" as const, label: "2 Anzeigen" },
                { value: "two_ad_sets" as const, label: "2 Ad Sets" },
              ] as const
            ).map((option) => (
              <label
                className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800"
                key={option.value}
              >
                <input
                  checked={structuralMode === option.value}
                  className="size-4 border-slate-300 text-blue-700 focus:ring-blue-500"
                  disabled={pending || Boolean(heldPlan)}
                  name="structural-mode-lead"
                  onChange={() => setStructuralMode(option.value)}
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
        </fieldset>
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
            {prepareInFlight ? "Bitte warten…" : "Kampagne vorbereiten"}
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            disabled={pending}
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            <ImagePlus className="size-4" />
            Creative wechseln
          </button>
        </div>
      </form>

      <CreativePickerModal
        assets={pickerAssets}
        brandProfileId={brandProfileId}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => setAssetId(id)}
        onUploaded={({ preferredLaunchAssetId, assets }) => {
          setPickerAssets((previous) => {
            const map = new Map(previous.map((asset) => [asset.id, asset]));
            for (const asset of assets) {
              map.set(asset.id, asset);
            }
            return [...map.values()];
          });
          setAssetId(preferredLaunchAssetId);
          refresh();
        }}
        open={pickerOpen}
        selectedAssetId={assetId || null}
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
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Creative-Vorschau"
                className="aspect-square w-full object-cover"
                src={`/api/media-library/preview?assetId=${heldPlan.brandAssetIds[0]}`}
              />
            </div>
            <div className="min-w-0 space-y-4">
              {heldPlan.structuralAdCount === 2 && heldPlan.structuralAds ? (
                <>
                  <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                    {heldPlan.structuralAdSetCount === 2
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
                <p className="break-all text-xs font-medium text-blue-700">
                  {heldPlan.destinationUrl}
                </p>
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
