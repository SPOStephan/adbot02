"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

export function OpenAIAdsConnectionForm() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);

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
          messageFromPayload(payload, "OpenAI Ads konnte nicht verbunden werden."),
        );
      }
      setMessage("Werbekonto verbunden und erster Datenabruf gestartet.");
      setConfirmed(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "OpenAI Ads konnte nicht verbunden werden.",
      );
    } finally {
      setApiKey("");
      setPending(false);
    }
  }

  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      onSubmit={connect}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            Neue Verbindung
          </p>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            ChatGPT Ads Werbekonto verbinden
          </h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
          Account-spezifischer Key
        </span>
      </div>

      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Erzeuge im OpenAI Ads Manager einen API-Key. Jeder Key gehört genau zu
        einem Werbekonto; weitere Test- oder Kundenkonten kannst du danach separat
        hinzufügen. Der Key wird zuerst bei OpenAI geprüft und anschließend
        ausschließlich verschlüsselt gespeichert.
      </p>

      <label className="mt-5 block text-sm font-bold text-slate-800">
        OpenAI Ads API-Key
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          name="apiKey"
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Ads-API-Key einfügen"
          required
          type="password"
          value={apiKey}
        />
      </label>

      <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-700">
        <input
          checked={confirmed}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>
          Ich bestätige, dass dieser Key für das zu verbindende Werbekonto
          bestimmt ist und von Adbot verschlüsselt für Abrufe und von mir
          freigegebene Änderungen verwendet werden darf.
        </span>
      </label>

      {error ? (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </p>
      ) : null}

      <button
        className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!confirmed || apiKey.trim().length < 20 || pending}
        type="submit"
      >
        {pending ? "Konto wird geprüft …" : "Werbekonto sicher verbinden"}
      </button>
    </form>
  );
}
