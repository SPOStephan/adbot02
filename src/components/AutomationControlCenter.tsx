"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  Bot,
  Check,
  CirclePause,
  FileClock,
  Gauge,
  ImagePlus,
  LockKeyhole,
  Palette,
  PlayCircle,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  AutomationBudgetCanaryManager,
  type BudgetCanaryPlanView,
} from "@/components/AutomationBudgetCanaryManager";
import {
  AutomationOnboardingControls,
  type AutomationOnboardingData,
} from "@/components/AutomationOnboardingControls";
import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import { MetaPixelBinding } from "@/components/MetaPixelBinding";
import { TrafficLaunchCanary } from "@/components/TrafficLaunchCanary";
import {
  AutomationScopeManager,
  type AutomationScopeCampaignView,
} from "@/components/AutomationScopeManager";
import {
  AutomationBoostSettings,
  type BoostEligibleAssetView,
  type BoostSettingsView,
} from "@/components/AutomationBoostSettings";

export type AutomationPolicyView = {
  id: string;
  version: number;
  status: string;
  accountDailyHardCapMinor: number | null;
  campaignDailyHardCapMinor: number | null;
  budgetChangeLimitBps: number;
  cooldownSeconds: number;
  allowBudgetChanges: boolean;
  allowStatusChanges: boolean;
  allowNewLaunches: boolean;
  customerConfirmedAt: string | null;
};

export type BrandProfileView = {
  id: string;
  version: number;
  displayName: string;
  brandName: string;
  guidelines: Record<string, unknown>;
  forbiddenContent: unknown[];
  generationDefaults: Record<string, unknown>;
  generatedAssetApprovalMode: string;
  activatedAt: string | null;
};

export type KillSwitchView = {
  mode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED";
  reason: string;
  actorType: string;
  createdAt: string;
} | null;

export type AutomationAuditView = {
  sequence: number;
  eventType: string;
  actorType: string;
  errorClass: string | null;
  occurredAt: string;
};

type AutomationControlCenterProps = {
  accountName: string;
  currency: string;
  policy: AutomationPolicyView | null;
  brandProfile: BrandProfileView | null;
  killSwitch: KillSwitchView;
  auditEvents: AutomationAuditView[];
  automationScope: AutomationScopeCampaignView[];
  budgetCanaries: BudgetCanaryPlanView[];
  canPrepareBudgetCanary: boolean;
  canConfirmBudgetCanary: boolean;
  boostSettings: BoostSettingsView | null;
  boostEligibleAssets: BoostEligibleAssetView[];
  onboarding: AutomationOnboardingData;
  initialTrafficAssetId?: string | null;
  readiness: {
    writeScopeGranted: boolean;
    verifiedDomains: number;
    activeBlueprints: number;
    readyBrandAssets: number;
  };
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
  managedBudgetOwnerCount?: number;
  organicBoost?: {
    status?: string;
    plansCreated?: number;
    plansExisting?: number;
    candidatesConsidered?: number;
    pendingPlans?: number;
    executorSucceeded?: number;
    lastError?: string | null;
  } | null;
};

type Notice = {
  tone: "success" | "error";
  message: string;
} | null;

function organicBoostFollowUp(
  boost: ApiResponse["organicBoost"] | undefined,
): string {
  if (!boost) {
    return "";
  }
  const pending = boost.pendingPlans ?? 0;
  const ready =
    (boost.plansCreated ?? 0) + (boost.plansExisting ?? 0);
  const sent = boost.executorSucceeded ?? 0;
  if (sent > 0) {
    return ` Beitrag-Push: ${sent} Plan/Pläne an Meta gesendet.`;
  }
  if (pending > 0 || ready > 0) {
    return ` Beitrag-Push: ${Math.max(pending, ready)} Plan/Pläne lokal in der Warteschlange — Meta-Versand noch nicht bestätigt.`;
  }
  if (boost.status === "NO_ELIGIBLE_CANDIDATES") {
    return " Beitrag-Push: keine neuen Beiträge zu planen (bereits verknüpfte Pläne laufen ggf. separat).";
  }
  if (boost.status === "LEASE_REQUIRED" || boost.lastError === "read_lease_locked") {
    return " Beitrag-Push wird automatisch nachgeholt.";
  }
  if (boost.lastError === "marketing_sync_required") {
    return " Beitrag-Push nutzt den letzten gültigen Marketing-Stand und startet automatisch.";
  }
  if (boost.lastError) {
    return ` Beitrag-Push noch nicht gestartet (${boost.status ?? "Fehler"}: ${boost.lastError}).`;
  }
  if (boost.status && boost.status !== "PLANNED" && boost.status !== "OK") {
    return ` Beitrag-Push-Status: ${boost.status} (geprüft: ${boost.candidatesConsidered ?? 0}).`;
  }
  return "";
}

