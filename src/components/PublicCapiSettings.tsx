"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Send, ServerCog, Trash2 } from "lucide-react";

type KeyView = {
  id: string;
  mode: "live" | "test";
  label: string;
  prefix: string;
  allowedHostnames: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

type StatsView = {
  eventName: string;
  last24h: number;
  last7d: number;
  lastReceivedAt: string | null;
  errorRate7d: number;
  lastError: { code: string | null; reason: string | null; at: string } | null;
};

type PixelView = {
  confirmedPixelId: string;
  pixelId: string;
  label: string;
  enabled: boolean;
  keys: KeyView[];
  stats: StatsView[];
};

type Status = {
  endpointEnabled: boolean;
  endpointUrl: string;
  docsUrl: string;
  suggestedHostnames: string[];
  pixels: PixelView[];
};

type Notice = { tone: "success" | "error"; message: string } | null;

async function api(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/meta/automation/pixel/conversions-api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || result.ok !== true) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Die Aktion konnte nicht abgeschlossen werden.",
    );
  }
  return result;
}

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";
const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("de-DE") : "—";
}

function PixelCard({
  pixel,
  suggestedHostnames,
  pending,
  run,
}: {
  pixel: PixelView;
  suggestedHostnames: string[];
  pending: boolean;
  run: (body: Record<string, unknown>, success: string) => Promise<Record<string, unknown> | null>;
}) {
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"live" | "test">("live");
  const [domains, setDomains] = useState(suggestedHostnames.join(", "));
  const [testCode, setTestCode] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  async function createKey() {
    const result = await run(
      {
        action: "create_key",
        confirmedPixelId: pixel.confirmedPixelId,
        mode,
        label,
        allowedHostnames: domains,
      },
      "Schlüssel erzeugt. Bitte jetzt kopieren — er wird nur dieses eine Mal angezeigt.",
    );
    if (result && typeof result.key === "string") {
      setNewKey(result.key);
      setLabel("");
    }
  }

  return (
    <li className="space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-950">
            {pixel.label || "Meta Pixel"} · {pixel.pixelId}
          </p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            {pixel.enabled
              ? "Erweiterte Messung ist zugeschaltet."
              : "Erweiterte Messung ist aus. Der Browser-Pixel misst unverändert weiter."}
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
          <input
            checked={pixel.enabled}
            className="size-4 accent-blue-600"
            disabled={pending}
            onChange={(event) =>
              void run(
                {
                  action: "toggle",
                  confirmedPixelId: pixel.confirmedPixelId,
                  enabled: event.target.checked,
                },
                event.target.checked
                  ? "Conversions API (erweitert) zugeschaltet."
                  : "Conversions API (erweitert) ausgeschaltet. Anfragen werden ab sofort abgelehnt.",
              )
            }
            type="checkbox"
          />
          Conversions API (erweitert)
        </label>
      </div>

      {pixel.enabled ? (
        <>
          {newKey ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <p className="text-xs font-bold">
                Neuer Schlüssel – nur jetzt sichtbar. Sicher speichern (z. B. als Server-Variable), nie im Browser-Code.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 text-xs">{newKey}</code>
                <button
                  className={buttonClass}
                  onClick={() => void navigator.clipboard?.writeText(newKey)}
                  type="button"
                >
                  <Copy className="size-3.5" /> Kopieren
                </button>
                <button className={buttonClass} onClick={() => setNewKey(null)} type="button">
                  Ausblenden
                </button>
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
              Ereignis-Schlüssel
            </p>
            {pixel.keys.length > 0 ? (
              <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {pixel.keys.map((key) => (
                  <li className="flex flex-wrap items-start justify-between gap-2 px-3 py-2" key={key.id}>
                    <div className="min-w-0 text-xs">
                      <p className="font-bold text-slate-900">
                        {key.label || "Ohne Bezeichnung"} · <code>{key.prefix}…</code>{" "}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
                          {key.mode === "test" ? "Test" : "Live"}
                        </span>
                      </p>
                      <p className="mt-0.5 text-slate-500">
                        Domains: {key.allowedHostnames.join(", ") || "—"} · zuletzt genutzt {formatDate(key.lastUsedAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className={buttonClass}
                        disabled={pending}
                        onClick={() => {
                          const next = window.prompt(
                            "Erlaubte Domains (durch Komma getrennt):",
                            key.allowedHostnames.join(", "),
                          );
                          if (next !== null) {
                            void run(
                              { action: "update_domains", keyId: key.id, allowedHostnames: next },
                              "Domains gespeichert.",
                            );
                          }
                        }}
                        type="button"
                      >
                        Domains
                      </button>
                      <button
                        className={buttonClass}
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm("Schlüssel widerrufen? Anfragen mit diesem Schlüssel werden sofort abgelehnt.")) {
                            void run({ action: "revoke_key", keyId: key.id }, "Schlüssel widerrufen.");
                          }
                        }}
                        type="button"
                      >
                        <Trash2 className="size-3.5" /> Widerrufen
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Noch kein Schlüssel.</p>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <label className="text-xs font-semibold text-slate-700">
                Bezeichnung
                <input
                  className={inputClass}
                  disabled={pending}
                  maxLength={120}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="z. B. kiready.co Produktion"
                  value={label}
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Erlaubte Domains
                <input
                  className={inputClass}
                  disabled={pending}
                  onChange={(event) => setDomains(event.target.value)}
                  placeholder="kiready.co"
                  value={domains}
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Art
                <select
                  className={inputClass}
                  disabled={pending}
                  onChange={(event) => setMode(event.target.value === "test" ? "test" : "live")}
                  value={mode}
                >
                  <option value="live">Live</option>
                  <option value="test">Test</option>
                </select>
              </label>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={pending}
                onClick={() => void createKey()}
                type="button"
              >
                <KeyRound className="size-4" /> Schlüssel erzeugen
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Subdomains sind automatisch erlaubt (www.kiready.co bei kiready.co). Test-Schlüssel senden nur mit Meta-Testcode.
            </p>
          </div>

          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">
              Eingegangene Ereignisse (7 Tage)
            </p>
            {pixel.stats.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-3 font-semibold">Ereignis</th>
                      <th className="py-1 pr-3 font-semibold">24 h</th>
                      <th className="py-1 pr-3 font-semibold">7 Tage</th>
                      <th className="py-1 pr-3 font-semibold">Letzter Eingang</th>
                      <th className="py-1 pr-3 font-semibold">Fehlerquote</th>
                      <th className="py-1 font-semibold">Letzter Fehler</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-800">
                    {pixel.stats.map((row) => (
                      <tr className="border-t border-slate-100" key={row.eventName}>
                        <td className="py-1.5 pr-3 font-bold">{row.eventName}</td>
                        <td className="py-1.5 pr-3">{row.last24h}</td>
                        <td className="py-1.5 pr-3">{row.last7d}</td>
                        <td className="py-1.5 pr-3">{formatDate(row.lastReceivedAt)}</td>
                        <td className="py-1.5 pr-3">{Math.round(row.errorRate7d * 100)} %</td>
                        <td className="py-1.5">
                          {row.lastError
                            ? `${row.lastError.reason ?? "Fehler"}${row.lastError.code ? ` (${row.lastError.code})` : ""}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Noch keine Ereignisse über diesen Weg.</p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Meta-Testcode (Events Manager → Testereignisse)
              <input
                className={inputClass}
                disabled={pending}
                onChange={(event) => setTestCode(event.target.value)}
                placeholder="TEST12345"
                value={testCode}
              />
            </label>
            <button
              className={buttonClass}
              disabled={pending || !testCode.trim()}
              onClick={() =>
                void run(
                  { action: "test_event", confirmedPixelId: pixel.confirmedPixelId, testEventCode: testCode },
                  "Testereignis gesendet. Es erscheint im Events Manager unter „Testereignisse“.",
                )
              }
              type="button"
            >
              <Send className="size-3.5" /> Testereignis senden
            </button>
          </div>
        </>
      ) : null}
    </li>
  );
}

export function PublicCapiSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const reload = useCallback(async () => {
    try {
      const result = await api({ action: "status" });
      setStatus(result as unknown as Status);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    let active = true;
    api({ action: "status" })
      .then((result) => {
        if (active) setStatus(result as unknown as Status);
      })
      .catch((error: unknown) => {
        if (active) {
          setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(body: Record<string, unknown>, success: string) {
    setPending(true);
    setNotice(null);
    try {
      const result = await api(body);
      setNotice({ tone: "success", message: success });
      await reload();
      return result;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white px-5 py-7 shadow-sm sm:px-7"
      id="conversions-api-erweitert"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
          <ServerCog className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">
            Optional · für Entwickler und Agenturen
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            Erweiterte Messung (Conversions API)
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Standardmäßig misst der Browser-Pixel auf deiner Website. Zusätzlich kann dein Server
            Ereignisse an Adbot schicken (z. B. Lead, Kauf, Zahlungs-Webhooks, Lead-Qualität).
            Adbot leitet sie über deine Meta-Verbindung weiter, ein eigener Meta-Zugriffsschlüssel ist
            nicht nötig. Gesendet wird nur mit Marketing-Einwilligung, E-Mail und Telefon werden gehasht und nicht gespeichert.
          </p>
          {status ? (
            <p className="mt-2 text-xs text-slate-500">
              Endpunkt: <code className="break-all">{status.endpointUrl}</code> ·{" "}
              <a className="font-semibold underline underline-offset-2" href={status.docsUrl} rel="noreferrer" target="_blank">
                API-Doku (OpenAPI)
              </a>
            </p>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
            notice.tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
          }`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}

      {status && !status.endpointEnabled ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Der Endpunkt ist in dieser Umgebung noch nicht freigeschaltet. Du kannst schon alles
          vorbereiten, Ereignisse werden aber erst nach der Freischaltung angenommen.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 inline-flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="size-4 animate-spin" /> Lädt …
        </p>
      ) : status && status.pixels.length > 0 ? (
        <ul className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {status.pixels.map((pixel) => (
            <PixelCard
              key={pixel.confirmedPixelId}
              pending={pending}
              pixel={pixel}
              run={run}
              suggestedHostnames={status.suggestedHostnames}
            />
          ))}
        </ul>
      ) : status ? (
        <p className="mt-6 text-sm text-slate-500">
          Zuerst oben ein Pixel bestätigen, danach lässt sich die erweiterte Messung zuschalten.
        </p>
      ) : null}
    </section>
  );
}
