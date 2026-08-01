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
};

export type AutomationOnboardingData = {
  domains: AllowedDomainView[];
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

async function postAutomationControl<T extends ApiPayload>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
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
  const [budgetOwnerType, setBudgetOwnerType] = useState<"CAMPAIGN" | "AD_SET">(
    "AD_SET",
  );
  const [dailyBudget, setDailyBudget] = useState("20.00");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [adSetName, setAdSetName] = useState("");
  const [creativeName, setCreativeName] = useState("");
  const [adName, setAdName] = useState("");
  const [launchConfirmed, setLaunchConfirmed] = useState(false);
  const [materializedPlan, setMaterializedPlan] = useState<{
    id: string;
    status: string;
    outcome: string;
  } | null>(null);

  const gateItems = useMemo(
    () => [
      { label: "ads_management", ready: writeScopeGranted },
      { label: "EUR-Werbekonto", ready: currency === "EUR" },
      { label: "Aktive Launch-Policy", ready: policyLaunchReady },
      { label: "Kill-Switch ALLOW", ready: killSwitchMode === "ALLOW" },
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
    if (!allLaunchGatesReady || !launchConfirmed || !brandProfileId) {
      setLaunchNotice({
        tone: "error",
        message: "Der Launch bleibt blockiert, bis alle Gates grün und ausdrücklich bestätigt sind.",
      });
      return;
    }
    setPendingAction("launch");
    setLaunchNotice(null);
    try {
      const result = await postAutomationControl<
        ApiPayload & { planId?: string; status?: string; outcome?: string }
      >("/api/meta/automation/launch", {
        blueprintId: launchBlueprintId,
        brandProfileId,
        brandAssetId: launchAssetId,
        allowedDomainId: launchDomainId,
        budgetOwnerType,
        dailyBudget,
        destinationUrl,
        campaignName,
        adSetName,
        creativeName,
        adName,
      });
      if (!result.planId || !result.status || !result.outcome) {
        throw new Error("Der Server lieferte keine gültige Planbestätigung.");
      }
      setMaterializedPlan({
        id: result.planId,
        status: result.status,
        outcome: result.outcome,
      });
      setLaunchConfirmed(false);
      setLaunchNotice({
        tone: "success",
        message:
          result.outcome === "EXISTING"
            ? "Der idempotente bestehende Launch-Plan wurde wiedergefunden."
            : "Der Launch wurde als überprüfbare PAUSED-Shadow-Kette geplant.",
      });
      refresh();
    } catch (error) {
      setLaunchNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Der Launch konnte nicht sicher geplant werden.",
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
            description="Materialisiert nur bei vollständiger Readiness eine idempotente PAUSED-Shadow-Kette; der Executor reconciled jeden Remote-Schritt."
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
                Budgetträger
                <select className={inputClass} onChange={(event) => setBudgetOwnerType(event.target.value as "CAMPAIGN" | "AD_SET")} value={budgetOwnerType}>
                  <option value="AD_SET">Ad Set</option>
                  <option value="CAMPAIGN">Kampagne</option>
                </select>
              </label>
              <label className="text-sm font-bold text-slate-800">
                Tagesbudget · EUR
                <input className={inputClass} inputMode="decimal" onChange={(event) => setDailyBudget(event.target.value)} required value={dailyBudget} />
              </label>
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
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
              <input
                checked={launchConfirmed}
                className="mt-1"
                onChange={(event) => setLaunchConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span className="text-sm font-semibold leading-6">
                Ich autorisiere diesen Active Launch ausdrücklich innerhalb der aktiven EUR-Caps.
                Remote-Objekte werden zunächst PAUSED angelegt; ACTIVE folgt erst nach Read-back.
              </span>
            </label>
            <button
              className={`${buttonClass} mt-4 w-full bg-slate-950 hover:bg-slate-800`}
              disabled={
                Boolean(pendingAction) ||
                !allLaunchGatesReady ||
                !launchConfirmed ||
                !launchBlueprintId ||
                !launchDomainId ||
                !launchAssetId
              }
              type="submit"
            >
              {pendingAction === "launch" ? <LoaderCircle className="size-4 animate-spin" /> : <CircleDot className="size-4" />}
              {pendingAction === "launch" ? "Launch wird fail-closed geprüft …" : "Active Launch planen"}
            </button>
          </form>
          <NoticeBox notice={launchNotice} />

          {materializedPlan ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <p className="text-xs font-extrabold uppercase tracking-[0.14em]">Plan bestätigt</p>
              <p className="mt-2 break-all font-mono text-sm">{materializedPlan.id}</p>
              <p className="mt-1 text-xs font-bold">{materializedPlan.outcome} · {materializedPlan.status}</p>
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
