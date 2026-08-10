"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CircleDot,
  FileJson2,
  Globe2,
  ImageDown,
  LoaderCircle,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";

export type AllowedDomainView = {
  id: string;
  hostname: string;
  registrableDomain: string;
  status: "PENDING" | "VERIFIED";
  customerConfirmedAt: string | null;
};

export type ConfirmedPixelView = {
  id: string;
  pixelId: string;
  label: string;
  customEventType: string;
  status: "CONFIRMED";
  customerConfirmedAt: string | null;
};

export type ObjectiveBlueprintView = {
  id: string;
  objective: string;
  name: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  activatedAt: string | null;
};

export type ReadyBrandAssetView = {
  id: string;
  originalFilename: string;
  sourceMetaAssetId: string | null;
  width: number | null;
  height: number | null;
  metaImageHashPresent: boolean;
};

export type SyncedCreativeView = {
  id: string;
  name: string;
  hasImportableImage: boolean;
};

export type RecentLaunchPlanView = {
  id: string;
  status: string;
  createdAt: string;
  /** Held canaries use far-future / infinity not_before while status stays PENDING. */
  notBefore: string | null;
  payloadHash: string | null;
  objective: string | null;
  destinationUrl: string | null;
  targetStatus: "ACTIVE" | null;
  budgetType: "DAILY" | "LIFETIME" | null;
  budgetOwnerType: "CAMPAIGN" | "AD_SET" | null;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  startTime: string | null;
  endTime: string | null;
  campaignName: string | null;
  adSetName: string | null;
  creativeName: string | null;
  adName: string | null;
  brandAssetIds: string[];
};

type HeldLaunchPlanCommon = {
  id: string;
  status: "HELD";
  outcome: "CREATED" | "EXISTING" | null;
  createdAt: string;
  payloadHash: string;
  objective: string;
  destinationUrl: string;
  targetStatus: "ACTIVE";
  campaignName: string;
  adSetName: string;
  creativeName: string;
  adName: string;
  brandAssetIds: string[];
};

type HeldLaunchPlan = HeldLaunchPlanCommon &
  (
    | {
        budgetType: "DAILY";
        budgetOwnerType: "CAMPAIGN" | "AD_SET";
        dailyBudgetMinor: string;
      }
    | {
        budgetType: "LIFETIME";
        budgetOwnerType: "CAMPAIGN";
        lifetimeBudgetMinor: string;
        startTime: string;
        endTime: string;
      }
  );

function planLooksHeld(plan: RecentLaunchPlanView): boolean {
  if (plan.status === "HELD") return true;
  if (plan.status !== "PENDING" || !plan.notBefore) return false;
  if (plan.notBefore.toLowerCase() === "infinity") return true;
  const ms = Date.parse(plan.notBefore);
  return Number.isFinite(ms) && ms > Date.now() + 30 * 24 * 60 * 60 * 1000;
}

function toHeldLaunchPlan(plan: RecentLaunchPlanView): HeldLaunchPlan | null {
  if (
    !planLooksHeld(plan) ||
    !plan.payloadHash ||
    !plan.objective ||
    !plan.destinationUrl ||
    plan.targetStatus !== "ACTIVE" ||
    !plan.campaignName ||
    !plan.adSetName ||
    !plan.creativeName ||
    !plan.adName ||
    plan.brandAssetIds.length < 1
  ) {
    return null;
  }

  const common: HeldLaunchPlanCommon = {
    id: plan.id,
    status: "HELD",
    outcome: null,
    createdAt: plan.createdAt,
    payloadHash: plan.payloadHash,
    objective: plan.objective,
    destinationUrl: plan.destinationUrl,
    targetStatus: "ACTIVE",
    campaignName: plan.campaignName,
    adSetName: plan.adSetName,
    creativeName: plan.creativeName,
    adName: plan.adName,
    brandAssetIds: plan.brandAssetIds,
  };

  if (
    plan.budgetType === "DAILY" &&
    (plan.budgetOwnerType === "CAMPAIGN" || plan.budgetOwnerType === "AD_SET") &&
    plan.dailyBudgetMinor
  ) {
    return {
      ...common,
      budgetType: "DAILY",
      budgetOwnerType: plan.budgetOwnerType,
      dailyBudgetMinor: plan.dailyBudgetMinor,
    };
  }

  if (
    plan.budgetType === "LIFETIME" &&
    plan.budgetOwnerType === "CAMPAIGN" &&
    plan.lifetimeBudgetMinor &&
    plan.startTime &&
    plan.endTime
  ) {
    return {
      ...common,
      budgetType: "LIFETIME",
      budgetOwnerType: "CAMPAIGN",
      lifetimeBudgetMinor: plan.lifetimeBudgetMinor,
      startTime: plan.startTime,
      endTime: plan.endTime,
    };
  }

  return null;
}

export type AutomationOnboardingData = {
  domains: AllowedDomainView[];
  /** Confirmed Meta Pixels for Lead/offsite launches; unused by Traffic. */
  pixels: ConfirmedPixelView[];
  blueprints: ObjectiveBlueprintView[];
  brandAssets: ReadyBrandAssetView[];
  syncedCreatives: SyncedCreativeView[];
  recentLaunchPlans: RecentLaunchPlanView[];
  snapshotReady: boolean;
};

