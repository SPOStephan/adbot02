"use client";

import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const OPENAI_ADS_MANAGER_URL = "https://ads.openai.com";

type ConnectedAccount = {
  platformAccountId: string;
  remoteAccountId: string;
  accountName: string;
  currencyCode: string;
  timezone: string;
  reviewStatus: string;
};

type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "success"; summary: string }
  | { status: "warning"; message: string };

function messageFromPayload(payload: unknown, fallback: string): string {
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

function accountFromPayload(payload: unknown): ConnectedAccount | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("connection" in payload) ||
    typeof payload.connection !== "object" ||
    payload.connection === null
  ) {
    return null;
  }

  const connection = payload.connection as Record<string, unknown>;
  const required = [
    "platformAccountId",
    "remoteAccountId",
    "accountName",
    "currencyCode",
    "timezone",
    "reviewStatus",
  ] as const;

  if (required.some((key) => typeof connection[key] !== "string")) {
    return null;
  }

  return {
    platformAccountId: connection.platformAccountId as string,
    remoteAccountId: connection.remoteAccountId as string,
    accountName: connection.accountName as string,
    currencyCode: connection.currencyCode as string,
    timezone: connection.timezone as string,
    reviewStatus: connection.reviewStatus as string,
  };
}

function syncSummary(payload: unknown): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("counts" in payload) ||
    typeof payload.counts !== "object" ||
    payload.counts === null
  ) {
    return "Die ersten Werbedaten wurden importiert.";
  }

  const counts = payload.counts as Record<string, unknown>;
  const campaigns = Number(counts.campaigns ?? 0);
  const ads = Number(counts.ads ?? 0);
  return `${Number.isFinite(campaigns) ? campaigns : 0} Kampagnen und ${
    Number.isFinite(ads) ? ads : 0
  } Anzeigen wurden importiert.`;
}

