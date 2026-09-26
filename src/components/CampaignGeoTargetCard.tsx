"use client";

import { useEffect, useState } from "react";
import { MapPin, Search } from "lucide-react";

import {
  CITY_RADIUS_FALLBACK_KM,
  META_RADIUS_MAX_KM,
  META_RADIUS_MIN_KM,
  PLATFORM_GEO_CAPABILITIES,
  type CampaignGeoSearchHit,
  type CampaignGeoTarget,
} from "@/lib/campaign-geo/types";
import { effectiveRadiusKm } from "@/lib/campaign-geo/adapters";

type Props = {
  compact?: boolean;
  onSaved?: (geo: CampaignGeoTarget | null) => void;
};

export function CampaignGeoTargetCard({ compact = false, onSaved }: Props) {
  const [geo, setGeo] = useState<CampaignGeoTarget | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CampaignGeoSearchHit[]>([]);
  const [radiusDraft, setRadiusDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/campaign-geo", { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as {
        geo?: CampaignGeoTarget | null;
      };
      if (cancelled || !result.geo) return;
      setGeo(result.geo);
      setRadiusDraft(result.geo.radiusKm != null ? String(result.geo.radiusKm) : "");
      onSaved?.(result.geo);
    })();
    return () => {
      cancelled = true;
    };
    // Initial load only; parent callbacks must not retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchPlaces() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/campaign-geo/search?q=${encodeURIComponent(query.trim())}`);
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        hits?: CampaignGeoSearchHit[];
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Ortssuche fehlgeschlagen.");
      }
      setHits(result.hits ?? []);
      if ((result.hits ?? []).length === 0) {
        setNotice("Kein Ort gefunden. Bitte genauer suchen, z. B. Speyer.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ortssuche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  }

  async function persist(next: CampaignGeoTarget | null) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/campaign-geo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next ? { geo: next } : { clear: true }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        geo?: CampaignGeoTarget | null;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Speichern fehlgeschlagen.");
      }
      setGeo(result.geo ?? null);
      setRadiusDraft(result.geo?.radiusKm != null ? String(result.geo.radiusKm) : "");
      onSaved?.(result.geo ?? null);
      setHits([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  function readRadiusDraft(): number | null | "invalid" {
    if (radiusDraft.trim() === "") return null;
    const numeric = Number(radiusDraft.replace(",", "."));
    if (!Number.isFinite(numeric)) return "invalid";
    const rounded = Math.round(numeric);
    if (rounded < META_RADIUS_MIN_KM || rounded > META_RADIUS_MAX_KM) {
      return "invalid";
    }
    return rounded;
  }

  function applyHit(hit: CampaignGeoSearchHit) {
    const radius = readRadiusDraft();
    if (radius === "invalid") {
      setNotice(`Radius muss zwischen ${META_RADIUS_MIN_KM} und ${META_RADIUS_MAX_KM} km liegen.`);
      return;
    }
    void persist({
      placeLabel: hit.placeLabel,
      placeKind: hit.placeKind,
      countryCode: hit.countryCode,
      latitude: hit.latitude,
      longitude: hit.longitude,
      radiusKm: radius,
      openaiLocationId: null,
      metaLocationKey: null,
    });
  }

  function saveRadius() {
    if (!geo) return;
    const radius = readRadiusDraft();
    if (radius === "invalid") {
      setNotice(`Radius muss zwischen ${META_RADIUS_MIN_KM} und ${META_RADIUS_MAX_KM} km liegen.`);
      return;
    }
    void persist({
      ...geo,
      radiusKm: radius,
    });
  }

  const implied = geo ? effectiveRadiusKm(geo) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
          <MapPin className="size-5" />
        </span>
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-700">Global</p>
          <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">
            Zielgebiet für Kampagnen
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Ein Ort für alle Plattformen, die Geotargeting können. Radius ist optional.
            Meta, Google und TikTok nutzen den Umkreis; ChatGPT Ads nur den Ort.
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void searchPlaces();
            }
          }}
          placeholder="z. B. Speyer oder Deutschland"
          value={query}
        />
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          disabled={query.trim().length < 2 || searching}
          onClick={() => void searchPlaces()}
          type="button"
        >
          <Search className="size-4" />
          {searching ? "Suche …" : "Suchen"}
        </button>
      </div>

      {hits.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {hits.map((hit) => (
            <li key={`${hit.placeLabel}-${hit.latitude}`}>
              <button
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-300 hover:bg-blue-50"
                onClick={() => applyHit(hit)}
                type="button"
              >
                <span className="block font-bold text-slate-900">{hit.placeLabel}</span>
                <span className="block text-xs text-slate-500">
                  {hit.placeKind === "country" ? "Land" : hit.placeKind === "region" ? "Region" : "Ort"}
                  {hit.countryCode ? ` · ${hit.countryCode}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {geo ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <p className="font-bold">{geo.placeLabel}</p>
          <p className="mt-1 text-xs leading-5">
            {geo.radiusKm
              ? `${geo.radiusKm} km Umkreis, Wohnort`
              : geo.placeKind === "country"
                ? "Ganzes Land, kein Umkreis"
                : `Ohne Angabe gilt ${CITY_RADIUS_FALLBACK_KM} km um den Ort`}
            {implied && geo.radiusKm == null && geo.placeKind !== "country"
              ? ` (${implied} km).`
              : "."}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold">
              Radius (km, optional)
              <input
                className="mt-1 w-28 rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-sm"
                inputMode="numeric"
                max={META_RADIUS_MAX_KM}
                min={META_RADIUS_MIN_KM}
                onChange={(event) => setRadiusDraft(event.target.value)}
                placeholder={`${CITY_RADIUS_FALLBACK_KM}`}
                value={radiusDraft}
              />
            </label>
            <button
              className="rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              disabled={pending}
              onClick={saveRadius}
              type="button"
            >
              Radius speichern
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-emerald-900 underline"
              disabled={pending}
              onClick={() => void persist(null)}
              type="button"
            >
              Entfernen
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs leading-5 text-amber-800">
          Noch kein Zielgebiet. Ohne Angabe startet Meta weiter mit Deutschland als Land.
        </p>
      )}

      {notice ? <p className="mt-3 text-sm text-red-700">{notice}</p> : null}

      {compact ? null : (
        <ul className="mt-5 grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2">
          {PLATFORM_GEO_CAPABILITIES.map((platform) => (
            <li className="rounded-xl border border-slate-200 px-3 py-2" key={platform.id}>
              <span className="font-bold text-slate-900">{platform.name}</span>
              <span className="mt-0.5 block">
                {platform.supportsRadius ? "Ort + Radius" : "Nur Ort"}
                {platform.launchWired ? " · wirkt beim Start" : " · bereit, Launch folgt"}
              </span>
              <span className="mt-0.5 block text-slate-500">{platform.note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
