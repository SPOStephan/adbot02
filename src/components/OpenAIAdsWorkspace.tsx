"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OpenAIAdsLaunchForm } from "@/components/OpenAIAdsLaunchForm";
import type { OpenAIAdsDashboardAccount } from "@/lib/openai-ads/dashboard";

type Props = {
  accounts: OpenAIAdsDashboardAccount[];
};

type ActivationPreview = {
  launchId: string;
  remoteAccountId: string;
  accountName: string;
  campaignId: string;
  adGroupId: string;
  adId: string;
  currency: string;
  dailyBudgetMicros: number;
  previewToken: string;
  providerPreviewBodies: string[];
  accountTimezone: string;
  campaignName: string;
  campaignDescription: string | null;
  adGroupName: string;
  contextHints: string[];
  adName: string;
  biddingType: "impressions" | "clicks";
  billingEventType: "impression" | "click";
  maxBidMicros: number;
  startTime: number | null;
  endTime: number | null;
  locationIds: string[];
  title: string;
  body: string;
  targetUrl: string;
  imageUrl: string;
};

function dateTime(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "–";
}

function number(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
    value,
  );
}

function currency(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${number(value)} ${currencyCode}`;
  }
}

function exactMicrosCurrency(micros: number, currencyCode: string): string {
  let amount: string;
  try {
    amount = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(micros / 1_000_000);
  } catch {
    amount = `${new Intl.NumberFormat("de-DE", {
      maximumFractionDigits: 6,
    }).format(micros / 1_000_000)} ${currencyCode}`;
  }
  return `${amount} (${new Intl.NumberFormat("de-DE").format(micros)} Micros)`;
}

function providerDate(value: number | null, timeZone: string): string {
  if (value === null) return "kein Datum gesetzt";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "long",
      timeZone,
    }).format(new Date(value * 1000));
  } catch {
    return "nicht darstellbar";
  }
}

function statusLabel(status: string | null) {
  const labels: Record<string, string> = {
    active: "Aktiv",
    paused: "Pausiert",
    in_review: "In Prüfung",
    approved: "Genehmigt",
    rejected: "Abgelehnt",
    ready_to_activate: "Bereit zur Aktivierung",
    activating: "Aktivierung läuft",
    blocked: "Blockiert",
    failed: "Fehlgeschlagen",
    activation_uncertain: "Sofort manuell prüfen",
    success: "Aktuell",
    syncing: "Abruf läuft",
    error: "Abruffehler",
    idle: "Noch nicht abgerufen",
  };
  return status ? labels[status] ?? status : "Unbekannt";
}

function statusTone(status: string | null) {
  if (["active", "approved", "success", "ready_to_activate"].includes(status ?? "")) {
    return "bg-emerald-100 text-emerald-900";
  }
  if (["rejected", "failed", "error", "activation_uncertain"].includes(status ?? "")) {
    return "bg-rose-100 text-rose-900";
  }
  return "bg-amber-100 text-amber-900";
}

function payloadMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }
  return fallback;
}

function activationPreview(payload: unknown): ActivationPreview | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.launchId !== "string" ||
    typeof value.remoteAccountId !== "string" ||
    typeof value.accountName !== "string" ||
    typeof value.campaignId !== "string" ||
    typeof value.adGroupId !== "string" ||
    typeof value.adId !== "string" ||
    typeof value.previewToken !== "string" ||
    value.previewToken.length < 32 ||
    typeof value.accountTimezone !== "string" ||
    typeof value.campaignName !== "string" ||
    (value.campaignDescription !== null &&
      typeof value.campaignDescription !== "string") ||
    typeof value.adGroupName !== "string" ||
    !Array.isArray(value.contextHints) ||
    value.contextHints.some((item) => typeof item !== "string") ||
    typeof value.adName !== "string" ||
    (value.biddingType !== "impressions" && value.biddingType !== "clicks") ||
    (value.billingEventType !== "impression" &&
      value.billingEventType !== "click") ||
    typeof value.maxBidMicros !== "number" ||
    !Number.isSafeInteger(value.maxBidMicros) ||
    (value.startTime !== null &&
      (typeof value.startTime !== "number" ||
        !Number.isSafeInteger(value.startTime))) ||
    (value.endTime !== null &&
      (typeof value.endTime !== "number" || !Number.isSafeInteger(value.endTime))) ||
    !Array.isArray(value.locationIds) ||
    value.locationIds.some((item) => typeof item !== "string") ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.targetUrl !== "string" ||
    typeof value.imageUrl !== "string" ||
    !Array.isArray(value.providerPreviewBodies) ||
    value.providerPreviewBodies.length === 0 ||
    value.providerPreviewBodies.length > 10 ||
    value.providerPreviewBodies.some(
      (item) =>
        typeof item !== "string" ||
        !item.trim() ||
        item.length > 1_000_000,
    ) ||
    typeof value.currency !== "string" ||
    typeof value.dailyBudgetMicros !== "number" ||
    !Number.isSafeInteger(value.dailyBudgetMicros)
  ) {
    return null;
  }
  return value as ActivationPreview;
}

export function OpenAIAdsWorkspace({ accounts }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationToConfirm, setActivationToConfirm] =
    useState<ActivationPreview | null>(null);

  async function post(
    key: string,
    url: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    if (pending) return;
    setPending(key);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, "Aktion fehlgeschlagen."));
      }
      setMessage(successMessage);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  async function disconnect(account: OpenAIAdsDashboardAccount) {
    if (
      !window.confirm(
        `${account.name} aus Adbot trennen? Der verschlüsselte Key wird gelöscht; historische Reportingdaten bleiben erhalten. Laufende Kampagnen werden dadurch NICHT pausiert. Pausiere sie bei Bedarf zuerst im OpenAI Ads Manager und widerrufe dort anschließend den Key.`,
      )
    ) {
      return;
    }
    await post(
      `disconnect:${account.id}`,
      "/api/connectors/openai-ads/disconnect",
      {
        platformAccountId: account.id,
        confirmation: "disconnect_openai_ads",
      },
      `${account.name} wurde aus Adbot getrennt.`,
    );
  }

  async function activate(launchId: string) {
    if (pending) return;
    setPending(`preview:${launchId}`);
    setMessage(null);
    setError(null);
    setActivationToConfirm(null);
    try {
      const previewResponse = await fetch("/api/openai-ads/launch/preview", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launchId }),
      });
      const previewPayload: unknown = await previewResponse.json().catch(() => null);
      if (!previewResponse.ok) {
        throw new Error(
          payloadMessage(
            previewPayload,
            "Konto, Budget und Pausenstatus konnten nicht bestätigt werden.",
          ),
        );
      }
      const preview = activationPreview(previewPayload);
      if (!preview) {
        throw new Error("OpenAI Ads hat keine gültige Aktivierungsvorschau geliefert.");
      }
      setActivationToConfirm(preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aktivierung fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  async function confirmActivation(preview: ActivationPreview) {
    if (pending) return;
    setPending(`activate:${preview.launchId}`);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/openai-ads/launch/activate", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          launchId: preview.launchId,
          previewToken: preview.previewToken,
          confirmation: "activate_openai_ads_campaign",
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, "Aktivierung fehlgeschlagen."));
      }
      setMessage(
        "OpenAI hat Konto, Kampagnen-Tagesbudget und die vollständige ACTIVE-Kette bestätigt.",
      );
      setActivationToConfirm(null);
      router.refresh();
    } catch (caught) {
      setActivationToConfirm(null);
      setError(caught instanceof Error ? caught.message : "Aktivierung fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-600">
        Noch kein ChatGPT-Ads-Werbekonto verbunden. Starte den geführten
        Zwei-Schritt-Ablauf, um das erste Konto sicher hinzuzufügen.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </p>
      ) : null}

      {activationToConfirm ? (
        <section
          aria-labelledby="openai-activation-preview-title"
          className="space-y-6 rounded-3xl border-2 border-blue-300 bg-blue-50 p-5 shadow-lg sm:p-7"
        >
          <header>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
              OpenAI-Provider-Vorschau · noch pausiert
            </p>
            <h2
              className="mt-2 text-2xl font-black text-slate-950"
              id="openai-activation-preview-title"
            >
              Kostenwirksame Aktivierung ausdrücklich bestätigen
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Adbot hat die vollständige PAUSED-Kette bei OpenAI frisch gelesen.
              Prüfe die von OpenAI gerenderte Anzeige und alle Werte. Der blaue
              Bestätigungsbutton startet erst danach den erneuten Pre-ACTIVE-Check.
            </p>
          </header>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className="space-y-4">
              <h3 className="font-black text-slate-950">
                Von OpenAI gerenderte Anzeigenvorschau
              </h3>
              {activationToConfirm.providerPreviewBodies.map((body, index) => (
                <iframe
                  className="h-[520px] w-full rounded-2xl border border-slate-300 bg-white"
                  key={`${activationToConfirm.launchId}:${index}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  sandbox=""
                  srcDoc={body}
                  title={`OpenAI-Anzeigenvorschau ${index + 1}`}
                />
              ))}
              <p className="text-xs leading-5 text-slate-600">
                Die temporäre Provider-Vorschau wird ohne Same-Origin-Rechte und
                ohne Script-Berechtigung in einer Browser-Sandbox dargestellt. Sie
                ersetzt nicht die Status-, Review-, Serving-, Budget- und
                Targeting-Prüfungen.
              </p>
            </div>

            <dl className="grid content-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              {[
                [
                  "Werbekonto",
                  `${activationToConfirm.accountName} (${activationToConfirm.remoteAccountId})`,
                ],
                [
                  "Kampagne",
                  `${activationToConfirm.campaignName} (${activationToConfirm.campaignId})`,
                ],
                [
                  "Kampagnenbeschreibung",
                  activationToConfirm.campaignDescription ?? "keine Beschreibung",
                ],
                [
                  "Anzeigengruppe",
                  `${activationToConfirm.adGroupName} (${activationToConfirm.adGroupId})`,
                ],
                ["Context Hints", activationToConfirm.contextHints.join(", ")],
                [
                  "Anzeige",
                  `${activationToConfirm.adName} (${activationToConfirm.adId})`,
                ],
                [
                  "Kampagnenspezifisches tägliches Ausgabenlimit",
                  exactMicrosCurrency(
                    activationToConfirm.dailyBudgetMicros,
                    activationToConfirm.currency,
                  ),
                ],
                [
                  "Gebotsziel / Abrechnung",
                  `${activationToConfirm.biddingType} / ${activationToConfirm.billingEventType}`,
                ],
                [
                  "Maximalgebot",
                  exactMicrosCurrency(
                    activationToConfirm.maxBidMicros,
                    activationToConfirm.currency,
                  ),
                ],
                [
                  `Zeitraum (${activationToConfirm.accountTimezone})`,
                  `${providerDate(activationToConfirm.startTime, activationToConfirm.accountTimezone)} bis ${providerDate(activationToConfirm.endTime, activationToConfirm.accountTimezone)}`,
                ],
                ["Standorte", activationToConfirm.locationIds.join(", ")],
                ["Creative-Titel", activationToConfirm.title],
                ["Creative-Text", activationToConfirm.body],
                ["Bildquelle", activationToConfirm.imageUrl],
                ["Ziel-URL", activationToConfirm.targetUrl],
              ].map(([label, value]) => (
                <div className="border-b border-slate-100 pb-3 last:border-0" key={label}>
                  <dt className="font-bold text-slate-500">{label}</dt>
                  <dd className="mt-1 break-words font-semibold text-slate-950">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <strong>Wichtig:</strong> Mit der Bestätigung darf OpenAI Campaign,
            Ad Group und Ad auf ACTIVE setzen und bis zum oben genannten
            kampagnenspezifischen täglichen Ausgabenlimit ausliefern. Adbot ändert
            kein kontoweites Spend-Limit und prüft die komplette Kette unmittelbar
            vor und nach ACTIVE erneut.
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <button
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 disabled:opacity-50"
              disabled={Boolean(pending)}
              onClick={() => setActivationToConfirm(null)}
              type="button"
            >
              Abbrechen · pausiert lassen
            </button>
            <button
              className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
              disabled={Boolean(pending)}
              onClick={() => void confirmActivation(activationToConfirm)}
              type="button"
            >
              {pending === `activate:${activationToConfirm.launchId}`
                ? "ACTIVE wird geprüft …"
                : "Kostenwirksam ACTIVE schalten"}
            </button>
          </div>
        </section>
      ) : null}

      {accounts.map((account) => {
        const servingReady =
          account.accountStatus === "active" &&
          account.reviewStatus === "approved" &&
          (!account.accountIntegrityReviewObserved ||
            account.accountIntegrityReviewStatus === "approved");
        return (
          <article
            className="space-y-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-6"
            key={account.id}
          >
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                  ChatGPT Ads · {account.remoteAccountId}
                </p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">
                  {account.name}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(account.accountStatus)}`}
                  >
                    Konto: {statusLabel(account.accountStatus)}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(account.reviewStatus)}`}
                  >
                    Brand Review: {statusLabel(account.reviewStatus)}
                  </span>
                  {account.accountIntegrityReviewObserved ? (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(account.accountIntegrityReviewStatus)}`}
                    >
                      Kontoprüfung:{" "}
                      {statusLabel(account.accountIntegrityReviewStatus)}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(account.syncStatus)}`}
                  >
                    Daten: {statusLabel(account.syncStatus)}
                  </span>
                </div>
                {account.reviewReason ? (
                  <p className="mt-2 text-sm font-semibold text-rose-700">
                    Reviewhinweis: {account.reviewReason}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:border-emerald-400"
                  href="https://ads.openai.com"
                  rel="noreferrer"
                  target="_blank"
                >
                  Ads Manager
                </a>
                {account.advertiserUrl ? (
                  <a
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:border-emerald-400"
                    href={account.advertiserUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Website
                  </a>
                ) : null}
                <button
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  disabled={Boolean(pending)}
                  onClick={() =>
                    void post(
                      `sync:${account.id}`,
                      "/api/connectors/openai-ads/sync",
                      { platformAccountId: account.id },
                      "OpenAI-Ads-Daten wurden aktualisiert.",
                    )
                  }
                  type="button"
                >
                  {pending === `sync:${account.id}` ? "Abruf läuft …" : "Jetzt abrufen"}
                </button>
                <button
                  className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50"
                  disabled={Boolean(pending)}
                  onClick={() => void disconnect(account)}
                  type="button"
                >
                  Trennen
                </button>
              </div>
            </header>

            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ["Spend (gespeichert)", currency(account.totals.spend, account.currency)],
                ["Impressionen", number(account.totals.impressions)],
                ["Klicks", number(account.totals.clicks)],
                [
                  "Conversions",
                  account.totals.conversions === null
                    ? "Noch nicht gemessen"
                    : number(account.totals.conversions),
                ],
                ["Letzter Erfolg", dateTime(account.lastSuccessAt)],
              ].map(([label, value]) => (
                <div className="rounded-2xl border border-slate-200 bg-white p-4" key={label}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-2 text-lg font-black text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                    30-Tage-Vergleichsbasis
                  </p>
                  <h3 className="mt-1 text-lg font-black text-slate-950">
                    Kampagnen und Effizienz
                  </h3>
                </div>
                <p className="text-xs font-semibold text-slate-500">
                  {account.counts.campaigns} Kampagnen · {account.counts.adGroups} Gruppen · {account.counts.ads} Anzeigen
                </p>
              </div>

              {account.campaigns.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Kampagne</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3">Laufzeitbudget</th>
                        <th className="px-3 py-3">Tägliches Ausgabenlimit</th>
                        <th className="px-3 py-3">Spend</th>
                        <th className="px-3 py-3">Impr.</th>
                        <th className="px-3 py-3">Klicks</th>
                        <th className="px-3 py-3">CTR</th>
                        <th className="px-3 py-3">CPC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {account.campaigns.map((campaign) => (
                        <tr key={campaign.id}>
                          <td className="px-3 py-3">
                            <span className="block font-bold text-slate-900">
                              {campaign.name}
                            </span>
                            <span className="block font-mono text-[11px] text-slate-400">
                              {campaign.remoteId}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-semibold">
                            {statusLabel(campaign.status)}
                          </td>
                          <td className="px-3 py-3">
                            {campaign.budgetMicros === null
                              ? "–"
                              : currency(
                                  campaign.budgetMicros / 1_000_000,
                                  account.currency,
                                )}
                          </td>
                          <td className="px-3 py-3">
                            {campaign.dailyBudgetMicros === null
                              ? "–"
                              : currency(
                                  campaign.dailyBudgetMicros / 1_000_000,
                                  account.currency,
                                )}
                          </td>
                          <td className="px-3 py-3">
                            {currency(campaign.spend, account.currency)}
                          </td>
                          <td className="px-3 py-3">{number(campaign.impressions)}</td>
                          <td className="px-3 py-3">{number(campaign.clicks)}</td>
                          <td className="px-3 py-3">
                            {campaign.ctr === null ? "–" : `${number(campaign.ctr)} %`}
                          </td>
                          <td className="px-3 py-3">
                            {campaign.cpc === null
                              ? "–"
                              : currency(campaign.cpc, account.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600">
                  Noch keine Kampagnen im vollständigen OpenAI-Ads-Snapshot.
                </p>
              )}
            </div>

            {account.launches.length > 0 ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-lg font-black text-slate-950">
                  Von Adbot angelegte Launches
                </h3>
                <div className="mt-4 space-y-3">
                  {account.launches.map((launch) => (
                    <div
                      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                        launch.status === "activation_uncertain"
                          ? "border-rose-400 bg-rose-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                      key={launch.id}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-black ${statusTone(launch.status)}`}
                          >
                            {statusLabel(launch.status)}
                          </span>
                          {launch.reviewStatus ? (
                            <span className="text-xs font-bold text-slate-500">
                              Anzeigenprüfung: {statusLabel(launch.reviewStatus)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          Angelegt {dateTime(launch.createdAt)}
                          {launch.errorCode ? ` · ${launch.errorCode}` : ""}
                        </p>
                        {launch.status === "activation_uncertain" ? (
                          <p className="mt-2 text-sm font-black text-rose-900">
                            Unverzüglich im OpenAI Ads Manager prüfen und bei Bedarf pausieren.
                          </p>
                        ) : null}
                      </div>
                      {launch.status === "in_review" ? (
                        <p className="max-w-sm text-sm font-semibold text-amber-900">
                          Die vollständige Kette bleibt pausiert. Nach OpenAIs
                          Anzeigenfreigabe kann sie separat geprüft und aktiviert
                          werden.
                        </p>
                      ) : null}
                      {["ready_to_activate", "in_review", "blocked"].includes(
                        launch.status,
                      ) ? (
                        <button
                          className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                          disabled={Boolean(pending) || Boolean(activationToConfirm)}
                          onClick={() => void activate(launch.id)}
                          type="button"
                        >
                          {pending === `preview:${launch.id}`
                            ? "Providerdaten werden geprüft …"
                            : pending === `activate:${launch.id}`
                              ? "Aktivierung läuft …"
                              : "Prüfen & aktivieren"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <OpenAIAdsLaunchForm
              currency={account.currency}
              platformAccountId={account.id}
              servingReady={servingReady}
            />

            <footer className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>Zeitzone: {account.timezone ?? "–"}</span>
              <span>
                Conversion-Attribution: {account.conversionInsightsAvailable ? "verfügbar" : "nicht verfügbar"}
              </span>
              <span>Letzter Start: {dateTime(account.lastSyncStartedAt)}</span>
              <span>Nächster Abruf: {dateTime(account.nextSyncAt)}</span>
              {account.syncErrorCode ? (
                <span className="font-bold text-rose-700">
                  Fehlercode: {account.syncErrorCode}
                </span>
              ) : null}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