export function OpenAIAdsConnectionForm() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [connectedAccount, setConnectedAccount] =
    useState<ConnectedAccount | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  async function startInitialSync(account: ConnectedAccount) {
    setSyncState({ status: "syncing" });
    try {
      const response = await fetch("/api/connectors/openai-ads/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformAccountId: account.platformAccountId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setSyncState({
          status: "warning",
          message:
            "Das Konto ist verbunden. Der erste Datenimport wird automatisch erneut versucht.",
        });
        return;
      }
      setSyncState({ status: "success", summary: syncSummary(payload) });
    } catch {
      setSyncState({
        status: "warning",
        message:
          "Das Konto ist verbunden. Der erste Datenimport wird automatisch erneut versucht.",
      });
    }
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/connectors/openai-ads/connect", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          messageFromPayload(payload, "ChatGPT Ads konnte nicht verbunden werden."),
        );
      }

      const account = accountFromPayload(payload);
      if (!account) {
        throw new Error(
          "Das Werbekonto wurde geprüft, aber die Bestätigung war unvollständig.",
        );
      }

      setApiKey("");
      setConnectedAccount(account);
      setPending(false);
      void startInitialSync(account);
    } catch (caught) {
      setApiKey("");
      setError(
        caught instanceof Error
          ? caught.message
          : "ChatGPT Ads konnte nicht verbunden werden.",
      );
      setPending(false);
    }
  }

  if (connectedAccount) {
    return (
      <section
        aria-live="polite"
        className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm"
      >
        <div className="bg-emerald-600 px-6 py-7 text-white sm:px-8">
          <CheckCircle2 className="size-11" />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-emerald-100">
            Verbindung erfolgreich
          </p>
          <h2 className="mt-1 text-2xl font-black">
            {connectedAccount.accountName} ist jetzt mit Adbot verbunden
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50">
            OpenAI hat den accountgebundenen Schlüssel bestätigt. Adbot hat ihn
            verschlüsselt gespeichert und kann ihn nicht im Browser anzeigen.
          </p>
        </div>

        <div className="space-y-5 p-6 sm:p-8">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Werbekonto", connectedAccount.remoteAccountId],
              ["Währung", connectedAccount.currencyCode],
              ["Zeitzone", connectedAccount.timezone],
              [
                "Freigabe",
                connectedAccount.reviewStatus === "approved"
                  ? "Genehmigt"
                  : connectedAccount.reviewStatus,
              ],
            ].map(([label, value]) => (
              <div className="rounded-2xl bg-slate-50 p-4" key={label}>
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {label}
                </dt>
                <dd className="mt-2 break-words text-sm font-black text-slate-950">
                  {value || "–"}
                </dd>
              </div>
            ))}
          </dl>

          <div
            className={`flex items-start gap-3 rounded-2xl px-4 py-4 text-sm leading-6 ${
              syncState.status === "warning"
                ? "bg-amber-50 text-amber-950"
                : "bg-emerald-50 text-emerald-950"
            }`}
          >
            {syncState.status === "syncing" ? (
              <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            )}
            <div>
              <p className="font-black">
                {syncState.status === "syncing"
                  ? "Verbindung steht – Werbedaten werden importiert"
                  : syncState.status === "success"
                    ? "Erster Datenimport abgeschlossen"
                    : syncState.status === "warning"
                      ? "Verbindung steht – Import folgt automatisch"
                      : "Verbindung steht"}
              </p>
              {syncState.status === "success" ? (
                <p>{syncState.summary}</p>
              ) : syncState.status === "warning" ? (
                <p>{syncState.message}</p>
              ) : syncState.status === "syncing" ? (
                <p>Du kannst diese Seite geöffnet lassen; die Verbindung ist bereits sicher.</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
              onClick={() => router.refresh()}
              type="button"
            >
              Kontoübersicht anzeigen
            </button>
            <a
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 hover:border-emerald-400"
              href={OPENAI_ADS_MANAGER_URL}
              rel="noreferrer"
              target="_blank"
            >
              Ads Manager öffnen
              <ExternalLink className="size-4" />
            </a>
            <button
              className="rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100"
              onClick={() => {
                setConnectedAccount(null);
                setSyncState({ status: "idle" });
              }}
              type="button"
            >
              Weiteres Konto verbinden
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
        <div className="bg-slate-950 p-6 text-white sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
            ChatGPT Ads verbinden
          </p>
          <h2 className="mt-2 text-2xl font-black">
            In zwei kurzen Schritten zum verbundenen Werbekonto
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            OpenAI bietet für Ads derzeit noch keinen automatischen OAuth-Dialog
            wie Meta. Deshalb erzeugst du einmal einen accountgebundenen Schlüssel;
            Adbot übernimmt Prüfung, Verschlüsselung und Datenimport.
          </p>

          <ol className="mt-7 space-y-5">
            <li className="flex gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500 font-black text-slate-950">
                1
              </span>
              <div>
                <p className="font-black">Ads Manager öffnen</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Wähle das gewünschte Werbekonto und öffne
                  <strong className="text-white"> Einstellungen → API Keys</strong>.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500 font-black text-slate-950">
                2
              </span>
              <div>
                <p className="font-black">Key einfügen und verbinden</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Adbot erkennt das zugehörige Konto automatisch und bestätigt die
                  Verbindung direkt.
                </p>
              </div>
            </li>
          </ol>

          <a
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400"
            href={OPENAI_ADS_MANAGER_URL}
            rel="noreferrer"
            target="_blank"
          >
            OpenAI Ads Manager öffnen
            <ExternalLink className="size-4" />
          </a>
        </div>

        <form className="p-6 sm:p-8" onSubmit={connect}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <KeyRound className="size-5" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                Schritt 2
              </p>
              <h3 className="mt-1 text-xl font-black text-slate-950">
                API-Key sicher verbinden
              </h3>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-600">
            Füge den neu erstellten Ads-API-Key hier ein. OpenAI ordnet ihn
            automatisch genau einem Werbekonto zu – du musst keine Konto-ID eingeben.
          </p>

          <label className="mt-5 block text-sm font-bold text-slate-800">
            OpenAI Ads API-Key
            <input
              aria-describedby="openai-ads-key-security"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              name="apiKey"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Ads-API-Key hier einfügen"
              required
              spellCheck={false}
              type="password"
              value={apiKey}
            />
          </label>

          <div
            className="mt-4 flex gap-3 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600"
            id="openai-ads-key-security"
          >
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />
            <p>
              Der Key wird serverseitig bei OpenAI geprüft, anschließend
              AES-256-GCM-verschlüsselt gespeichert und nach dem Absenden aus diesem
              Formular entfernt. Er erscheint nie in einer URL oder im Browser-Speicher.
            </p>
          </div>

          {error ? (
            <div
              aria-live="assertive"
              className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"
            >
              <p>{error}</p>
              <p className="mt-1 font-normal">
                Prüfe im Ads Manager, ob du das richtige Werbekonto ausgewählt und
                den vollständigen Ads-API-Key kopiert hast.
              </p>
            </div>
          ) : null}

          <button
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={apiKey.trim().length < 20 || pending}
            type="submit"
          >
            {pending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Konto wird sicher geprüft …
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" />
                ChatGPT Ads jetzt verbinden
              </>
            )}
          </button>

          <p className="mt-3 text-center text-xs leading-5 text-slate-500">
            Mit dem Verbinden erlaubst du Adbot, Werbedaten dieses Kontos zu lesen.
            Kostenwirksame ChatGPT-Ads-Aktionen bleiben bis zu ihrer technischen
            Freigabe gesperrt. Du kannst die Verbindung jederzeit wieder trennen.
          </p>
        </form>
      </div>
    </section>
  );
}
