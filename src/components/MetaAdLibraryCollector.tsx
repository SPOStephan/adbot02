"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { AD_EXAMPLE_OBJECTIVES } from "@/lib/ad-examples/types";
import type {
  MetaAdLibraryAppStatus,
  MetaAdLibraryProbeResult,
} from "@/lib/meta-ad-library/types";

type Props = {
  initialStatus: MetaAdLibraryAppStatus;
  initialNotice: string | null;
};

type ApiResponse = Partial<MetaAdLibraryAppStatus> & {
  ok?: boolean;
  message?: string;
  probe?: MetaAdLibraryProbeResult;
  upserted?: number;
  batchId?: string;
};

const NOTICE_COPY: Record<string, string> = {
  connected: "Library-App verbunden. Als Nächstes Probe-Fetch in DE.",
  login: "Bitte neu anmelden und die Library-App erneut verbinden.",
  forbidden: "Nur Site-Admins dürfen die Library-App verbinden.",
  oauth_denied: "Meta hat den Login abgebrochen.",
  oauth_state: "OAuth-State ungültig. Bitte erneut verbinden.",
  oauth_code: "Kein OAuth-Code von Meta.",
  app_not_configured: "Library-App-ID und Secret fehlen noch in Vercel.",
  shared_product_app: "Library-App ist nicht von der Kunden-App getrennt.",
  token_wrong_app: "Der Token gehört zur Kunden-App. Bitte die Library-App verwenden.",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
      {children}
    </span>
  );
}

