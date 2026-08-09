"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  LoaderCircle,
  PlayCircle,
  Rocket,
  ShieldCheck,
  Upload,
} from "lucide-react";

import type {
  AutomationOnboardingData,
  RecentLaunchPlanView,
} from "@/components/AutomationOnboardingControls";

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
};

type Props = {
  brandProfileId: string | null;
  currency: string;
  killSwitchMode: "ALLOW" | "FREEZE_WRITES" | "PAUSE_MANAGED";
  policyLaunchReady: boolean;
  writeScopeGranted: boolean;
  data: AutomationOnboardingData;
  initialAssetId?: string | null;
};

const DEFAULT_TRAFFIC_BLUEPRINT = {
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
};

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
    throw new Error("Die Landingpage muss eine HTTPS-URL sein.");
  }
  if (url.username || url.password || url.port || url.hash) {
    throw new Error(
      "Landingpage ohne Benutzer, Passwort, Port oder Hash-Fragment verwenden.",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".")) {
    throw new Error("Die Landingpage braucht einen gültigen öffentlichen Host.");
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

function toHeldFromRecent(plan: RecentLaunchPlanView): HeldPlan | null {
  if (
    !planLooksHeld(plan) ||
    !plan.payloadHash ||
    plan.objective !== "OUTCOME_TRAFFIC" ||
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
  };
}

export function TrafficLaunchCanary({
  brandProfileId,
  currency,
  killSwitchMode,
  policyLaunchReady,
  writeScopeGranted,
  data,
  initialAssetId = null,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [dailyBudget, setDailyBudget] = useState("20.00");
  const [primaryText, setPrimaryText] = useState("Mehr erfahren.");
  const [assetId, setAssetId] = useState(
    initialAssetId && data.brandAssets.some((asset) => asset.id === initialAssetId)
      ? initialAssetId
      : (data.brandAssets[0]?.id ?? ""),
  );
  const [heldPlan, setHeldPlan] = useState<HeldPlan | null>(() => {
    for (const plan of data.recentLaunchPlans) {
      const held = toHeldFromRecent(plan);
      if (held) return held;
    }
    return null;
  });
  const [approveReason, setApproveReason] = useState(
    "Kontrollierter Traffic-Canary mit hochgeladenem Creative",
  );

  const gates = useMemo(
    () => [
      { label: "ads_management", ready: writeScopeGranted },
      { label: "EUR", ready: currency === "EUR" },
      { label: "Launch-Policy aktiv", ready: policyLaunchReady },
      { label: "Exposure-Snapshot", ready: data.snapshotReady },
      { label: "Brand-Profil", ready: Boolean(brandProfileId) },
      { label: "Creative bereit", ready: data.brandAssets.length > 0 },
    ],
    [
      brandProfileId,
      currency,
      data.brandAssets.length,
      data.snapshotReady,
      policyLaunchReady,
      writeScopeGranted,
    ],
  );
  const gatesReady = gates.every((gate) => gate.ready);

  function refresh() {
    router.refresh();
  }

  async function ensureFreeze(): Promise<void> {
    if (killSwitchMode === "FREEZE_WRITES") {
      return;
    }
    await apiJson("POST", "/api/meta/automation/kill-switch", {
      mode: "FREEZE_WRITES",
      reason: "Traffic-Canary: kurze Freeze-Phase für prepare/approve",
    });
  }

  async function ensureTrafficBlueprint(): Promise<string> {
    const active = data.blueprints.find(
      (blueprint) =>
        blueprint.status === "ACTIVE" && blueprint.objective === "OUTCOME_TRAFFIC",
    );
    if (active) {
      return active.id;
    }

    const template = structuredClone(DEFAULT_TRAFFIC_BLUEPRINT);
    const message = primaryText.trim() || "Mehr erfahren.";
    template.creative.object_story_spec.link_data.message = message;

    const saved = await apiJson<{ blueprintId?: string }>(
      "POST",
      "/api/meta/automation/blueprint",
      {
        action: "save",
        objective: "OUTCOME_TRAFFIC",
        name: "Traffic Canary",
        payloadTemplate: template,
        requiredInputs: ["destination_url"],
      },
    );
    if (!saved.blueprintId) {
      throw new Error("Blueprint konnte nicht gespeichert werden.");
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
      if (!gatesReady || !brandProfileId) {
        throw new Error(
          "Voraussetzungen fehlen (Scope, EUR, Policy, Snapshot, Brand-Profil, Creative).",
        );
      }
      if (!assetId) {
        throw new Error("Bitte ein hochgeladenes Creative wählen.");
      }

      const landing = parseLandingUrl(destinationUrl);
      await ensureFreeze();
      const blueprintId = await ensureTrafficBlueprint();
      const allowedDomainId = await ensureDomain(landing.hostname);

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const result = await apiJson<{
        planId?: string;
        status?: string;
        outcome?: string;
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
        brandProfileId,
        brandAssetId: assetId,
        allowedDomainId,
        budgetType: "DAILY",
        budgetOwnerType: "AD_SET",
        dailyBudget,
        destinationUrl: landing.href,
        campaignName: `Traffic Canary ${stamp}`,
        adSetName: `Traffic AdSet ${stamp}`,
        creativeName: `Traffic Creative ${stamp}`,
        adName: `Traffic Ad ${stamp}`,
        reason: "Kontrollierter Traffic-Canary mit hochgeladenem Creative",
        confirmation: "AKTIV-LAUNCH VORBEREITEN",
      });

      if (
        !result.planId ||
        result.status !== "HELD" ||
        !result.payloadHash ||
        result.objective !== "OUTCOME_TRAFFIC" ||
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
      });
      setNotice({
        tone: "success",
        message:
          "Traffic-Plan vorbereitet (noch nichts an Meta). Prüfe die Vorschau und gib mit Freigabe frei.",
      });
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Traffic-Canary konnte nicht vorbereitet werden.",
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
      if (approveReason.trim().length < 12) {
        throw new Error("Begründung für die Freigabe mindestens 12 Zeichen.");
      }
      const result = await apiJson<{
        planStatus?: string;
        approvalId?: string;
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
        reason: approveReason.trim(),
        confirmation: "AKTIV-LAUNCH FREIGEBEN",
      });
      if (!result.approvalId || result.planStatus !== "PENDING") {
        throw new Error("Freigabe wurde vom Server nicht bestätigt.");
      }
      setHeldPlan(null);
      setNotice({
        tone: "success",
        message:
          "Traffic-Canary freigegeben. Meta-Executor legt die Kette PAUSED an und aktiviert nach Read-back. Kill-Switch ist wieder ALLOW.",
      });
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Traffic-Canary konnte nicht freigegeben werden.",
      });
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";
  const buttonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section
      className="border-t border-slate-200 bg-white px-5 py-7 sm:px-7"
      id="traffic-launch"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
          <Rocket className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-700">
            Traffic Canary
          </p>
          <h2 className="mt-1 text-xl font-extrabold text-slate-950">
            Kampagne mit hochgeladenem Creative starten
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Erster Schritt: reine Traffic-Kampagne (Link-Klicks) aus deiner Media
            Library. Domain und Traffic-Blueprint werden automatisch angelegt.
            Pixel-Messung kommt als eigener Folgeschritt.
          </p>
        </div>
      </div>

      <ul className="mt-5 flex flex-wrap gap-2">
        {gates.map((gate) => (
          <li
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${
              gate.ready
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-amber-50 text-amber-900 ring-amber-200"
            }`}
            key={gate.label}
          >
            {gate.ready ? (
              <Check className="size-3.5" />
            ) : (
              <LoaderCircle className="size-3.5" />
            )}
            {gate.label}
          </li>
        ))}
        <li
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${
            killSwitchMode === "FREEZE_WRITES"
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-slate-100 text-slate-700 ring-slate-200"
          }`}
        >
          <ShieldCheck className="size-3.5" />
          Freeze wird bei Bedarf automatisch gesetzt
        </li>
      </ul>

      {!data.brandAssets.length ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Noch kein freigegebenes Creative.{" "}
          <a
            className="font-bold text-blue-700 hover:underline"
            href="/dashboard/creatives"
          >
            Zur Media Library hochladen
          </a>
          .
        </p>
      ) : null}

      <form className="mt-6 grid gap-4 lg:grid-cols-2" onSubmit={prepare}>
        <label className="text-sm font-bold text-slate-800">
          Creative
          <select
            className={inputClass}
            disabled={pending || !data.brandAssets.length}
            onChange={(event) => setAssetId(event.target.value)}
            required
            value={assetId}
          >
            {data.brandAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.originalFilename}
                {asset.width && asset.height
                  ? ` (${asset.width}×${asset.height})`
                  : ""}
              </option>
            ))}
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
          Landingpage (HTTPS)
          <input
            className={inputClass}
            disabled={pending}
            onChange={(event) => setDestinationUrl(event.target.value)}
            placeholder="https://www.example.de/angebot"
            required
            type="url"
            value={destinationUrl}
          />
        </label>
        <label className="text-sm font-bold text-slate-800 lg:col-span-2">
          Anzeigentext (Primary Text)
          <input
            className={inputClass}
            disabled={pending}
            maxLength={200}
            onChange={(event) => setPrimaryText(event.target.value)}
            value={primaryText}
          />
          <span className="mt-1 block text-xs font-medium text-slate-500">
            Wird nur genutzt, wenn noch kein aktiver Traffic-Blueprint existiert.
          </span>
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:col-span-2">
          <button
            className={buttonClass}
            disabled={pending || !gatesReady || Boolean(heldPlan)}
            type="submit"
          >
            {pending && !heldPlan ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            Traffic vorbereiten
          </button>
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50"
            href="/dashboard/creatives"
          >
            <Upload className="size-4" />
            Creative hochladen
          </a>
        </div>
      </form>

      {heldPlan ? (
        <form
          className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5"
          onSubmit={approve}
        >
          <h3 className="font-extrabold text-slate-950">Freigabe prüfen</h3>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="font-bold text-slate-500">Ziel</dt>
              <dd>{heldPlan.objective}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Budget / Tag</dt>
              <dd>{displayMinor(heldPlan.dailyBudgetMinor)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-bold text-slate-500">Landingpage</dt>
              <dd className="break-all">{heldPlan.destinationUrl}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-bold text-slate-500">Kampagne</dt>
              <dd>{heldPlan.campaignName}</dd>
            </div>
          </dl>
          <label className="mt-4 block text-sm font-bold text-slate-800">
            Freigabe-Begründung
            <input
              className={inputClass}
              disabled={pending}
              minLength={12}
              onChange={(event) => setApproveReason(event.target.value)}
              required
              value={approveReason}
            />
          </label>
          <button className={`${buttonClass} mt-4`} disabled={pending} type="submit">
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            Aktiv-Launch freigeben
          </button>
        </form>
      ) : null}

      {notice ? (
        <p
          className={`mt-5 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}