const KILL_SWITCH_OPTIONS = [
  {
    mode: "ALLOW" as const,
    label: "Freigeben",
    description:
      "Adbot darf policy-gedeckte Änderungen an Meta senden — z. B. automatische Beitragswerbung.",
    icon: PlayCircle,
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  {
    mode: "FREEZE_WRITES" as const,
    label: "Schreibvorgänge stoppen",
    description:
      "Adbot plant und sendet nichts Neues an Meta. Laufende Anzeigen bleiben unverändert.",
    icon: CirclePause,
    className: "border-amber-200 bg-amber-50 text-amber-950",
  },
  {
    mode: "PAUSE_MANAGED" as const,
    label: "Verwaltete Kampagnen pausieren",
    description:
      "Adbot pausiert die von Adbot verwalteten Kampagnen und stoppt weitere Schreibvorgänge.",
    icon: Ban,
    className: "border-red-200 bg-red-50 text-red-950",
  },
];

const EVENT_LABELS: Record<string, string> = {
  POLICY_ACTIVATED: "Autonomie-Policy aktiviert",
  POLICY_DISABLED: "Autonomie-Policy deaktiviert",
  KILL_SWITCH_CHANGED: "Sicherheitsmodus geändert",
  BRAND_PROFILE_ACTIVATED: "Brand-Profil aktiviert",
  BRAND_PROFILE_DRAFTED: "Brand-Profil als Entwurf gespeichert",
  MUTATION_PLAN_QUEUED: "Änderungsplan sicher eingeplant",
  MUTATION_EXECUTION_CLAIMED: "Ausführung gestartet",
  MUTATION_REMOTE_STEP_COMPLETED: "Meta-Schritt bestätigt",
  MUTATION_PLAN_RECONCILED: "Änderung mit Meta abgeglichen",
  ALLOWED_DOMAIN_REGISTERED: "Ziel-Domain registriert",
  ALLOWED_DOMAIN_CONFIRMED: "Ziel-Domain ausdrücklich bestätigt",
  OBJECTIVE_BLUEPRINT_DRAFTED: "Objective-Blueprint versioniert",
  OBJECTIVE_BLUEPRINT_ACTIVATED: "Objective-Blueprint aktiviert",
  BRAND_ASSET_IMPORTED_FROM_META: "Vorhandenes Meta-Creative importiert",
  CUSTOMER_LAUNCH_AUTHORIZED: "Active Launch kundenseitig autorisiert",
  AUTOMATION_SCOPE_CHANGED: "Verwalteten Automationsbereich geändert",
  BUDGET_CANARY_CONFIRMATION_REQUIRED: "Budgetplan wartet auf exakte Bestätigung",
  BUDGET_CANARY_PLAN_MATERIALIZED: "Gehaltenen 10-%-Budgetplan vorbereitet",
  BUDGET_CANARY_PLAN_APPROVED: "Einzelnen Budget-Canary freigegeben",
  LAUNCH_CHAIN_MATERIALIZED: "Active-Launch-Kette materialisiert",
  LAUNCH_CHAIN_RECONCILED: "Active-Launch vollständig bestätigt",
};

function minorToEuroInput(value: number | null, fallback: string) {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  return (value / 100).toFixed(2);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Noch nicht bestätigt";
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

function objectText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayText(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.filter((item): item is string => typeof item === "string").join("\n");
}

async function postControl(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as ApiResponse;

  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ?? "Die Aktion konnte nicht sicher abgeschlossen werden.",
    );
  }

  return result;
}