function Pill({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
        ok ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"
      }`}
    >
      {label}
    </span>
  );
}

export function MetaAdLibraryCollector({ initialStatus, initialNotice }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    initialNotice ? NOTICE_COPY[initialNotice] ?? initialNotice : null,
  );
  const [probe, setProbe] = useState<MetaAdLibraryProbeResult | null>(
    initialStatus.lastProbe,
  );
  const [accessToken, setAccessToken] = useState("");
  const [searchTerms, setSearchTerms] = useState("Hotel Direktbuchung");
  const [countries, setCountries] = useState("DE, AT, CH");
  const [longRunningDays, setLongRunningDays] = useState(90);
  const [industry, setIndustry] = useState("Hotels & Reisen");
  const [objective, setObjective] = useState("sales");
  const [limit, setLimit] = useState(25);

  const steps = useMemo(
    () => [
      {
        title: "Identität prüfen",
        body: "Unter facebook.com/ID Ausweis und Wohnsitz bestätigen. Ohne das lehnt ads_archive ab.",
        href: "https://www.facebook.com/ID",
      },
      {
        title: "Eigene App anlegen",
        body: "developers.facebook.com → App erstellen. Name z. B. „Adbot Ad Library“. Nicht die Kunden-Adbot-App wiederverwenden.",
        href: "https://developers.facebook.com/apps/",
      },
      {
        title: "Facebook Login (nicht for Business)",
        body: `Gültige OAuth-Redirect-URI: ${status.redirectUri}`,
        href: "https://developers.facebook.com/apps/",
      },
      {
        title: "Library-API freischalten",
        body: "Auf der Ad-Library-API-Seite „Access the API“ mit genau dieser App.",
        href: "https://www.facebook.com/ads/library/api/",
      },
      {
        title: "Secrets nach Vercel",
        body: "META_AD_LIBRARY_APP_ID und META_AD_LIBRARY_APP_SECRET. Getrennt von META_APP_ID / META_APP_SECRET.",
      },
      {
        title: "Verbinden und Probe",
        body: "Hier verbinden, dann Keyword in DE/AT/CH. Nur wenn kommerzielle Ads kommen, lohnt Volumen.",
      },
    ],
    [status.redirectUri],
  );

  async function run(label: string, work: () => Promise<string>) {
    if (pending) return;
    setPending(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  function applyStatus(payload: ApiResponse) {
    setStatus((prev) => ({
      ...prev,
      libraryAppConfigured: payload.libraryAppConfigured ?? prev.libraryAppConfigured,
      libraryAppId: payload.libraryAppId ?? prev.libraryAppId,
      isolatedFromProductApp: payload.isolatedFromProductApp ?? prev.isolatedFromProductApp,
      tokenPresent: payload.tokenPresent ?? prev.tokenPresent,
      tokenSource: payload.tokenSource ?? prev.tokenSource,
      tokenExpiresAt: payload.tokenExpiresAt ?? prev.tokenExpiresAt,
      fetchedToday: payload.fetchedToday ?? prev.fetchedToday,
      lastProbe: payload.lastProbe ?? payload.probe ?? prev.lastProbe,
      lastProbeAt: payload.lastProbeAt ?? prev.lastProbeAt,
      lastProbeOk: payload.lastProbeOk ?? prev.lastProbeOk,
      migrationNeeded: payload.migrationNeeded ?? prev.migrationNeeded,
    }));
    if (payload.probe) setProbe(payload.probe);
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/meta-ad-library", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as ApiResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message ?? "Library-Aktion fehlgeschlagen.");
    }
    applyStatus(payload);
    return payload;
  }

  const searchBody = {
    searchTerms,
    countries,
    longRunningDays,
    industry,
    objective,
    limit,
  };

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">
            Zweite Meta-App
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            Meta Ad Library Collector
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Eigene App, eigener Token, offizielle Graph-API <code>ads_archive</code>.
            Page, Text, CTA, Snapshot, Laufzeit und Länder landen in der Sandbox —
            als Muster, nicht als Erfolg, nicht zum Launch.
          </p>
        </div>
        <ShieldCheck className="size-8 text-sky-700" />
      </div>

      {status.migrationNeeded ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Migration <code>20260917120000_meta_ad_library_connection.sql</code> im
          produktiven Supabase ausführen, danach Token speichern.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Pill
          ok={status.libraryAppConfigured}
          label={status.libraryAppConfigured ? "App-Secrets gesetzt" : "App-Secrets fehlen"}
        />
        <Pill
          ok={status.isolatedFromProductApp}
          label={
            status.isolatedFromProductApp
              ? "Getrennt von Kunden-App"
              : "Noch nicht isoliert"
          }
        />
        <Pill
          ok={status.tokenPresent}
          label={
            status.tokenPresent
              ? `Token (${status.tokenSource ?? "gesetzt"})`
              : "Kein Token"
          }
        />
        <Pill
          ok={status.fetchedToday < status.dailyCap}
          label={`${status.fetchedToday}/${status.dailyCap} heute`}
        />
      </div>
      {status.libraryAppId ? (
        <p className="mt-2 text-xs text-slate-600">
          Library-App-ID: <code>{status.libraryAppId}</code>
          {status.tokenExpiresAt
            ? ` · Token bis ${new Date(status.tokenExpiresAt).toLocaleString("de-DE")}`
            : ""}
        </p>
      ) : null}

      <ol className="mt-5 grid gap-3 md:grid-cols-2">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-xl border border-sky-100 bg-white px-4 py-3"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700">
              Schritt {index + 1}
            </p>
            <p className="mt-1 font-extrabold text-slate-950">{step.title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{step.body}</p>
            {step.href ? (
              <a
                className="mt-2 inline-block text-sm font-semibold text-sky-800 underline"
                href={step.href}
                rel="noreferrer"
                target="_blank"
              >
                Öffnen
              </a>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-sky-100 bg-white p-4">
          <p className="text-sm font-extrabold text-slate-950">App verbinden</p>
          <p className="mt-1 text-sm text-slate-600">
            Facebook Login der Library-App oder einen User-Token aus dem Graph
            Explorer dieser App. Nie den Kunden-Token.
          </p>
          <form action="/api/admin/meta-ad-library/start" method="post">
            <button
              className="mt-3 rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={!status.libraryAppConfigured || Boolean(pending)}
              type="submit"
            >
              Mit Library-App anmelden
            </button>
          </form>
          <label className="mt-4 grid gap-1">
            <FieldLabel>User-Token einfügen</FieldLabel>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="EAAB…"
              type="password"
              value={accessToken}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold"
              disabled={Boolean(pending)}
              onClick={() =>
                run("connect", async () => {
                  await post({ action: "connect_token", accessToken });
                  setAccessToken("");
                  return "Token gespeichert (verschlüsselt).";
                })
              }
              type="button"
            >
              {pending === "connect" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Token speichern
            </button>
            <button
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
              disabled={Boolean(pending)}
              onClick={() =>
                run("disconnect", async () => {
                  await post({ action: "disconnect" });
                  return "Gespeicherter Token gelöscht.";
                })
              }
              type="button"
            >
              Trennen
            </button>
          </div>
        </div>

        <form
          className="grid gap-3 rounded-2xl border border-sky-100 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            run("probe", async () => {
              const payload = await post({ action: "probe", ...searchBody });
              const result = payload.probe;
              if (!result) return "Probe ohne Ergebnis.";
              return result.warning
                ?? `${result.returned} Ads, davon ${result.commercial} kommerziell.`;
            });
          }}
        >
          <p className="text-sm font-extrabold text-slate-950">Probe und Staging</p>
          <label className="grid gap-1">
            <FieldLabel>Suchbegriff</FieldLabel>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              onChange={(event) => setSearchTerms(event.target.value)}
              value={searchTerms}
            />
          </label>
          <label className="grid gap-1">
            <FieldLabel>Länder</FieldLabel>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              onChange={(event) => setCountries(event.target.value)}
              value={countries}
            />
          </label>
          <label className="grid gap-1">
            <FieldLabel>Mindest-Laufzeit (Tage, 0 = alle aktiven)</FieldLabel>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              min={0}
              onChange={(event) => setLongRunningDays(Number(event.target.value))}
              type="number"
              value={longRunningDays}
            />
          </label>
          <label className="grid gap-1">
            <FieldLabel>Branche (von dir, API liefert keine)</FieldLabel>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              onChange={(event) => setIndustry(event.target.value)}
              value={industry}
            />
          </label>
          <label className="grid gap-1">
            <FieldLabel>Ziel (von dir)</FieldLabel>
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              onChange={(event) => setObjective(event.target.value)}
              value={objective}
            >
              {AD_EXAMPLE_OBJECTIVES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <FieldLabel>Max. Ads pro Lauf</FieldLabel>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              max={50}
              min={1}
              onChange={(event) => setLimit(Number(event.target.value))}
              type="number"
              value={limit}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={Boolean(pending) || !status.tokenPresent}
              type="submit"
            >
              {pending === "probe" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Probe-Fetch
            </button>
            <button
              className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-2 text-sm font-bold text-sky-950 disabled:opacity-60"
              disabled={Boolean(pending) || !status.tokenPresent}
              onClick={() =>
                run("fetch", async () => {
                  const payload = await post({ action: "fetch", ...searchBody });
                  return `${payload.upserted ?? 0} Ads in die Sandbox (Batch ${payload.batchId || "—"}) — noch nicht im Vault.`;
                })
              }
              type="button"
            >
              {pending === "fetch" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              In Sandbox holen
            </button>
          </div>
        </form>
      </div>

      {notice ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          {error}
        </p>
      ) : null}

      {probe ? (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-sky-100 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-sky-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Hook</th>
                <th className="px-3 py-2">Tage</th>
                <th className="px-3 py-2">Art</th>
              </tr>
            </thead>
            <tbody>
              {probe.ads.map((ad) => (
                <tr key={ad.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">
                    <a
                      className="text-sky-800 underline"
                      href={ad.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {ad.pageName}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{ad.hookText || "—"}</td>
                  <td className="px-3 py-2">{ad.daysRunning ?? "—"}</td>
                  <td className="px-3 py-2">{ad.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {probe.warning ? (
            <p className="border-t border-amber-100 px-3 py-2 text-sm text-amber-900">
              {probe.warning}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
