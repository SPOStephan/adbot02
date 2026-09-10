"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type GeoLocation = {
  id: string;
  type: string;
  canonical_name: string;
  country_code: string;
  name: string;
  region_code: string | null;
};

type Props = {
  platformAccountId: string;
  currency: string;
  servingReady: boolean;
};

function responseMessage(payload: unknown, fallback: string) {
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

export function OpenAIAdsLaunchForm({
  platformAccountId,
  currency,
  servingReady,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [geoQuery, setGeoQuery] = useState("");
  const [geoResults, setGeoResults] = useState<GeoLocation[]>([]);
  const [locations, setLocations] = useState<GeoLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function searchLocations() {
    if (geoQuery.trim().length < 2 || searching) return;
    setSearching(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        platformAccountId,
        q: geoQuery.trim(),
      });
      const response = await fetch(
        `/api/connectors/openai-ads/geo-search?${query.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(payload, "Standorte konnten nicht geladen werden."),
        );
      }
      const results =
        typeof payload === "object" &&
        payload !== null &&
        "locations" in payload &&
        Array.isArray(payload.locations)
          ? (payload.locations as GeoLocation[])
          : [];
      setGeoResults(results);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Standorte konnten nicht geladen werden.",
      );
    } finally {
      setSearching(false);
    }
  }

  function addLocation(location: GeoLocation) {
    setLocations((current) =>
      current.some((item) => item.id === location.id)
        ? current
        : [...current, location],
    );
  }

  async function createLaunch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || locations.length === 0 || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/openai-ads/launch", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformAccountId,
          campaignName: form.get("campaignName"),
          campaignDescription: form.get("campaignDescription"),
          biddingType: form.get("biddingType"),
          lifetimeBudget: form.get("lifetimeBudget"),
          maxBid: form.get("maxBid"),
          startDate: form.get("startDate"),
          endDate: form.get("endDate"),
          locationIds: locations.map((location) => location.id),
          adGroupName: form.get("adGroupName"),
          contextHints: String(form.get("contextHints") ?? "")
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          adName: form.get("adName"),
          title: form.get("title"),
          body: form.get("body"),
          targetUrl: form.get("targetUrl"),
          imageUrl: form.get("imageUrl"),
          confirmation: "create_paused_openai_ads_campaign",
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(
            payload,
            "Der pausierte Kampagnenentwurf konnte nicht erstellt werden.",
          ),
        );
      }
      setMessage(
        "Kampagne, Anzeigengruppe und Anzeige wurden bei OpenAI pausiert angelegt. Es entstehen noch keine Ausgaben.",
      );
      setConfirmed(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Der pausierte Kampagnenentwurf konnte nicht erstellt werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <button
        className="flex w-full items-center justify-between gap-4 text-left"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span>
          <span className="block text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
            Sicherer Launch
          </span>
          <span className="mt-1 block text-lg font-black text-slate-950">
            Neue ChatGPT-Ad-Kampagne
          </span>
        </span>
        <span className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-bold text-slate-700">
          {expanded ? "Schließen" : "PAUSED anlegen"}
        </span>
      </button>

      {!servingReady ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Der Launch ist gesperrt, bis Werbekonto und Brand Review bei OpenAI
          aktiv beziehungsweise genehmigt sind.
        </p>
      ) : null}

      {expanded ? (
        <form className="mt-6 space-y-5" onSubmit={createLaunch}>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="text-sm font-bold text-slate-800">
              Kampagnenname
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="campaignName"
                required
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Gebotsziel
              <select
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                defaultValue="clicks"
                name="biddingType"
              >
                <option value="clicks">Klicks</option>
                <option value="impressions">Impressionen</option>
              </select>
            </label>
            <label className="text-sm font-bold text-slate-800 lg:col-span-2">
              Beschreibung (optional)
              <textarea
                className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="campaignDescription"
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Laufzeitbudget ({currency})
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                inputMode="decimal"
                min="1"
                name="lifetimeBudget"
                placeholder="100.00"
                required
                step="0.01"
                type="number"
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Maximalgebot ({currency})
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                inputMode="decimal"
                min="0.01"
                name="maxBid"
                placeholder="2.00"
                required
                step="0.01"
                type="number"
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Startdatum (optional)
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="startDate"
                type="date"
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Enddatum (optional)
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="endDate"
                type="date"
              />
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="text-sm font-bold text-slate-800">
              Standorttargeting
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5"
                  onChange={(event) => setGeoQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void searchLocations();
                    }
                  }}
                  placeholder="z. B. Germany oder Berlin"
                  value={geoQuery}
                />
                <button
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  disabled={geoQuery.trim().length < 2 || searching}
                  onClick={() => void searchLocations()}
                  type="button"
                >
                  {searching ? "Suche …" : "Suchen"}
                </button>
              </div>
            </label>
            {geoResults.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {geoResults.map((location) => (
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-400"
                    key={location.id}
                    onClick={() => addLocation(location)}
                    type="button"
                  >
                    <span className="block font-bold text-slate-900">
                      {location.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {location.canonical_name} · {location.type}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {locations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {locations.map((location) => (
                  <button
                    className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900"
                    key={location.id}
                    onClick={() =>
                      setLocations((current) =>
                        current.filter((item) => item.id !== location.id),
                      )
                    }
                    title="Entfernen"
                    type="button"
                  >
                    {location.name} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs font-semibold text-amber-800">
                Mindestens einen Standort wählen; Adbot erlaubt kein implizites
                weltweites Targeting.
              </p>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="text-sm font-bold text-slate-800">
              Anzeigengruppenname
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="adGroupName"
                required
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Anzeigenname
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="adName"
                required
              />
            </label>
            <label className="text-sm font-bold text-slate-800 lg:col-span-2">
              Kontexthinweise (einer pro Zeile)
              <textarea
                className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="contextHints"
                placeholder={"CRM für kleine Unternehmen\nAngebote automatisieren\nVertriebsprozesse verbessern"}
                required
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Chat-Card-Titel (max. 50 Zeichen)
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                maxLength={50}
                minLength={3}
                name="title"
                required
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Ziel-URL
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="targetUrl"
                placeholder="https://…"
                required
                type="url"
              />
            </label>
            <label className="text-sm font-bold text-slate-800 lg:col-span-2">
              Anzeigentext (max. 100 Zeichen)
              <textarea
                className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                maxLength={100}
                name="body"
                required
              />
            </label>
            <label className="text-sm font-bold text-slate-800 lg:col-span-2">
              Öffentliche Bild-URL
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                name="imageUrl"
                placeholder="https://…/motiv.jpg"
                required
                type="url"
              />
            </label>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
            <input
              checked={confirmed}
              className="mt-1 h-4 w-4"
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              Ich bestätige die Angaben. Adbot legt Bild, Kampagne,
              Anzeigengruppe und Anzeige ausschließlich <strong>pausiert</strong>
              an. Ausgaben beginnen erst nach einer separaten Aktivierung.
            </span>
          </label>

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

          <button
            className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              !servingReady || !confirmed || locations.length === 0 || pending
            }
            type="submit"
          >
            {pending ? "PAUSED-Entwurf wird erstellt …" : "PAUSED-Entwurf anlegen"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