function ToggleField({
  checked,
  description,
  disabled,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  name: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <span>
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          checked={checked}
          className="peer sr-only"
          disabled={disabled}
          name={name}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-disabled:opacity-50" />
        <span className="pointer-events-none absolute left-1 top-1 size-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function AutomationControlCenter({
  accountName,
  auditEvents,
  automationScope,
  boostSettings,
  boostEligibleAssets,
  brandProfile,
  budgetCanaries,
  canPrepareBudgetCanary,
  canConfirmBudgetCanary,
  currency,
  killSwitch,
  onboarding,
  initialTrafficAssetId = null,
  policy,
  readiness,
}: AutomationControlCenterProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [policyPending, setPolicyPending] = useState(false);
  const [brandPending, setBrandPending] = useState(false);
  const [killPending, setKillPending] = useState(false);
  const [policyNotice, setPolicyNotice] = useState<Notice>(null);
  const [brandNotice, setBrandNotice] = useState<Notice>(null);
  const [killNotice, setKillNotice] = useState<Notice>(null);

  const [accountDailyHardCap, setAccountDailyHardCap] = useState(() =>
    minorToEuroInput(policy?.accountDailyHardCapMinor ?? null, "100.00"),
  );
  const [campaignDailyHardCap, setCampaignDailyHardCap] = useState(() =>
    minorToEuroInput(policy?.campaignDailyHardCapMinor ?? null, "50.00"),
  );
  const [allowBudgetChanges, setAllowBudgetChanges] = useState(
    policy?.allowBudgetChanges ?? true,
  );
  const [allowStatusChanges, setAllowStatusChanges] = useState(
    policy?.allowStatusChanges ?? true,
  );
  const [allowNewLaunches, setAllowNewLaunches] = useState(
    policy?.allowNewLaunches ?? true,
  );
  const [enableAutomation, setEnableAutomation] = useState(
    policy?.status === "ACTIVE",
  );

  const guidelines = brandProfile?.guidelines ?? {};
  const generationDefaults = brandProfile?.generationDefaults ?? {};
  const [displayName, setDisplayName] = useState(
    brandProfile?.displayName ?? `${accountName} Brand`,
  );
  const [brandName, setBrandName] = useState(brandProfile?.brandName ?? accountName);
  const [toneOfVoice, setToneOfVoice] = useState(
    objectText(guidelines.toneOfVoice),
  );
  const [visualStyle, setVisualStyle] = useState(
    objectText(guidelines.visualStyle),
  );
  const [colorPalette, setColorPalette] = useState(() => {
    const colors = guidelines.colorPalette;
    return Array.isArray(colors)
      ? colors.filter((item): item is string => typeof item === "string").join(", ")
      : "";
  });
  const [forbiddenContent, setForbiddenContent] = useState(
    arrayText(brandProfile?.forbiddenContent),
  );
  const [callToActionStyle, setCallToActionStyle] = useState(
    objectText(generationDefaults.callToActionStyle),
  );
  const [preferredFormat, setPreferredFormat] = useState(
    objectText(generationDefaults.preferredFormat),
  );
  const [approvalMode, setApprovalMode] = useState(
    brandProfile?.generatedAssetApprovalMode ?? "AUTONOMOUS_POLICY",
  );

  const [killMode, setKillMode] = useState<
    "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED"
  >(killSwitch?.mode ?? "FREEZE_WRITES");

  // Autonomie-Save kann ALLOW setzen — UI-State muss dem Server folgen.
  useEffect(() => {
    if (killSwitch?.mode) {
      setKillMode(killSwitch.mode);
    }
  }, [killSwitch?.mode]);

  const currentKillOption =
    KILL_SWITCH_OPTIONS.find((option) => option.mode === killSwitch?.mode) ??
    KILL_SWITCH_OPTIONS[1];
  const readinessItems = useMemo(
    () => [
      {
        label: "Meta-Schreibscope",
        value: readiness.writeScopeGranted ? "Bereit" : "Reconnect",
        ready: readiness.writeScopeGranted,
      },
      {
        label: "Verifizierte Domains",
        value: readiness.verifiedDomains,
        ready: readiness.verifiedDomains > 0,
      },
      {
        label: "Aktive Ziel-Blueprints",
        value: readiness.activeBlueprints,
        ready: readiness.activeBlueprints > 0,
      },
      {
        label: "Freigegebene Brand-Assets",
        value: readiness.readyBrandAssets,
        ready: readiness.readyBrandAssets > 0,
      },
    ],
    [readiness],
  );

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enableAutomation && !readiness.writeScopeGranted) {
      setPolicyNotice({
        tone: "error",
        message: "Bitte verbinde Meta erneut und bestätige den minimalen Schreibzugriff.",
      });
      return;
    }

    setPolicyPending(true);
    setPolicyNotice(null);

    try {
      const result = await postControl("/api/meta/automation/policy", {
        accountDailyHardCap,
        campaignDailyHardCap,
        allowBudgetChanges,
        allowStatusChanges,
        allowNewLaunches,
        enableAutomation,
      });
      setPolicyNotice({
        tone: "success",
        message:
          (enableAutomation && allowBudgetChanges
            ? `Budget-Autonomie ist aktiv. ${result.managedBudgetOwnerCount ?? 0} Budget-Owner werden innerhalb deiner Grenzen verwaltet.`
            : "Die Policy wurde gespeichert; autonome Budgetänderungen sind deaktiviert.") +
          organicBoostFollowUp(result.organicBoost),
      });
      refresh();
    } catch (error) {
      setPolicyNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Die Policy konnte nicht gespeichert werden.",
      });
    } finally {
      setPolicyPending(false);
    }
  }

  async function submitBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBrandPending(true);
    setBrandNotice(null);

    try {
      await postControl("/api/meta/automation/brand", {
        displayName,
        brandName,
        toneOfVoice,
        visualStyle,
        colorPalette,
        forbiddenContent,
        callToActionStyle,
        preferredFormat,
        generatedAssetApprovalMode: approvalMode,
      });
      setBrandNotice({
        tone: "success",
        message: "Eine neue aktive Brand-Profilversion wurde sicher gespeichert.",
      });
      refresh();
    } catch (error) {
      setBrandNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Das Brand-Profil konnte nicht gespeichert werden.",
      });
    } finally {
      setBrandPending(false);
    }
  }

  async function submitKillSwitch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (killMode === "ALLOW" && !readiness.writeScopeGranted) {
      setKillNotice({
        tone: "error",
        message: "Der Schreibscope fehlt. FREEZE_WRITES und PAUSE_MANAGED bleiben verfügbar.",
      });
      return;
    }

    setKillPending(true);
    setKillNotice(null);

    try {
      const result = await postControl("/api/meta/automation/kill-switch", {
        mode: killMode,
      });
      setKillNotice({
        tone: "success",
        message:
          (killMode === "ALLOW"
            ? "Freigabe gespeichert. Beitrag-Push und andere Writes dürfen jetzt laufen — auch für bereits erkannte Beiträge, ohne weiteren Abruf."
            : "Der Sicherheitsmodus wurde gespeichert.") +
          organicBoostFollowUp(result.organicBoost),
      });
      refresh();
    } catch (error) {
      setKillNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Sicherheitsmodus konnte nicht gesetzt werden.",
      });
    } finally {
      setKillPending(false);
    }
  }

  const disabled = policyPending || brandPending || killPending || isRefreshing;

  return (
    <section className="mt-10 scroll-mt-24" id="automation-control-center">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-950 px-5 py-6 text-white sm:px-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
                <ShieldCheck className="size-4" />
                Kundenkontrollierte Autonomie
              </div>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
                Meta Control Center
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Jede Änderung bleibt innerhalb deiner EUR-Caps, maximal 20&nbsp;% je 24 Stunden und 12 Stunden Cooldown. Externe Zustände werden nach jedem Write zurückgelesen und reconciled.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-100 ring-1 ring-inset ring-white/10">
                {accountName}
              </span>
              <span
                className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${
                  policy?.status === "ACTIVE"
                    ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/20"
                    : "bg-amber-400/15 text-amber-200 ring-amber-300/20"
                }`}
              >
                {policy?.status === "ACTIVE" ? "Autonomie aktiv" : "Autonomie aus"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-b border-slate-200 bg-slate-50 px-5 py-5 sm:grid-cols-2 sm:px-7 xl:grid-cols-4">
          {readinessItems.map((item) => (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4" key={item.label}>
              <span
                className={`grid size-9 place-items-center rounded-lg ${
                  item.ready
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {item.ready ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
              </span>
              <span>
                <span className="block text-lg font-extrabold">{item.value}</span>
                <span className="text-xs font-medium text-slate-500">{item.label}</span>
              </span>
            </div>
          ))}
        </div>

        {!readiness.writeScopeGranted ? (
          <div className="flex flex-col gap-4 border-b border-amber-200 bg-amber-50 px-5 py-5 text-amber-950 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-extrabold">Minimaler Meta-Schreibscope fehlt</p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-900/80">
                  Bestehende Lesedaten bleiben erhalten. Autonomie und ALLOW bleiben fail-closed, bis du Meta erneut verbindest und ads_management ausdrücklich bestätigst.
                </p>
              </div>
            </div>
            <form action="/api/connectors/meta/start" method="post">
              <button
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-900"
                type="submit"
              >
                Meta sicher neu verbinden
              </button>
            </form>
          </div>
        ) : null}

        <div className="grid divide-y divide-slate-200 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
          <form className="p-5 sm:p-7" onSubmit={submitPolicy}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <Gauge className="size-5" />
              </span>
              <div>
                <h3 className="font-extrabold">Limits und Freigaben</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Die Limits sind harte Obergrenzen. Änderungen erzeugen immer eine neue, bestätigte Policy-Version.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-800">
                Konto-Tageslimit
                <span className="relative mt-2 block">
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-14 font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    inputMode="decimal"
                    name="accountDailyHardCap"
                    onChange={(event) => setAccountDailyHardCap(event.target.value)}
                    required
                    value={accountDailyHardCap}
                  />
                  <span className="absolute inset-y-0 right-4 flex items-center text-sm text-slate-400">EUR</span>
                </span>
              </label>
              <label className="text-sm font-bold text-slate-800">
                Kampagnen-Tageslimit
                <span className="relative mt-2 block">
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-14 font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    inputMode="decimal"
                    name="campaignDailyHardCap"
                    onChange={(event) => setCampaignDailyHardCap(event.target.value)}
                    required
                    value={campaignDailyHardCap}
                  />
                  <span className="absolute inset-y-0 right-4 flex items-center text-sm text-slate-400">EUR</span>
                </span>
              </label>
            </div>

            <div className="mt-4 grid gap-3">
              <ToggleField
                checked={allowBudgetChanges}
                description="Adbot ändert Budgets autonom höchstens um 20 % innerhalb von 24 Stunden (getrennt von Metas Tages-Overspend bis +75 %)."
                disabled={disabled}
                label="Budgets ändern"
                name="allowBudgetChanges"
                onChange={setAllowBudgetChanges}
              />
              <ToggleField
                checked={allowStatusChanges}
                description="Vorhandene Kampagnen und Ads pausieren oder reaktivieren."
                disabled={disabled}
                label="Status ändern"
                name="allowStatusChanges"
                onChange={(checked) => {
                  setAllowStatusChanges(checked);
                  if (!checked) setAllowNewLaunches(false);
                }}
              />
              <ToggleField
                checked={allowNewLaunches}
                description="Neue Objekte werden als PAUSED Shadow angelegt und erst nach vollständiger Prüfung aktiv geschaltet."
                disabled={disabled || !allowStatusChanges}
                label="Neue Ads autonom ACTIVE schalten"
                name="allowNewLaunches"
                onChange={setAllowNewLaunches}
              />
              <ToggleField
                checked={enableAutomation}
                description="Nur eine aktive, kundenseitig bestätigte Policy darf neue Pläne erzeugen."
                disabled={disabled || (!readiness.writeScopeGranted && !enableAutomation)}
                label="Autonomie für dieses Werbekonto aktivieren"
                name="enableAutomation"
                onChange={setEnableAutomation}
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1.5">Max. 20 % / 24 h</span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5">12 h Cooldown</span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5">EUR only</span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5">Verified Domains</span>
            </div>

            {policyNotice ? (
              <p
                className={`mt-5 rounded-xl px-4 py-3 text-sm font-semibold ${
                  policyNotice.tone === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-red-50 text-red-800"
                }`}
                role={policyNotice.tone === "error" ? "alert" : "status"}
              >
                {policyNotice.message}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-500">
                Version {policy?.version ?? "—"} · {formatDateTime(policy?.customerConfirmedAt)}
              </p>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  disabled ||
                  currency !== "EUR" ||
                  (enableAutomation && !readiness.writeScopeGranted)
                }
                type="submit"
              >
                <Save className="size-4" />
                {policyPending
                  ? "Wird bestätigt …"
                  : enableAutomation && allowBudgetChanges
                    ? "Grenzen bestätigen und Autonomie starten"
                    : "Policy speichern"}
              </button>
            </div>
          </form>

          <form className="p-5 sm:p-7" onSubmit={submitBrand}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
                <Palette className="size-5" />
              </span>
              <div>
                <h3 className="font-extrabold">Brand-Vorgaben</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Vorhandene Assets werden bevorzugt wiederverwendet. Neue Assets folgen diesen Vorgaben und der gewählten Freigabelogik.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-800">
                Profilname
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  maxLength={120}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  value={displayName}
                />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Markenname
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  maxLength={120}
                  onChange={(event) => setBrandName(event.target.value)}
                  required
                  value={brandName}
                />
              </label>
            </div>

            <label className="mt-4 block text-sm font-bold text-slate-800">
              Tonalität
              <textarea
                className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 leading-6 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                maxLength={500}
                onChange={(event) => setToneOfVoice(event.target.value)}
                placeholder="Zum Beispiel: direkt, kompetent, freundlich; keine Superlative ohne Beleg."
                value={toneOfVoice}
              />
            </label>
            <label className="mt-4 block text-sm font-bold text-slate-800">
              Visueller Stil
              <textarea
                className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 leading-6 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                maxLength={1000}
                onChange={(event) => setVisualStyle(event.target.value)}
                placeholder="Bildsprache, Logo-Zonen, Typografie, Personen- oder Produktdarstellung."
                value={visualStyle}
              />
            </label>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-800">
                Farbpalette
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  onChange={(event) => setColorPalette(event.target.value)}
                  placeholder="#0F172A, #2563EB"
                  value={colorPalette}
                />
              </label>
              <label className="text-sm font-bold text-slate-800">
                Bevorzugtes Format
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  maxLength={120}
                  onChange={(event) => setPreferredFormat(event.target.value)}
                  placeholder="1:1 Feed, 9:16 Story"
                  value={preferredFormat}
                />
              </label>
            </div>

            <label className="mt-4 block text-sm font-bold text-slate-800">
              Ausgeschlossene Inhalte · ein Eintrag je Zeile
              <textarea
                className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 leading-6 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                onChange={(event) => setForbiddenContent(event.target.value)}
                placeholder={"Nicht belegte Leistungsversprechen\nWettbewerberlogos\nSensible persönliche Merkmale"}
                value={forbiddenContent}
              />
            </label>
            <label className="mt-4 block text-sm font-bold text-slate-800">
              Call-to-Action-Stil
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                maxLength={300}
                onChange={(event) => setCallToActionStyle(event.target.value)}
                placeholder="Klar, sachlich, ohne künstliche Verknappung"
                value={callToActionStyle}
              />
            </label>

            <fieldset className="mt-4">
              <legend className="text-sm font-bold text-slate-800">Neue generierte Assets</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4">
                  <input
                    checked={approvalMode === "AUTONOMOUS_POLICY"}
                    className="mt-1"
                    name="approvalMode"
                    onChange={() => setApprovalMode("AUTONOMOUS_POLICY")}
                    type="radio"
                  />
                  <span>
                    <span className="block text-sm font-bold">Policy-autonom</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Nur nach Moderation und innerhalb dieser Brand-Regeln.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4">
                  <input
                    checked={approvalMode === "CUSTOMER_REVIEW"}
                    className="mt-1"
                    name="approvalMode"
                    onChange={() => setApprovalMode("CUSTOMER_REVIEW")}
                    type="radio"
                  />
                  <span>
                    <span className="block text-sm font-bold">Kundenprüfung</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Neue Assets bleiben bis zur Freigabe blockiert.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {brandNotice ? (
              <p
                className={`mt-5 rounded-xl px-4 py-3 text-sm font-semibold ${
                  brandNotice.tone === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-red-50 text-red-800"
                }`}
                role={brandNotice.tone === "error" ? "alert" : "status"}
              >
                {brandNotice.message}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-500">
                Version {brandProfile?.version ?? "—"} · {formatDateTime(brandProfile?.activatedAt)}
              </p>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                type="submit"
              >
                <ImagePlus className="size-4" />
                {brandPending ? "Wird versioniert …" : "Brand-Profil aktivieren"}
              </button>
            </div>
          </form>
        </div>

        <AutomationScopeManager
          campaigns={automationScope}
          canEnable={Boolean(
            readiness.writeScopeGranted &&
              policy?.status === "ACTIVE" &&
              policy.allowBudgetChanges,
          )}
        />

        <AutomationBudgetCanaryManager
          canPrepare={canPrepareBudgetCanary}
          canConfirm={canConfirmBudgetCanary}
          currency={currency}
          plans={budgetCanaries}
        />

        <TrafficLaunchCanary
          brandProfileId={brandProfile?.id ?? null}
          currency={currency}
          data={onboarding}
          initialAssetId={initialTrafficAssetId}
          killSwitchMode={killSwitch?.mode ?? "FREEZE_WRITES"}
          policyLaunchReady={Boolean(
            policy?.status === "ACTIVE" &&
              policy.allowNewLaunches &&
              policy.allowStatusChanges,
          )}
          writeScopeGranted={readiness.writeScopeGranted}
        />

        <MetaPixelBinding pixels={onboarding.pixels} />

        <LeadLaunchCanary
          brandProfileId={brandProfile?.id ?? null}
          currency={currency}
          data={onboarding}
          killSwitchMode={killSwitch?.mode ?? "FREEZE_WRITES"}
          policyLaunchReady={Boolean(
            policy?.status === "ACTIVE" &&
              policy.allowNewLaunches &&
              policy.allowStatusChanges,
          )}
          writeScopeGranted={readiness.writeScopeGranted}
        />

        <AutomationOnboardingControls
          brandProfileId={brandProfile?.id ?? null}
          currency={currency}
          data={onboarding}
          killSwitchMode={killSwitch?.mode ?? "FREEZE_WRITES"}
          policyLaunchReady={Boolean(
            policy?.status === "ACTIVE" &&
              policy.allowNewLaunches &&
              policy.allowStatusChanges,
          )}
          writeScopeGranted={readiness.writeScopeGranted}
        />

        <div className="grid border-t border-slate-200 xl:grid-cols-[0.9fr_1.1fr] xl:divide-x xl:divide-slate-200">
          <form className="bg-slate-50 p-5 sm:p-7" onSubmit={submitKillSwitch}>
            <div className="flex items-start gap-3">
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${currentKillOption.className}`}>
                <ShieldAlert className="size-5" />
              </span>
              <div>
                <h3 className="font-extrabold">Sicherheitsschranke</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Aktuell: <strong className="text-slate-800">{currentKillOption.label}</strong>
                  {killSwitch
                    ? ` · ${killSwitch.reason}`
                    : " · Noch nicht freigegeben — Modus wählen und speichern"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Auswahl allein ändert nichts. Erst nach dem Speichern gilt der
                  neue Modus.
                </p>
              </div>
            </div>

            <fieldset className="mt-6 grid gap-3">
              <legend className="sr-only">Neuen Sicherheitsmodus wählen</legend>
              {KILL_SWITCH_OPTIONS.map(({ mode, label, description, icon: Icon, className }) => (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                    killMode === mode ? className : "border-slate-200 bg-white text-slate-800"
                  }`}
                  key={mode}
                >
                  <input
                    checked={killMode === mode}
                    className="mt-1"
                    disabled={mode === "ALLOW" && !readiness.writeScopeGranted}
                    name="killMode"
                    onChange={() => setKillMode(mode)}
                    type="radio"
                  />
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-bold">{label}</span>
                    <span className="mt-1 block text-xs leading-5 opacity-75">{description}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {killNotice ? (
              <p
                className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
                  killNotice.tone === "success"
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-red-100 text-red-900"
                }`}
                role={killNotice.tone === "error" ? "alert" : "status"}
              >
                {killNotice.message}
              </p>
            ) : null}

            <button
              className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                KILL_SWITCH_OPTIONS.find((option) => option.mode === killMode)?.className
              }`}
              disabled={
                disabled ||
                (killMode === "ALLOW" && !readiness.writeScopeGranted)
              }
              type="submit"
            >
              <LockKeyhole className="size-4" />
              {killPending
                ? "Wird gespeichert …"
                : killMode === "ALLOW"
                  ? "Freigabe speichern"
                  : "Sicherheitsmodus setzen"}
            </button>
          </form>

          <div className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                  <FileClock className="size-5" />
                </span>
                <div>
                  <h3 className="font-extrabold">Unveränderliches Audit</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Kundenentscheidungen, Planung, Remote-Schritte und Reconciliation werden hashverkettet protokolliert.
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {auditEvents.length} zuletzt
              </span>
            </div>

            <div className="mt-6 space-y-1">
              {auditEvents.length > 0 ? (
                auditEvents.map((event, index) => (
                  <div className="relative flex gap-4 pb-5" key={`${event.sequence}-${event.eventType}`}>
                    {index < auditEvents.length - 1 ? (
                      <span className="absolute left-[17px] top-8 h-full w-px bg-slate-200" />
                    ) : null}
                    <span
                      className={`relative z-10 grid size-9 shrink-0 place-items-center rounded-full ${
                        event.errorClass
                          ? "bg-red-50 text-red-600"
                          : "bg-emerald-50 text-emerald-600"
                      }`}
                    >
                      {event.errorClass ? <AlertTriangle className="size-4" /> : <Check className="size-4" />}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-bold text-slate-900">
                        {EVENT_LABELS[event.eventType] ?? event.eventType.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        #{event.sequence} · {event.actorType} · {formatDateTime(event.occurredAt)}
                      </p>
                      {event.errorClass ? (
                        <p className="mt-1 text-xs font-semibold text-red-700">Fehlerklasse: {event.errorClass}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <Bot className="mx-auto size-6 text-slate-400" />
                  <p className="mt-3 text-sm font-bold text-slate-700">Noch keine Control-Plane-Ereignisse</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Die erste Policy- oder Brand-Bestätigung eröffnet die Audit-Kette.</p>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-blue-50 p-4 text-blue-950">
                <Sparkles className="size-4 text-blue-600" />
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Assets</p>
                <p className="mt-1 text-sm font-semibold">Bestehende Brand-Assets zuerst, Generierung nur bei Bedarf.</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 text-emerald-950">
                <ShieldCheck className="size-4 text-emerald-600" />
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Reconciliation</p>
                <p className="mt-1 text-sm font-semibold">Kein Erfolg ohne Remote-Read-back und lokale Bindung.</p>
              </div>
            </div>
          </div>
        </div>

        <AutomationBoostSettings
          eligibleAssets={boostEligibleAssets}
          killSwitchMode={killSwitch?.mode ?? null}
          settings={boostSettings}
          writeScopeGranted={readiness.writeScopeGranted}
        />
      </div>
    </section>
  );
}