type Props = {
  brandProfileId: string | null;
  currency: string;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED";
  policyLaunchReady: boolean;
  writeScopeGranted: boolean;
  data: AutomationOnboardingData;
};

type ApiPayload = Record<string, unknown> & {
  ok?: boolean;
  message?: string;
};

type Notice = { tone: "success" | "error"; message: string } | null;

const OBJECTIVES = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_APP_PROMOTION",
] as const;

const DEFAULT_BLUEPRINT = JSON.stringify(
  {
    campaign: { special_ad_categories: [] },
    ad_set: {
      billing_event: "IMPRESSIONS",
      optimization_goal: "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: { geo_locations: { countries: ["DE"] } },
    },
    creative: {
      object_story_spec: {
        link_data: {
          message: "Mehr erfahren.",
          call_to_action: { type: "LEARN_MORE" },
        },
      },
    },
    ad: {},
  },
  null,
  2,
);

function displayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(date);
}

function displayMinorUnits(value: string): string {
  if (!/^[0-9]+$/.test(value)) return "—";
  const padded = value.padStart(3, "0");
  return `${padded.slice(0, -2)},${padded.slice(-2)} €`;
}

async function requestAutomationControl<T extends ApiPayload>(
  method: "POST" | "PUT",
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || !result.ok) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Die Aktion konnte nicht sicher abgeschlossen werden.",
    );
  }
  return result;
}

function postAutomationControl<T extends ApiPayload>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  return requestAutomationControl<T>("POST", url, body);
}

