"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OpenAIAdsLaunchForm } from "@/components/OpenAIAdsLaunchForm";
import type { OpenAIAdsDashboardAccount } from "@/lib/openai-ads/dashboard";

type Props = {
  accounts: OpenAIAdsDashboardAccount[];
  activeLaunchEnabled: boolean;
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

export function OpenAIAdsWorkspace({ accounts, activeLaunchEnabled }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-600">
        Noch kein ChatGPT-Ads-Werbekonto verbunden. Füge unten den ersten
        accountbezogenen API-Key hinzu.
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

      {accounts.map((account) => {
        const servingReady =
          account.accountStatus === "active" &&
          account.reviewStatus === "approved";
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
                {account.adsManagerUrl ? (
                  <a
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:border-emerald-400"
                    href={account.adsManagerUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Ads Manager
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
                        <th className="px-3 py-3">Tageslimit</th>
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
                          Die Kette ist ACTIVE. Die Auslieferung beginnt nach
                          OpenAIs Anzeigenfreigabe automatisch.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {activeLaunchEnabled ? (
              <OpenAIAdsLaunchForm
                currency={account.currency}
                platformAccountId={account.id}
                servingReady={servingReady}
              />
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
                <p className="font-black">ACTIVE-Launch vorübergehend gesperrt</p>
                <p className="mt-1">
                  OpenAI dokumentiert das Tageslimit derzeit kontoweit statt
                  kampagnenbezogen. Bis diese Kostenwirkung separat bestätigt und
                  mit einem Provider-Read-back abgesichert ist, erstellt Adbot keine
                  kostenwirksamen ChatGPT-Ads-Kampagnen.
                </p>
              </div>
            )}

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