function putAutomationControl<T extends ApiPayload>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  return requestAutomationControl<T>("PUT", url, body);
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
        notice.tone === "success"
          ? "bg-emerald-50 text-emerald-800"
          : "bg-red-50 text-red-800"
      }`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.message}
    </p>
  );
}

function ModuleHeader({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof Globe2;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
        <Icon className="size-5" />
      </span>
      <div>
        <h3 className="font-extrabold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export function AutomationOnboardingControls({
  brandProfileId,
  currency,
  data,
  killSwitchMode,
  policyLaunchReady,
  writeScopeGranted,
}: Props) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [domainNotice, setDomainNotice] = useState<Notice>(null);
  const [blueprintNotice, setBlueprintNotice] = useState<Notice>(null);
  const [assetNotice, setAssetNotice] = useState<Notice>(null);
  const [launchNotice, setLaunchNotice] = useState<Notice>(null);

  const [hostname, setHostname] = useState("");
  const [registrableDomain, setRegistrableDomain] = useState("");
  const [blueprintName, setBlueprintName] = useState("Traffic Blueprint");
  const [objective, setObjective] = useState<(typeof OBJECTIVES)[number]>(
    "OUTCOME_TRAFFIC",
  );
  const [blueprintPayload, setBlueprintPayload] = useState(DEFAULT_BLUEPRINT);
  const [sourceCreativeId, setSourceCreativeId] = useState(
    data.syncedCreatives.find((creative) => creative.hasImportableImage)?.id ?? "",
  );

  const activeBlueprints = data.blueprints.filter(
    (blueprint) => blueprint.status === "ACTIVE",
  );
  const verifiedDomains = data.domains.filter(
    (domain) => domain.status === "VERIFIED",
  );
  const [launchBlueprintId, setLaunchBlueprintId] = useState(
    activeBlueprints[0]?.id ?? "",
  );
  const [launchDomainId, setLaunchDomainId] = useState(
    verifiedDomains[0]?.id ?? "",
  );
  const [launchAssetId, setLaunchAssetId] = useState(
    data.brandAssets[0]?.id ?? "",
  );
  const [budgetType, setBudgetType] = useState<"DAILY" | "LIFETIME">("DAILY");
  const [budgetOwnerType, setBudgetOwnerType] = useState<"CAMPAIGN" | "AD_SET">(
    "AD_SET",
  );
  const [dailyBudget, setDailyBudget] = useState("20.00");
  const [lifetimeBudget, setLifetimeBudget] = useState("15.00");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [adSetName, setAdSetName] = useState("");
  const [creativeName, setCreativeName] = useState("");
  const [adName, setAdName] = useState("");
  const [launchReason, setLaunchReason] = useState("");
  const [launchPreparationConfirmation, setLaunchPreparationConfirmation] =
    useState("");
  const [launchApprovalReason, setLaunchApprovalReason] = useState("");
  const [launchApprovalConfirmation, setLaunchApprovalConfirmation] =
    useState("");
  const [materializedPlan, setMaterializedPlan] = useState<HeldLaunchPlan | null>(
    () => {
      const held = data.recentLaunchPlans
        .map(toHeldLaunchPlan)
        .find((plan): plan is HeldLaunchPlan => Boolean(plan));
      return held ?? null;
    },
  );

  const gateItems = useMemo(
    () => [
      { label: "ads_management", ready: writeScopeGranted },
      { label: "EUR-Werbekonto", ready: currency === "EUR" },
      { label: "Aktive Launch-Policy", ready: policyLaunchReady },
      {
        label: "Kill-Switch FREEZE_WRITES",
        ready: killSwitchMode === "FREEZE_WRITES",
      },
      { label: "Aktueller Exposure-Snapshot", ready: data.snapshotReady },
      { label: "Verifizierte Domain", ready: verifiedDomains.length > 0 },
      { label: "Aktiver Blueprint", ready: activeBlueprints.length > 0 },
      { label: "Freigegebenes Brand-Asset", ready: data.brandAssets.length > 0 },
      { label: "Aktives Brand-Profil", ready: Boolean(brandProfileId) },
    ],
    [
      activeBlueprints.length,
      brandProfileId,
      currency,
      data.brandAssets.length,
      data.snapshotReady,
      killSwitchMode,
      policyLaunchReady,
      verifiedDomains.length,
      writeScopeGranted,
    ],
  );
  const allLaunchGatesReady = gateItems.every((gate) => gate.ready);
  const lifetimeStartMs = Date.parse(startTime);
  const lifetimeEndMs = Date.parse(endTime);
  const lifetimeDurationMs = lifetimeEndMs - lifetimeStartMs;
  const launchBudgetReady =
    budgetType === "DAILY"
      ? dailyBudget.trim().length > 0
      : budgetOwnerType === "CAMPAIGN" &&
        lifetimeBudget.trim().length > 0 &&
        Number.isFinite(lifetimeStartMs) &&
        Number.isFinite(lifetimeEndMs) &&
        lifetimeDurationMs >= 60 * 60 * 1000 &&
        lifetimeDurationMs <= 90 * 24 * 60 * 60 * 1000;

  function refresh() {
    router.refresh();
  }

  async function registerDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("domain-register");
    setDomainNotice(null);
    try {
      await postAutomationControl("/api/meta/automation/domain", {
        action: "register",
        hostname,
        registrableDomain,
        verificationMethod: "CUSTOMER_CONFIRMATION",
      });
      setDomainNotice({
        tone: "success",
        message:
          "Die Domain ist als PENDING registriert. Bestätige sie im nächsten Schritt ausdrücklich.",
      });
      refresh();
    } catch (error) {
      setDomainNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Die Domain konnte nicht registriert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmDomain(domainId: string) {
    setPendingAction(`domain-confirm:${domainId}`);
    setDomainNotice(null);
    try {
      await postAutomationControl("/api/meta/automation/domain", {
        action: "confirm",
        domainId,
      });
      setDomainNotice({
        tone: "success",
        message: "Die Domain wurde kundenseitig bestätigt und hashverkettet auditiert.",
      });
      refresh();
    } catch (error) {
      setDomainNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Die Domain konnte nicht bestätigt werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function saveBlueprint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("blueprint-save");
    setBlueprintNotice(null);
    try {
      let payloadTemplate: unknown;
      try {
        payloadTemplate = JSON.parse(blueprintPayload);
      } catch {
        throw new Error("Das Blueprint-JSON ist syntaktisch ungültig.");
      }
      await postAutomationControl("/api/meta/automation/blueprint", {
        action: "save",
        objective,
        name: blueprintName,
        payloadTemplate,
        requiredInputs: ["destination_url"],
      });
      setBlueprintNotice({
        tone: "success",
        message: "Eine neue immutable Blueprint-Version wurde als DRAFT gespeichert.",
      });
      refresh();
    } catch (error) {
      setBlueprintNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Das Blueprint konnte nicht gespeichert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function activateBlueprint(blueprintId: string) {
    setPendingAction(`blueprint-activate:${blueprintId}`);
    setBlueprintNotice(null);
    try {
      await postAutomationControl("/api/meta/automation/blueprint", {
        action: "activate",
        blueprintId,
      });
      setBlueprintNotice({
        tone: "success",
        message: "Das Blueprint ist aktiv; die vorherige aktive Version wurde atomar retired.",
      });
      refresh();
    } catch (error) {
      setBlueprintNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Das Blueprint konnte nicht aktiviert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function importAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brandProfileId) {
      setAssetNotice({ tone: "error", message: "Aktiviere zuerst ein Brand-Profil." });
      return;
    }
    setPendingAction("asset-import");
    setAssetNotice(null);
    try {
      await postAutomationControl("/api/meta/automation/asset-import", {
        brandProfileId,
        sourceCreativeId,
      });
      setAssetNotice({
        tone: "success",
        message:
          "Das Creative wurde serverseitig geladen, validiert, gehasht und als freigegebenes privates Brand-Asset importiert.",
      });
      refresh();
    } catch (error) {
      setAssetNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Das Creative konnte nicht importiert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !allLaunchGatesReady ||
      !launchBudgetReady ||
      !brandProfileId ||
      launchPreparationConfirmation !== "AKTIV-LAUNCH VORBEREITEN" ||
      launchReason.trim().length < 12
    ) {
      setLaunchNotice({
        tone: "error",
        message:
          "Die Vorbereitung bleibt blockiert, bis alle Gates grün sowie Begründung und exakte Vorbereitungsklausel vollständig sind.",
      });
      return;
    }
    setPendingAction("launch-prepare");
    setLaunchNotice(null);
    try {
      const launchBudgetPayload =
        budgetType === "DAILY"
          ? { budgetType, budgetOwnerType, dailyBudget }
          : {
              budgetType,
              budgetOwnerType: "CAMPAIGN" as const,
              lifetimeBudget,
              startTime: new Date(startTime).toISOString(),
              endTime: new Date(endTime).toISOString(),
            };
      const result = await postAutomationControl<
        ApiPayload & {
          planId?: string;
          status?: string;
          outcome?: "CREATED" | "EXISTING";
          payloadHash?: string;
          objective?: string;
          destinationUrl?: string;
          targetStatus?: string;
          budgetType?: string;
          budgetOwnerType?: string;
          dailyBudgetMinor?: string;
          lifetimeBudgetMinor?: string;
          startTime?: string;
          endTime?: string;
          campaignName?: string;
          adSetName?: string;
          creativeName?: string;
          adName?: string;
          brandAssetIds?: string[];
          preparedAt?: string;
        }
      >("/api/meta/automation/launch", {
        blueprintId: launchBlueprintId,
        brandProfileId,
        brandAssetId: launchAssetId,
        allowedDomainId: launchDomainId,
        ...launchBudgetPayload,
        destinationUrl,
        campaignName,
        adSetName,
        creativeName,
        adName,
        reason: launchReason,
        confirmation: launchPreparationConfirmation,
      });
      if (
        !result.planId ||
        result.status !== "HELD" ||
        (result.outcome !== "CREATED" && result.outcome !== "EXISTING") ||
        !result.payloadHash ||
        !result.objective ||
        !result.destinationUrl ||
        result.targetStatus !== "ACTIVE" ||
        !result.campaignName ||
        !result.adSetName ||
        !result.creativeName ||
        !result.adName ||
        !result.brandAssetIds?.length ||
        !result.preparedAt
      ) {
        throw new Error("Der Server lieferte keine vollständige HELD-Plan-Vorschau.");
      }
      const commonPlan: HeldLaunchPlanCommon = {
        id: result.planId,
        status: "HELD",
        outcome: result.outcome,
        createdAt: result.preparedAt,
        payloadHash: result.payloadHash,
        objective: result.objective,
        destinationUrl: result.destinationUrl,
        targetStatus: "ACTIVE",
        campaignName: result.campaignName,
        adSetName: result.adSetName,
        creativeName: result.creativeName,
        adName: result.adName,
        brandAssetIds: result.brandAssetIds,
      };
      if (result.budgetType === "DAILY") {
        if (
          (result.budgetOwnerType !== "CAMPAIGN" &&
            result.budgetOwnerType !== "AD_SET") ||
          !result.dailyBudgetMinor
        ) {
          throw new Error("Der Server lieferte keine vollständige Daily-HELD-Vorschau.");
        }
        setMaterializedPlan({
          ...commonPlan,
          budgetType: "DAILY",
          budgetOwnerType: result.budgetOwnerType,
          dailyBudgetMinor: result.dailyBudgetMinor,
        });
      } else if (result.budgetType === "LIFETIME") {
        if (
          result.budgetOwnerType !== "CAMPAIGN" ||
          !result.lifetimeBudgetMinor ||
          !result.startTime ||
          !result.endTime
        ) {
          throw new Error("Der Server lieferte keine vollständige Lifetime-HELD-Vorschau.");
        }
        setMaterializedPlan({
          ...commonPlan,
          budgetType: "LIFETIME",
          budgetOwnerType: "CAMPAIGN",
          lifetimeBudgetMinor: result.lifetimeBudgetMinor,
          startTime: result.startTime,
          endTime: result.endTime,
        });
      } else {
        throw new Error("Der Server lieferte keinen gültigen Budgettyp.");
      }
      setLaunchPreparationConfirmation("");
      setLaunchApprovalReason(launchReason);
      setLaunchNotice({
        tone: "success",
        message:
          result.outcome === "EXISTING"
            ? "Der identische HELD-Plan wurde wiedergefunden. Es wurde nichts an Meta gesendet."
            : "Der Aktiv-Launch wurde als unveränderlicher HELD-Plan vorbereitet. Es wurde nichts an Meta gesendet.",
      });
      refresh();
    } catch (error) {
      setLaunchNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Aktiv-Launch konnte nicht sicher vorbereitet werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function approveLaunch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !materializedPlan ||
      killSwitchMode !== "FREEZE_WRITES" ||
      launchApprovalConfirmation !== "AKTIV-LAUNCH FREIGEBEN" ||
      launchApprovalReason.trim().length < 12
    ) {
      setLaunchNotice({
        tone: "error",
        message:
          "Die Freigabe bleibt blockiert, bis der HELD-Plan unverändert, FREEZE_WRITES aktiv und die exakte Freigabeklausel vollständig ist.",
      });
      return;
    }

    setPendingAction("launch-approve");
    setLaunchNotice(null);
    try {
      const approvalBudgetPayload =
        materializedPlan.budgetType === "DAILY"
          ? {
              budgetType: "DAILY" as const,
              budgetOwnerType: materializedPlan.budgetOwnerType,
              dailyBudgetMinor: materializedPlan.dailyBudgetMinor,
            }
          : {
              budgetType: "LIFETIME" as const,
              budgetOwnerType: "CAMPAIGN" as const,
              lifetimeBudgetMinor: materializedPlan.lifetimeBudgetMinor,
              startTime: materializedPlan.startTime,
              endTime: materializedPlan.endTime,
            };
      const result = await putAutomationControl<
        ApiPayload & {
          approvalId?: string;
          planId?: string;
          planStatus?: string;
          executableAt?: string;
          approvedAt?: string;
        }
      >("/api/meta/automation/launch", {
        planId: materializedPlan.id,
        payloadHash: materializedPlan.payloadHash,
        objective: materializedPlan.objective,
        destinationUrl: materializedPlan.destinationUrl,
        targetStatus: materializedPlan.targetStatus,
        ...approvalBudgetPayload,
        campaignName: materializedPlan.campaignName,
        adSetName: materializedPlan.adSetName,
        creativeName: materializedPlan.creativeName,
        adName: materializedPlan.adName,
        reason: launchApprovalReason,
        confirmation: launchApprovalConfirmation,
      });
      if (
        !result.approvalId ||
        result.planId !== materializedPlan.id ||
        result.planStatus !== "PENDING" ||
        !result.executableAt ||
        !result.approvedAt
      ) {
        throw new Error("Der Server lieferte keine gültige Aktiv-Launch-Freigabe.");
      }
      setLaunchApprovalConfirmation("");
      setMaterializedPlan(null);
      setLaunchNotice({
        tone: "success",
        message:
          "Der exakt gebundene Aktiv-Launch ist einmalig freigegeben. Alle Objekte entstehen zunächst PAUSED und werden erst nach vollständigem Read-back aktiviert.",
      });
      refresh();
    } catch (error) {
      setLaunchNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Aktiv-Launch konnte nicht sicher freigegeben werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
  const buttonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-7 sm:px-7">
      <div className="mb-6 max-w-3xl">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">
          Launch Readiness
        </p>
        <h2 className="mt-2 text-xl font-extrabold text-slate-950">
          Voraussetzungen explizit anlegen und bestätigen
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Jede Stufe ist tenantgebunden und idempotent. Aktivierung, Import und Launch
          bleiben ohne EUR, minimalen Schreibscope und vollständige Readiness fail-closed.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <ModuleHeader
            description="Zuerst PENDING registrieren, danach separat bestätigen. Die Freigabe gilt exakt für den Hostnamen; die registrierbare Domain dient nur Meta als conversion_domain."
            icon={Globe2}
            title="1. Ziel-Domain"
          />
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={registerDomain}>
            <label className="text-sm font-bold text-slate-800">
              Hostname
              <input
                className={inputClass}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="www.example.de"
                required
                value={hostname}
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Registrierbare Domain (Meta)
              <input
                className={inputClass}
                onChange={(event) => setRegistrableDomain(event.target.value)}
                placeholder="example.de"
                required
                value={registrableDomain}
              />
            </label>
            <button
              className={`${buttonClass} sm:col-span-2 sm:justify-self-end`}
              disabled={Boolean(pendingAction)}
              type="submit"
            >
              <Globe2 className="size-4" />
              {pendingAction === "domain-register" ? "Wird registriert …" : "Domain PENDING registrieren"}
            </button>
          </form>
          <div className="mt-5 space-y-2">
            {data.domains.length ? (
              data.domains.map((domain) => (
                <div
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  key={domain.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-slate-900">{domain.hostname}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {domain.status} · {domain.registrableDomain} · {displayDate(domain.customerConfirmedAt)}
                    </p>
                  </div>
                  {domain.status === "PENDING" ? (
                    <button
                      className={buttonClass}
                      disabled={Boolean(pendingAction) || !writeScopeGranted || currency !== "EUR"}
                      onClick={() => confirmDomain(domain.id)}
                      type="button"
                    >
                      {pendingAction === `domain-confirm:${domain.id}` ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="size-4" />
                      )}
                      Ausdrücklich bestätigen
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-xs font-extrabold text-emerald-700">
                      <Check className="size-4" /> VERIFIED
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Noch keine Domain registriert.
              </p>
            )}
          </div>
          <NoticeBox notice={domainNotice} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <ModuleHeader
            description="Speichern erzeugt eine immutable DRAFT-Version; Aktivieren retired die vorherige aktive Version atomar."
            icon={FileJson2}
            title="2. Objective-Blueprint"
          />
          <form className="mt-5" onSubmit={saveBlueprint}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-800">
                Name
                <input
                  className={inputClass}
                  maxLength={255}
                  onChange={(event) => setBlueprintName(event.target.value)}
                  required
                  value={blueprintName}
                />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Meta-Ziel
                <select
                  className={inputClass}
                  onChange={(event) =>
                    setObjective(event.target.value as (typeof OBJECTIVES)[number])
                  }
                  value={objective}
                >
                  {OBJECTIVES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mt-4 block text-sm font-bold text-slate-800">
              Allowlisted Payload-Template · JSON
              <textarea
                className={`${inputClass} min-h-64 font-mono text-xs leading-5`}
                onChange={(event) => setBlueprintPayload(event.target.value)}
                spellCheck={false}
                value={blueprintPayload}
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              `destination_url` wird beim Launch verlangt. Status, Budget, Page-ID,
              Creative-Bild und Remote-Bindings werden serverseitig gesetzt.
            </p>
            <button
              className={`${buttonClass} mt-4 w-full sm:w-auto`}
              disabled={Boolean(pendingAction)}
              type="submit"
            >
              <FileJson2 className="size-4" />
              {pendingAction === "blueprint-save" ? "Wird versioniert …" : "Neue DRAFT-Version speichern"}
            </button>
          </form>
          <div className="mt-5 space-y-2">
            {data.blueprints.map((blueprint) => (
              <div
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                key={blueprint.id}
              >
                <div>
                  <p className="text-sm font-extrabold text-slate-900">
                    {blueprint.name} · v{blueprint.version}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {blueprint.objective} · {blueprint.status}
                  </p>
                </div>
                {blueprint.status === "DRAFT" ? (
                  <button
                    className={buttonClass}
                    disabled={Boolean(pendingAction) || !writeScopeGranted || currency !== "EUR"}
                    onClick={() => activateBlueprint(blueprint.id)}
                    type="button"
                  >
                    <PlayCircle className="size-4" /> Aktivieren
                  </button>
                ) : (
                  <span className="text-xs font-extrabold text-emerald-700">ACTIVE</span>
                )}
              </div>
            ))}
          </div>
          <NoticeBox notice={blueprintNotice} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <ModuleHeader
            description="Nur synchronisierte Creatives dieses Werbekontos; keine Browser-URL und kein kundenseitig behaupteter Hash."
            icon={ImageDown}
            title="3. Vorhandenes Meta-Creative"
          />
          <form className="mt-5" onSubmit={importAsset}>
            <label className="block text-sm font-bold text-slate-800">
              Synchronisiertes Creative
              <select
                className={inputClass}
                onChange={(event) => setSourceCreativeId(event.target.value)}
                required
                value={sourceCreativeId}
              >
                <option value="">Creative wählen</option>
                {data.syncedCreatives.map((creative) => (
                  <option
                    disabled={!creative.hasImportableImage}
                    key={creative.id}
                    value={creative.id}
                  >
                    {creative.name} · {creative.id}
                    {creative.hasImportableImage ? "" : " · kein Bild"}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`${buttonClass} mt-4 w-full sm:w-auto`}
              disabled={
                Boolean(pendingAction) ||
                !brandProfileId ||
                !sourceCreativeId ||
                !writeScopeGranted ||
                currency !== "EUR"
              }
              type="submit"
            >
              <ImageDown className="size-4" />
              {pendingAction === "asset-import" ? "Wird geprüft und importiert …" : "Serverseitig importieren"}
            </button>
          </form>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {data.brandAssets.map((asset) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={asset.id}>
                <p className="truncate text-sm font-extrabold text-slate-900">{asset.originalFilename}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {asset.width ?? "?"} × {asset.height ?? "?"} · {asset.metaImageHashPresent ? "Meta-Hash" : "Upload-Step"}
                </p>
              </div>
            ))}
          </div>
          <NoticeBox notice={assetNotice} />
        </section>

        <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm sm:p-6">
          <ModuleHeader
            description="Bereitet unter FREEZE_WRITES einen unveränderlichen HELD-Plan vor. Erst eine separate Fingerprint-Freigabe erstellt alle Objekte PAUSED, prüft sie vollständig und aktiviert sie atomar."
            icon={PlayCircle}
            title="4. Active Launch"
          />
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {gateItems.map((gate) => (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${
                  gate.ready
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-900"
                }`}
                key={gate.label}
              >
                {gate.ready ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                {gate.label}
              </div>
            ))}
          </div>

          <form className="mt-5" onSubmit={launch}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-800">
                Aktiver Blueprint
                <select className={inputClass} onChange={(event) => setLaunchBlueprintId(event.target.value)} value={launchBlueprintId}>
                  <option value="">Blueprint wählen</option>
                  {activeBlueprints.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.objective}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-800">
                Verifizierte Domain
                <select className={inputClass} onChange={(event) => setLaunchDomainId(event.target.value)} value={launchDomainId}>
                  <option value="">Domain wählen</option>
                  {verifiedDomains.map((item) => <option key={item.id} value={item.id}>{item.hostname}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-800">
                Brand-Asset
                <select className={inputClass} onChange={(event) => setLaunchAssetId(event.target.value)} value={launchAssetId}>
                  <option value="">Asset wählen</option>
                  {data.brandAssets.map((item) => <option key={item.id} value={item.id}>{item.originalFilename}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-800">
                Budgetart
                <select
                  className={inputClass}
                  onChange={(event) => {
                    const nextBudgetType = event.target.value as "DAILY" | "LIFETIME";
                    setBudgetType(nextBudgetType);
                    if (nextBudgetType === "LIFETIME") {
                      setBudgetOwnerType("CAMPAIGN");
                    }
                  }}
                  value={budgetType}
                >
                  <option value="DAILY">Tagesbudget · Daily v2</option>
                  <option value="LIFETIME">Laufzeitbudget · Lifetime v3</option>
                </select>
              </label>
              <label className="text-sm font-bold text-slate-800">
                Budgetträger
                <select
                  className={inputClass}
                  disabled={budgetType === "LIFETIME"}
                  onChange={(event) =>
                    setBudgetOwnerType(event.target.value as "CAMPAIGN" | "AD_SET")
                  }
                  value={budgetOwnerType}
                >
                  <option value="AD_SET">Ad Set</option>
                  <option value="CAMPAIGN">Kampagne</option>
                </select>
                {budgetType === "LIFETIME" ? (
                  <span className="mt-2 block text-xs font-medium leading-5 text-slate-500">
                    Laufzeitbudgets sind ausschließlich auf Kampagnenebene zulässig.
                  </span>
                ) : null}
              </label>
              {budgetType === "DAILY" ? (
                <label className="text-sm font-bold text-slate-800">
                  Tagesbudget · EUR
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    onChange={(event) => setDailyBudget(event.target.value)}
                    required
                    value={dailyBudget}
                  />
                </label>
              ) : (
                <>
                  <label className="text-sm font-bold text-slate-800">
                    Laufzeitbudget gesamt · EUR
                    <input
                      className={inputClass}
                      inputMode="decimal"
                      onChange={(event) => setLifetimeBudget(event.target.value)}
                      required
                      value={lifetimeBudget}
                    />
                  </label>
                  <label className="text-sm font-bold text-slate-800">
                    Startzeit
                    <input
                      className={inputClass}
                      onChange={(event) => setStartTime(event.target.value)}
                      required
                      step={60}
                      type="datetime-local"
                      value={startTime}
                    />
                  </label>
                  <label className="text-sm font-bold text-slate-800">
                    Endzeit
                    <input
                      className={inputClass}
                      onChange={(event) => setEndTime(event.target.value)}
                      required
                      step={60}
                      type="datetime-local"
                      value={endTime}
                    />
                  </label>
                  <p className="text-xs font-medium leading-5 text-slate-500 sm:col-span-2">
                    Die lokal eingegebenen Zeitpunkte werden vor der Fingerprint-Bildung in UTC
                    normalisiert. Zulässig sind mindestens 1 Stunde und höchstens 90 Tage; das
                    Gesamtbudget wird nicht in ein Tagesbudget umgerechnet.
                  </p>
                </>
              )}
              <label className="text-sm font-bold text-slate-800">
                HTTPS-Ziel
                <input className={inputClass} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://www.example.de/angebot" required type="url" value={destinationUrl} />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Kampagnenname · optional
                <input className={inputClass} maxLength={240} onChange={(event) => setCampaignName(event.target.value)} value={campaignName} />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Ad-Set-Name · optional
                <input className={inputClass} maxLength={240} onChange={(event) => setAdSetName(event.target.value)} value={adSetName} />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Creative-Name · optional
                <input className={inputClass} maxLength={240} onChange={(event) => setCreativeName(event.target.value)} value={creativeName} />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Anzeigenname · optional
                <input className={inputClass} maxLength={240} onChange={(event) => setAdName(event.target.value)} value={adName} />
              </label>
              <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                Begründung für die Vorbereitung
                <textarea
                  className={inputClass}
                  maxLength={500}
                  minLength={12}
                  onChange={(event) => setLaunchReason(event.target.value)}
                  required
                  rows={3}
                  value={launchReason}
                />
              </label>
              <label className="text-sm font-bold text-slate-800 sm:col-span-2">
                Exakte Vorbereitungsklausel
                <input
                  autoComplete="off"
                  className={inputClass}
                  onChange={(event) =>
                    setLaunchPreparationConfirmation(event.target.value)
                  }
                  placeholder="AKTIV-LAUNCH VORBEREITEN"
                  required
                  value={launchPreparationConfirmation}
                />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-950">
              Dieser Schritt erstellt ausschließlich einen unveränderlichen HELD-Plan mit
              Fingerprint. Es werden noch keine Kampagne, kein Ad Set, kein Creative und
              keine Ad an Meta gesendet.
            </div>
            <button
              className={`${buttonClass} mt-4 w-full bg-slate-950 hover:bg-slate-800`}
              disabled={
                Boolean(pendingAction) ||
                !allLaunchGatesReady ||
                !launchBudgetReady ||
                launchPreparationConfirmation !== "AKTIV-LAUNCH VORBEREITEN" ||
                launchReason.trim().length < 12 ||
                !launchBlueprintId ||
                !launchDomainId ||
                !launchAssetId
              }
              type="submit"
            >
              {pendingAction === "launch-prepare" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CircleDot className="size-4" />
              )}
              {pendingAction === "launch-prepare"
                ? "HELD-Plan wird fail-closed geprüft …"
                : "Aktiv-Launch sicher vorbereiten"}
            </button>
          </form>
          <NoticeBox notice={launchNotice} />

          {materializedPlan ? (
            <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-extrabold uppercase tracking-[0.14em]">
                  Unveränderlicher Aktiv-Launch · HELD
                </p>
                <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-extrabold">
                  Noch 0 Meta-Writes
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-extrabold">Plan-ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{materializedPlan.id}</dd>
                </div>
                <div>
                  <dt className="font-extrabold">Vorbereitet</dt>
                  <dd className="mt-1">{displayDate(materializedPlan.createdAt)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-extrabold">SHA-256-Fingerprint</dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {materializedPlan.payloadHash}
                  </dd>
                </div>
                <div>
                  <dt className="font-extrabold">Kampagnenziel</dt>
                  <dd className="mt-1">{materializedPlan.objective}</dd>
                </div>
                <div>
                  <dt className="font-extrabold">Budgetart</dt>
                  <dd className="mt-1">
                    {materializedPlan.budgetType === "DAILY"
                      ? "Tagesbudget · Daily v2"
                      : "Laufzeitbudget · Lifetime v3"}
                  </dd>
                </div>
                {materializedPlan.budgetType === "DAILY" ? (
                  <div>
                    <dt className="font-extrabold">Tagesbudget</dt>
                    <dd className="mt-1">
                      {displayMinorUnits(materializedPlan.dailyBudgetMinor)} · {materializedPlan.budgetOwnerType}
                    </dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt className="font-extrabold">Laufzeitbudget gesamt</dt>
                      <dd className="mt-1">
                        {displayMinorUnits(materializedPlan.lifetimeBudgetMinor)} · CAMPAIGN
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-extrabold">Feste Laufzeit</dt>
                      <dd className="mt-1">
                        {displayDate(materializedPlan.startTime)} bis {displayDate(materializedPlan.endTime)} · Europe/Berlin
                      </dd>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {materializedPlan.startTime} → {materializedPlan.endTime} · UTC
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt className="font-extrabold">Zielstatus nach vollständigem Read-back</dt>
                  <dd className="mt-1 font-extrabold text-red-800">{materializedPlan.targetStatus}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-extrabold">Ziel-URL</dt>
                  <dd className="mt-1 break-all">{materializedPlan.destinationUrl}</dd>
                </div>
                <div>
                  <dt className="font-extrabold">Kampagne</dt>
                  <dd className="mt-1">{materializedPlan.campaignName}</dd>
                </div>
                <div>
                  <dt className="font-extrabold">Ad Set</dt>
                  <dd className="mt-1">{materializedPlan.adSetName}</dd>
                </div>
                <div>
                  <dt className="font-extrabold">Creative</dt>
                  <dd className="mt-1">{materializedPlan.creativeName}</dd>
                </div>
                <div>
                  <dt className="font-extrabold">Ad</dt>
                  <dd className="mt-1">{materializedPlan.adName}</dd>
                </div>
              </dl>

              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-950">
                Die folgende Freigabe kann Spend auslösen. Adbot erstellt alle vier Meta-Objekte
                zunächst PAUSED, prüft Remote-IDs, Status, Budget, Laufzeit und Bindings und aktiviert
                sie erst danach innerhalb derselben Saga. Bei jeder Abweichung wird gestoppt und
                wieder auf FREEZE_WRITES gesetzt.
              </div>

              <form className="mt-4" onSubmit={approveLaunch}>
                <label className="text-sm font-bold">
                  Begründung für die reale Aktiv-Freigabe
                  <textarea
                    className={inputClass}
                    maxLength={500}
                    minLength={12}
                    onChange={(event) => setLaunchApprovalReason(event.target.value)}
                    required
                    rows={3}
                    value={launchApprovalReason}
                  />
                </label>
                <label className="mt-4 block text-sm font-bold">
                  Exakte Freigabeklausel
                  <input
                    autoComplete="off"
                    className={inputClass}
                    onChange={(event) =>
                      setLaunchApprovalConfirmation(event.target.value)
                    }
                    placeholder="AKTIV-LAUNCH FREIGEBEN"
                    required
                    value={launchApprovalConfirmation}
                  />
                </label>
                <button
                  className={`${buttonClass} mt-4 w-full bg-red-700 hover:bg-red-800`}
                  disabled={
                    Boolean(pendingAction) ||
                    killSwitchMode !== "FREEZE_WRITES" ||
                    launchApprovalReason.trim().length < 12 ||
                    launchApprovalConfirmation !== "AKTIV-LAUNCH FREIGEBEN"
                  }
                  type="submit"
                >
                  {pendingAction === "launch-approve" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  {pendingAction === "launch-approve"
                    ? "Fingerprint und alle Gates werden geprüft …"
                    : "Exakt diesen Aktiv-Launch freigeben"}
                </button>
              </form>
            </div>
          ) : null}

          {data.recentLaunchPlans.length ? (
            <div className="mt-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">Letzte Launch-Pläne</p>
              <div className="mt-2 space-y-2">
                {data.recentLaunchPlans.map((plan) => (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2" key={plan.id}>
                    <span className="min-w-0 truncate font-mono text-xs text-slate-700">{plan.id}</span>
                    <span className="shrink-0 text-xs font-extrabold text-slate-800">{plan.status} · {displayDate(plan.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
